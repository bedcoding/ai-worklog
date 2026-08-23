import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { kstDateOf, kstDateTimeKo, shortDateKo } from '@shared/dates'
import { groupByProject, renderGroupedItems } from '@shared/day-items'
import { renderDigestText } from '@shared/digest-text'
import { rangeStateOf } from '@shared/range-state'
import { cursorOf, keyOf, labelOf, rangeOf, shift, withSpan, type Cursor, type Span } from '@shared/span'
import type {
  ActivityCache,
  BackfillProgress,
  DayDigest,
  DaySummary,
  PeriodPart,
  PeriodPartKind,
  PeriodSummary,
  RangeStatus
} from '@shared/types'
import { CopyButton, Elapsed, Spinner, Tip, errMsg, madeByLabel } from '../common'

/** 생성 중에만 쓰는 화면 상태. 저장되지 않는다 */
interface StreamState {
  /** 요약 본문 조각을 이어붙인 것 */
  text: string
  /** 모델이 생각한 내용. 본문과 절대 같은 자리에 두지 않는다 */
  thinking: string
  /** 0이면 만들고 있지 않다 */
  startedAt: number
  /** 몇 번째 시도인지. 조용히 다시 도는 것이 가장 답답하다 */
  attempt: number
  /** 생각 토큰 누계. 생각 글자보다 먼저 오지만, 아예 안 오는 프롬프트도 있다 */
  tokens: number
}

/** 그 날의 원본 내역과, 그것이 어디서 왔는지 */
interface DayRaw {
  digest: DayDigest
  state: 'scanned' | 'cached'
}

const IDLE_STREAM: StreamState = { text: '', thinking: '', startedAt: 0, attempt: 1, tokens: 0 }

export default function SummaryView({ progress }: { progress: BackfillProgress | null }): ReactNode {
  // 자정을 넘겨도 "오늘"이 어제로 굳지 않도록 창이 열릴 때마다 재평가한다
  const [today, setToday] = useState(() => kstDateOf(Date.now()))
  const [cursor, setCursor] = useState<Cursor>(() => cursorOf('week', kstDateOf(Date.now())))
  const [status, setStatus] = useState<RangeStatus | null>(null)
  /** 2차 조회(원본을 실제로 훑는 쪽)가 도는 중 */
  const [reading, setReading] = useState(false)
  /** 1차 조회가 확인하지 않고 넘긴 날짜 수. 1이면 오늘 하나뿐이다 */
  const [pending, setPending] = useState(0)
  /**
   * 화면에 그려도 되는 구간. 데이터가 도착할 때만 앞으로 간다.
   *
   * cursor 를 그대로 그리면 라벨은 즉시 새 구간인데 목록·요약은 아직 옛 구간이라,
   * 그 사이를 비워 두거나(카드가 접힌다) 옛 값을 남겨야(8월 라벨에 지난주 7일) 한다.
   * 셋을 이 스냅샷 하나에서 뽑으면 한 번에 바뀌어 깜빡임이 없다.
   * 주간/한달 버튼과 화살표는 cursor 를 그대로 써서 누른 즉시 반응한다.
   */
  const [shown, setShown] = useState<Cursor>(() => cursorOf('week', kstDateOf(Date.now())))
  const [summaries, setSummaries] = useState<Map<string, DaySummary>>(new Map())
  const [period, setPeriod] = useState<PeriodSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [composing, setComposing] = useState<PeriodPartKind | null>(null)
  // 만들어지는 중인 상태. 저장되는 것은 아니고 화면에만 흐른다.
  // startedAt이 있으면 초가 올라간다. 모델이 조용한 구간에도 화면이 살아 있어야 한다.
  const [stream, setStream] = useState<StreamState>(IDLE_STREAM)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 한 번 읽은 원본 내역은 메모리에 두고 재사용한다 (날짜를 다시 펼쳐도 재스캔 없음).
  // state 는 main 이 판정해 준 값이다. builtAt 을 보고 짐작하면 규칙이 바뀔 때 어긋난다.
  const [digests, setDigests] = useState<Map<string, DayRaw>>(new Map())
  const [digestBusy, setDigestBusy] = useState<string | null>(null)
  const [digestErr, setDigestErr] = useState<string | null>(null)

  // 구간을 빠르게 전환할 때 이전 구간의 응답이 늦게 도착해 덮어쓰는 것을 막는다
  const reqRef = useRef(0)
  // 그려지는 것과 화면의 버튼이 누르는 것은 모두 shown 에서 뽑는다.
  // cursor 는 요청을 만들 때만 쓴다. status 는 늘 shown 의 것이다 (apply 에서 함께 바꾼다).
  const shownRange = rangeOf(shown)

  /**
   * 두 번에 걸쳐 읽는다.
   *
   * 1차는 저장된 인덱스만 보므로 즉시 끝난다. 이것으로 목록을 먼저 그린다.
   * 2차가 실제로 원본을 훑는다. 그 사이 목록은 이미 화면에 있고, 아직 확인하지
   * 않은 날짜(대개 오늘 하나)에만 읽는 표시가 붙는다.
   *
   * 전에는 목록 전체를 스피너 한 장으로 덮었다. 이미 아는 스무 날이 오늘 하나를
   * 확인하는 300ms 동안 사라졌다.
   *
   * @param quiet 목록을 비우지 않는다. 이미 목록이 있는데 다시 읽을 때 쓴다
   */
  const load = useCallback((quiet = false): void => {
    // 이 요청이 어느 구간의 것인지 붙들어 둔다. 도착할 때 화면을 이 구간으로 한꺼번에 옮긴다
    const at = cursor
    const key = keyOf(at)
    const { start: from, end: to } = rangeOf(at)
    const id = ++reqRef.current
    if (!quiet) setLoading(true)
    setError(null)

    /**
     * 라벨·목록·기간 요약을 한 번에 바꾼다.
     *
     * 예전에는 셋이 서로 다른 시점에 바뀌어 화면이 깜빡였다. 커서를 옮기면 그 렌더에서
     * 곧바로 라벨만 새 구간이 되고, 목록은 loadedKey 가 아직 옛 값이라 빈 배열이 되어
     * 카드가 접혔다 펴졌다. 기간 요약은 옛 구간 글을 들고 있어 새 제목 밑에 남았다.
     */
    const apply = (
      r: { status: RangeStatus; summaries: DaySummary[]; cache: ActivityCache },
      p: PeriodSummary | null
    ): void => {
      setStatus(r.status)
      setSummaries(new Map(r.summaries.map((s) => [s.date, s])))
      setPeriod(p)
      setShown(at)
      setPending(r.cache.pendingDays)
      // 1차 결과로도 목록을 그리므로 여기서 스피너를 내린다
      setLoading(false)
    }

    setReading(true)
    const first = Promise.all([
      window.api.listRange(from, to, { indexOnly: true }),
      window.api.getPeriod(key)
    ])
      .then(([r, p]) => {
        if (id === reqRef.current) apply(r, p)
      })
      // 1차가 실패해도 2차가 진짜 답을 가져온다. 여기서 오류를 띄우지 않는다
      .catch(() => {})

    void first
      .then(() => Promise.all([window.api.listRange(from, to), window.api.getPeriod(key)]))
      .then(([r, p]) => {
        if (id !== reqRef.current) return
        apply(r, p)
      })
      .catch((e: unknown) => {
        if (id === reqRef.current) setError(errMsg(e))
      })
      .finally(() => {
        if (id === reqRef.current) {
          setLoading(false)
          setReading(false)
        }
      })
  }, [cursor])

  // 마지막으로 고른 구간 단위를 되살린다. 기준 날짜는 되살리지 않는다.
  // 다시 열었을 때 보고 싶은 것은 지난달이 아니라 지금이다.
  useEffect(() => {
    let alive = true
    window.api
      .getSettings()
      .then((s) => {
        if (alive && s.span !== 'week') setCursor((c) => withSpan(c, s.span))
      })
      // 설정을 읽지 못하면 기본값(주간)으로 둔다. 목록 자체는 이것과 무관하게 뜬다
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(load, [load])
  useEffect(() => window.api.onDayUpdated(() => load()), [load])

  // 글이 만들어지는 대로 화면에 흘린다. reset은 재시도라 지금까지 받은 것을 버린다.
  // 조각을 이어붙인 글을 저장하지는 않는다. 저장은 main이 최종 결과로 한다.
  useEffect(
    () =>
      window.api.onPeriodStream((e) =>
        setStream((prev) => {
          // 재시도는 처음부터 다시 쓴다. 앞 시도의 글을 남기면 두 글이 이어붙는다.
          // 몇 번째 시도인지는 남긴다. 조용히 다시 도는 것이 가장 답답한 경우다.
          if (e.kind === 'reset') {
            return { ...IDLE_STREAM, startedAt: Date.now(), attempt: prev.attempt + 1 }
          }
          if (e.kind === 'thinking') return { ...prev, thinking: prev.thinking + (e.text ?? '') }
          if (e.kind === 'tokens') return { ...prev, tokens: e.count ?? prev.tokens }
          return { ...prev, text: prev.text + (e.text ?? '') }
        })
      ),
    []
  )

  // 전체 정리 중에 한 날짜가 끝나면 목록을 다시 읽는다. 끝난 행이 계속 '요약 생성'으로
  // 남아 있으면 불이 켜진 한 줄 말고는 아무 일도 없는 것처럼 보인다.
  // 조용히 읽는다. 스피너를 띄우면 날짜마다 목록 위에서 한 번씩 번쩍인다.
  const doneCount = backfilling ? (progress?.done ?? 0) : -1
  useEffect(() => {
    if (doneCount > 0) load(true)
  }, [doneCount, load])

  /**
   * 펼친 날짜를 화면 맨 위로 올린다.
   *
   * 한 번에 하나만 펼치는 아코디언이라, 새 날짜를 누르면 앞서 펼쳐 둔 상세가 함께
   * 접힌다. 그것이 화면 위쪽에 있었으면 그만큼 내용이 줄어 방금 누른 행이 위로 밀려
   * 나간다. 실제로 8/16 을 눌렀는데 8/16 이 화면 밖으로 올라가고 그 아래가 보였다.
   *
   * 브라우저의 스크롤 앵커링이 이것을 보정하려 하지만, 어느 요소가 앵커로 뽑히는지에
   * 따라 결과가 달라져서 어떤 때는 되고 어떤 때는 안 된다. 그래서 직접 맞춘다.
   */
  useEffect(() => {
    if (!openDate) return
    document.getElementById(`day-${openDate}`)?.scrollIntoView({ block: 'start' })
  }, [openDate])

  useEffect(() => {
    const refreshToday = (): void => setToday(kstDateOf(Date.now()))
    window.addEventListener('focus', refreshToday)
    return () => window.removeEventListener('focus', refreshToday)
  }, [])

  /**
   * 원본 내역을 확보한다. 판단은 main 이 한다.
   *
   * 렌더러가 들고 있는 것으로 '이미 읽었으니 건너뛴다'를 정하지 않는다. 그러면 세션
   * 도중에 소스 로그가 바뀐 것을 놓친다. 지금 이 대화처럼 며칠에 걸치는 세션의 파일은
   * 계속 자라서 어제 날짜의 내용도 늘어난다.
   *
   * 매번 물어도 싸다. 소스가 그대로면 main 이 stat 몇 번(1ms 미만)으로 끝내고,
   * 바뀌었을 때만 실제로 훑는다.
   */
  const loadDigest = useCallback((date: string, force = false): void => {
    setDigestBusy(date)
    setDigestErr(null)
    window.api
      .getDayDigest(date, force)
      .then((r) => setDigests((prev) => new Map(prev).set(date, r)))
      .catch((e: unknown) => setDigestErr(errMsg(e)))
      .finally(() => setDigestBusy(null))
  }, [])

  const generateDay = (date: string, force?: boolean): void => {
    setBusyDate(date)
    setError(null)
    window.api
      .generateDay(date, force)
      .then((s) => {
        setSummaries((prev) => new Map(prev).set(date, s))
        // 요약을 새로 만들었으면 원본 내역도 최신 스캔 결과로 교체한다
        setDigests((prev) => {
          const next = new Map(prev)
          next.delete(date)
          return next
        })
        setOpenDate(date)
      })
      .catch((e: unknown) => setError(errMsg(e)))
      .finally(() => {
        setBusyDate(null)
        load()
      })
  }

  const runBackfill = (): void => {
    setBackfilling(true)
    setError(null)
    window.api
      .backfillRange(shownRange.start, shownRange.end)
      .then((s) => setStatus(s))
      .catch((e: unknown) => setError(errMsg(e)))
      .finally(() => {
        setBackfilling(false)
        load()
      })
  }

  // 부분씩 만든다. 마음에 안 드는 쪽만 다시 부르면 claude 호출도 그 한 번이다
  const compose = (part: PeriodPartKind): void => {
    setComposing(part)
    setStream({ ...IDLE_STREAM, startedAt: Date.now() })
    setError(null)
    window.api
      .generatePeriod({ kind: shown.span, key: keyOf(shown) }, part)
      .then((p) => setPeriod(p))
      .catch((e: unknown) => setError(errMsg(e)))
      .finally(() => {
        setComposing(null)
        setStream(IDLE_STREAM)
      })
  }

  const state = rangeStateOf(status)
  const busy = busyDate !== null || backfilling || composing !== null
  const spanWord = shown.span === 'week' ? '주간' : '월간'
  const days = [...(status?.activeDays ?? [])].sort().reverse()
  const todayInRange = today >= shownRange.start && today <= shownRange.end

  // 지금 만들고 있는 날짜. 하루만 만들 때도, 전체 정리로 여러 날을 훑을 때도
  // 그 날짜 행에 불이 켜져야 한다. 어느 쪽이 시작했는지는 화면에서 중요하지 않다.
  const workingDate = busyDate ?? progress?.currentDate ?? null

  // 확인할 것이 오늘 하나뿐이면 그 행에만 표시한다. 그 이상이면 아직 행조차 없는
  // 날짜가 섞여 있어 행에 붙일 수 없다. 그때만 줄로 알린다.
  const readingToday = reading && pending === 1
  const readingRange = reading && pending > 1

  // 누른 버튼이 진행 상황을 직접 말한다. 위쪽 막대에만 있으면 방금 누른 자리와
  // 상태가 뜨는 자리가 멀다. 줄을 새로 만들지 않고 라벨에 붙여 높이가 흔들리지 않게 한다.
  // scan 단계에서는 아직 총 개수를 모른다.
  const scanned = backfilling && progress?.phase === 'summarize' && progress.total > 0
  const backfillLabel = backfilling
    ? scanned && progress
      ? `전체 정리 중 ${progress.done}/${progress.total}`
      : '전체 정리 중'
    : state.kind === 'loading'
      ? '전체 정리하기'
      : state.kind === 'empty'
        ? '정리할 기록 없음'
        : state.kind === 'ready'
          ? '전체 정리 완료'
          : `밀린 ${state.count}일 전체 정리하기`

  // 고른 구간 단위는 설정에 남긴다. 탭을 옮기면 이 화면이 언마운트돼 화면 상태만으로는
  // 남지 않고, 앱을 다시 켜도 주간으로 되돌아갔다.
  const setSpan = (span: Span): void => {
    setCursor(withSpan(cursor, span))
    // 실패해도 화면은 이미 바뀌었다. 다음에 기억되지 않을 뿐이라 막지 않는다.
    void window.api.setSettings({ span }).catch(() => {})
  }

  return (
    <>
      <div className="card">
        <div className="row spread">
          <div className="seg">
            <button
              type="button"
              className={cursor.span === 'week' ? 'on' : ''}
              disabled={busy}
              onClick={() => setSpan('week')}
            >
              주간
            </button>
            <button
              type="button"
              className={cursor.span === 'month' ? 'on' : ''}
              disabled={busy}
              onClick={() => setSpan('month')}
            >
              한달
            </button>
          </div>
          <div className="row">
            <button type="button" className="btn" disabled={busy} onClick={() => setCursor(shift(cursor, -1))}>
              ◀
            </button>
            <strong>{labelOf(shown)}</strong>
            <button type="button" className="btn" disabled={busy} onClick={() => setCursor(shift(cursor, 1))}>
              ▶
            </button>
          </div>
        </div>
        {todayInRange && (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => generateDay(today, true)}
          >
            {busyDate === today ? '오늘 요약 생성 중' : '오늘 하루 정리하기'}
          </button>
        )}
        {/* 날짜 수만큼 claude를 부르는 유일한 버튼이다. 라벨에는 남은 날짜 수만,
            호출 횟수는 말풍선에 둔다. 둘 다 라벨에 넣으면 괄호가 붙어 지저분하다. */}
        <button
          type="button"
          className="btn tip-host"
          disabled={busy || state.kind !== 'pending'}
          onClick={runBackfill}
        >
          {backfillLabel}
          {/* 말풍선에는 라벨이 말하지 않는 것만 둔다. 남은 날짜 수는 이미 라벨에 있고,
              중단은 누른 뒤에 위쪽 막대에서 알려 준다. 누르기 전에 알아야 할 것은
              비용 하나다. 나머지 상태는 라벨만으로 충분해 말풍선을 띄우지 않는다. */}
          {state.kind === 'pending' && <Tip toLeft text={`claude를 ${state.count}번 부릅니다.`} />}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      {/* 구간 전체를 다시 읽는 줄은 두지 않는다. 캐싱은 자동이라 누를 일이 없는데
          목록 위에 늘 떠 있으면 자리만 먹는다. 캐시 여부는 각 날짜를 펼쳤을 때
          그 날의 원본 내역 아래에 적는다. */}
      <div className="card days">
        {/* 목록을 스피너로 덮지 않는다. 아는 행은 이미 그려져 있고, 확인 중인 날짜에만
            그 행에 표시가 붙는다. 아직 아무 행도 없을 때만 무엇을 읽는지 말한다. */}
        {days.length === 0 &&
          (loading || readingRange ? (
            <Spinner label={`${shortDateKo(shownRange.start)}~${shortDateKo(shownRange.end)} 기록을 읽는 중`} />
          ) : (
            <div className="muted">이 기간에는 Claude Code 활동 기록이 없습니다.</div>
          ))}
        {/* 행은 있는데 아직 확인하지 않은 지난 날짜가 남은 경우. 목록 위에 한 줄만 둔다 */}
        {days.length > 0 && readingRange && (
          <div className="reading-note">
            <Spinner label={`아직 확인하지 않은 ${pending}일을 읽는 중`} />
          </div>
        )}
        {days.map((date) => {
          const s = summaries.get(date)
          const open = openDate === date
          return (
            <div key={date} id={`day-${date}`} className="day-item">
              <div
                className="day-head"
                onClick={() => setOpenDate(open ? null : date)}
                role="button"
              >
                <strong className="day-date">{shortDateKo(date)}</strong>
                {/* 업무 내용이 이 줄의 본문이다. 예전에는 이것이 회색이고 날짜가 검은
                    굵은 글씨여서 무게가 뒤집혀 있었다. 활동이 없는 날만 회색으로 둔다. */}
                <span className={`grow ellipsis${s?.empty ? ' muted' : ''}`}>
                  {s?.empty ? '활동 없음' : (s?.headline ?? s?.fallbackText?.slice(0, 40) ?? '')}
                </span>
                {readingToday && date === today ? (
                  // 오늘은 하루가 끝나지 않아 저장하지 않는다. 열 때마다 원본을 읽는다
                  <span className="badge busy">기록 읽는 중</span>
                ) : workingDate === date ? (
                  // 요약이 이미 있는 날짜를 다시 만들 때도 진행이 보여야 한다.
                  // 예전에는 그 행이 'AI 요약됨'으로 남아, 다른 날짜가 왜 다 잠겼는지 알 수 없었다.
                  <span className="badge busy">생성 중</span>
                ) : s?.empty ? (
                  <span className="badge">없음</span>
                ) : s ? (
                  // 요약이 있으면 배지를 달지 않는다. 모든 줄에 'AI 요약됨'이 붙어
                  // 있으면 아무것도 구분해 주지 않으면서 시선만 먹는다. 요약이 있다는
                  // 것은 왼쪽에 업무 내용이 적혀 있다는 사실로 이미 드러난다.
                  null
                ) : (
                  // 미요약 행에서 그 자리에서 생성을 실행한다.
                  // stopPropagation이 없으면 행 펼치기까지 함께 발동한다.
                  // 알약 배지가 아니라 .btn 모양을 쓴다. 상태 표시와 같은 생김새면 눌리는 줄 모른다.
                  <button
                    type="button"
                    className="btn row-action tip-host"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation()
                      generateDay(date)
                    }}
                  >
                    요약 생성
                    {busy && (
                      <Tip toLeft text={'다른 요약을 만들고 있습니다.\n끝난 뒤에 눌러 주세요.'} />
                    )}
                  </button>
                )}
              </div>
              {open && (
                <DayDetail
                  date={date}
                  summary={s ?? null}
                  busy={workingDate === date}
                  anyBusy={busy}
                  onGenerate={(force) => generateDay(date, force)}
                  raw={digests.get(date) ?? null}
                  digestBusy={digestBusy === date}
                  digestErr={digestBusy === date ? null : digestErr}
                  onLoadDigest={(force) => loadDigest(date, force)}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* 위의 날짜 목록과 색을 달리한다. 목록은 재료고 이것은 결과물인데,
          같은 흰 카드에 같은 테두리라 무게가 같아 보였다. */}
      <div className="card period">
        <h3>{spanWord} 요약</h3>
        {/* loading일 때는 아무 말도 하지 않는다. 위 카드의 '기록을 읽는 중'이 그
            상태를 이미 말하고 있고, 여기서 '기록이 없다'고 하면 거짓이 된다. */}
        {state.kind === 'pending' ? (
          <div className="muted">
            날짜별 요약이 모두 있어야 만들 수 있습니다. 위에서 전체 정리를 먼저 끝내세요.
          </div>
        ) : state.kind === 'empty' ? (
          <div className="muted">이 기간에는 묶을 기록이 없습니다.</div>
        ) : null}
        {/* 부분마다 자기 버튼을 옆에 둔다. 카드 머리에 버튼 둘을 몰아 두면 어느
            버튼이 무엇을 만드는지 라벨만으로 말해야 해서 라벨이 길어진다. */}
        <PeriodPartBlock
          title="제목"
          oneLine
          part={period?.overview ?? null}
          locked={busy || state.kind !== 'ready'}
          working={composing === 'overview'}
          stream={stream}
          onMake={() => compose('overview')}
          tip={'날짜별 한 줄 요약만 보고 만듭니다.\nclaude를 1번 부릅니다.'}
        />
        <PeriodPartBlock
          title="내용"
          part={period?.detail ?? null}
          locked={busy || state.kind !== 'ready'}
          working={composing === 'detail'}
          stream={stream}
          onMake={() => compose('detail')}
          tip={'날짜별 상세 항목만 보고 만듭니다.\nclaude를 1번 부릅니다.'}
        />
      </div>
    </>
  )
}

/**
 * 기간 요약의 한 부분. 제목과 내용이 같은 짜임을 쓴다.
 *
 * 복사도 부분마다 따로 둔다. 보고서에 제목과 본문을 각각 붙이는 것이 실제 쓰임이라,
 * 하나로 묶어 주면 붙인 뒤에 손으로 잘라야 한다.
 */
function PeriodPartBlock({
  title,
  oneLine,
  part,
  locked,
  working,
  stream,
  onMake,
  tip
}: {
  title: string
  /** 한 줄짜리 부분은 굵게 세운다. 여러 줄은 줄바꿈을 살려 그대로 둔다 */
  oneLine?: boolean
  part: PeriodPart | null
  locked: boolean
  working: boolean
  /** 만들어지는 중인 상태. 다 만들어지면 part로 바뀐다 */
  stream: StreamState
  onMake: () => void
  tip: string
}): ReactNode {
  return (
    <div className="period-part">
      <div className="row spread">
        <h4>{title}</h4>
        <div className="row">
          {part && <CopyButton text={part.text} />}
          <button
            type="button"
            className="btn steady tip-host"
            disabled={locked}
            onClick={onMake}
          >
            {working ? '만드는 중' : part ? '다시 만들기' : '만들기'}
            {/* 이 카드는 항상 맨 아래다. 아래로 펼치면 스크롤 영역이 말풍선만큼
                늘어나 없던 스크롤바가 생기고, 그 폭에 목록 글자까지 밀린다.
                위로 펼치면 이미 있는 내용을 덮으므로 영역이 늘지 않는다. */}
            <Tip toLeft up text={tip} />
          </button>
        </div>
      </div>
      {part?.stale && !working && (
        <div className="muted">⚠️ {shortDateKo(part.end)}까지만 반영됐습니다. 다시 만드세요.</div>
      )}
      {working ? (
        <Working stream={stream} />
      ) : (
        part &&
        (oneLine ? (
          <strong className="selectable">{part.text}</strong>
        ) : (
          <div className="pre">{part.text}</div>
        ))
      )}
      {/* generatedAt이 빈 옛 캐시가 있다. 그대로 넘기면 'NaN:NaN'이 찍힌다 */}
      {!working && part?.generatedAt && (
        <div className="muted">
          {madeByLabel(part.model, part.modelName)} · {kstDateTimeKo(part.generatedAt)}
        </div>
      )}
    </div>
  )
}

/**
 * 만드는 중에 보여주는 것. 본문이 나오기까지 수십 초 걸리므로 그 사이가 비면
 * 멈춘 것처럼 보인다. 흐른 시간은 모델의 신호와 무관하게 늘 움직인다.
 */
function Working({ stream }: { stream: StreamState }): ReactNode {
  const thinkBox = useRef<HTMLDivElement>(null)

  // 생각이 길어지면 새 글이 상자 밖으로 밀린다. 아래로 붙여 둔다
  useEffect(() => {
    const el = thinkBox.current
    if (el) el.scrollTop = el.scrollHeight
  }, [stream.thinking])

  // 첫 응답이 오기 전에는 claude 가 무엇을 하는지 알 방법이 없다. '기록을 읽는 중'
  // 같은 말은 로컬에서 뭔가 하는 것처럼 들려 거짓이다. 보냈고 기다린다고만 말한다.
  // 실측으로 이 구간이 1분까지 간다. 상한을 함께 적어야 무한정으로 읽히지 않는다.
  const working = stream.text
    ? 'claude가 쓰고 있습니다'
    : stream.thinking || stream.tokens > 0
      ? 'claude가 생각하고 있습니다'
      : '요청을 보냈습니다. 첫 응답을 기다립니다'

  return (
    <>
      <div className="muted">
        <span className="spin" /> {working} <Elapsed since={stream.startedAt} />
        {/* 생각 토큰은 글자보다 먼저 오지만 아예 안 오는 프롬프트도 있다 */}
        {stream.tokens > 0 && !stream.text && ` · ${stream.tokens} 토큰`}
        {/* 재시도는 조용히 일어나면 그냥 멈춘 것으로 보인다 */}
        {stream.attempt > 1 && ` · ${stream.attempt}번째 시도`}
      </div>
      {/* 생각 내용은 요약이 아니다. 이름을 붙여 두지 않으면 무엇이 결과인지 갈리지 않는다.
          저장하지 않는다. 본문이 시작되면 자리를 비운다. */}
      {!stream.text && stream.thinking && (
        <div className="thinking-box">
          <span className="thinking-label">생각 과정 (요약에 들어가지 않습니다)</span>
          <div className="thinking" ref={thinkBox}>
            {stream.thinking}
          </div>
        </div>
      )}
      {stream.text && <div className="pre streaming">{stream.text}</div>}
    </>
  )
}

function DayDetail({
  date,
  summary,
  busy,
  anyBusy,
  onGenerate,
  raw,
  digestBusy,
  digestErr,
  onLoadDigest
}: {
  date: string
  summary: DaySummary | null
  busy: boolean
  anyBusy: boolean
  onGenerate: (force?: boolean) => void
  raw: DayRaw | null
  digestBusy: boolean
  digestErr: string | null
  onLoadDigest: (force?: boolean) => void
}): ReactNode {
  const digest = raw?.digest ?? null
  const hasAi = !!summary && !summary.empty
  const [sub, setSub] = useState<'raw' | 'ai'>(hasAi ? 'ai' : 'raw')

  // 요약이 막 생성되면 결과가 보이도록 AI 탭으로 전환한다 (false→true 전이에서만)
  useEffect(() => {
    if (hasAi) setSub('ai')
  }, [hasAi])

  /**
   * 행을 펼치는 순간 원본 내역을 확보한다.
   *
   * 원본 탭을 누를 때까지 기다리면, 소스 로그가 바뀐 날짜는 그 탭을 누른 뒤에야
   * 갱신돼 낡은 것을 한 번 보게 된다. AI 요약은 이미 화면에 있으므로 이 읽기가
   * 보이는 것을 늦추지 않는다. 토큰도 쓰지 않는다.
   *
   * deps 를 비워 펼칠 때 한 번만 부른다. DayDetail 은 접으면 언마운트되므로
   * 다시 펼치면 다시 부른다. 그때 바뀐 것이 있으면 그때 갱신된다.
   */
  useEffect(() => {
    onLoadDigest()
  }, [])

  // 화면에 보이는 것과 복사되는 것이 같아야 한다. 키워드가 빠지면 그 줄은
  // 선택도 복사도 안 되는 죽은 텍스트가 된다
  const keywords = summary?.keywords ?? []
  const aiText =
    summary && !summary.empty
      ? summary.fallbackText ??
        [
          `${shortDateKo(date)} ${summary.headline ?? ''}`,
          renderGroupedItems(summary.items ?? []),
          ...(keywords.length > 0 ? [`키워드: ${keywords.join(', ')}`] : [])
        ].join('\n')
      : ''

  return (
    <div className="day-detail">
      <div className="row spread">
        <div className="subtabs">
          <button type="button" className={sub === 'raw' ? 'active' : ''} onClick={() => setSub('raw')}>
            원본 내역
          </button>
          <button type="button" className={sub === 'ai' ? 'active' : ''} onClick={() => setSub('ai')}>
            AI 요약
          </button>
        </div>
        {sub === 'ai' && hasAi && <CopyButton text={aiText} />}
        {sub === 'raw' && digest && <CopyButton text={renderDigestText(digest)} label="원본 복사" />}
      </div>

      {sub === 'ai' &&
        (hasAi ? (
          summary.fallbackText ? (
            <div className="pre">{summary.fallbackText}</div>
          ) : (
            <>
              <strong className="selectable">{summary.headline}</strong>
              {/* 프로젝트로 묶는다. 같은 태그가 열 줄 반복되면 정작 다른 부분인
                  업무 내용이 반복되는 태그에 밀린다. */}
              <div className="items">
                {groupByProject(summary.items ?? []).map((g) => (
                  <div key={g.project} className="item-group">
                    <div className="muted">[{g.project}]</div>
                    {g.works.map((work, idx) => (
                      <div key={idx}>{work}</div>
                    ))}
                  </div>
                ))}
              </div>
              {/* 키워드·모델·생성시각은 요약 본문이 아니라 그 요약에 붙는 정보라 선으로 가른다 */}
              <div className="detail-foot">
                <div className="row spread">
                  <span className="muted selectable grow">{keywords.join(', ')}</span>
                  <button
                    type="button"
                    className="btn tip-host"
                    disabled={anyBusy}
                    onClick={() => onGenerate(true)}
                  >
                    {busy ? '생성 중' : '다시 생성'}
                    {/* 같은 카드의 '새로고침'과 성격이 반대다. 그쪽은 원본을 다시 읽고
                        이쪽은 claude 를 부른다. 어느 쪽이 쿼터를 쓰는지 적어 둔다. */}
                    <Tip
                      toLeft
                      up
                      text={
                        'claude를 다시 불러 이 날짜의\n요약을 새로 씁니다.\n구독 쿼터를 사용합니다.'
                      }
                    />
                  </button>
                </div>
                <div className="muted">
                  {madeByLabel(summary.model, summary.modelName)} ·{' '}
                  {kstDateTimeKo(summary.generatedAt)}
                </div>
              </div>
            </>
          )
        ) : (
          <div className="row spread">
            <span className="muted">
              AI 요약이 아직 없습니다. 원본 내역은 토큰 소모 없이 볼 수 있어요.
            </span>
            <button
              type="button"
              className="btn primary tip-host"
              disabled={anyBusy}
              onClick={() => onGenerate()}
            >
              {busy ? '생성 중' : 'AI 요약 생성'}
              <Tip
                toLeft
                up
                text={'claude를 불러 이 날짜의 요약을 만듭니다.\n구독 쿼터를 사용합니다.'}
              />
            </button>
          </div>
        ))}

      {sub === 'raw' && (
        <>
          {digestErr && <div className="error">{digestErr}</div>}
          {digestBusy && <Spinner label="원본 내역 추출 중 (AI 호출 없음)" />}
          {digest && (
            <>
              {digest.projects.length === 0 ? (
                <div className="muted">기록이 없습니다.</div>
              ) : (
                <div className="pre">{renderDigestText(digest)}</div>
              )}
              <div className="detail-foot">
                <div className="row spread">
                  {/* '캐싱됨'은 다시 읽어도 같다는 뜻이다. 읽은 소스 로그 파일이
                      하나도 바뀌지 않았을 때만 붙는다. 바뀌었으면 이 행을 펼칠 때
                      이미 다시 읽었으므로 '방금 읽음'이 된다. */}
                  {raw?.state === 'cached' ? (
                    <span className="muted">
                      <span className="badge">캐싱됨</span> {kstDateTimeKo(digest.builtAt)} 추출
                    </span>
                  ) : (
                    <span className="muted">{kstDateTimeKo(digest.builtAt)} 방금 읽음</span>
                  )}
                  <button
                    type="button"
                    className="btn tip-host"
                    disabled={digestBusy}
                    onClick={() => onLoadDigest(true)}
                  >
                    {digestBusy ? '읽는 중' : '새로고침'}
                    {/* 무엇을 새로고치는지 이름만으로는 알 수 없다. 옆에 '캐싱됨'이
                        붙어 있으니 그것을 다시 만든다는 것까지 적는다. */}
                    <Tip
                      toLeft
                      up
                      text={
                        // 한 줄에 한 문장씩. 문장 중간에서 접히면 읽다가 걸린다
                        '이 날짜의 원본 로그를 다시 훑어\n저장해 둔 것을 새로 만듭니다.\nAI 호출은 없습니다.'
                      }
                    />
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
