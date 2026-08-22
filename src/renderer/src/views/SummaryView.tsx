import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { kstDateOf, kstDateTimeKo, shortDateKo } from '@shared/dates'
import { renderDigestText } from '@shared/digest-text'
import { cursorOf, keyOf, labelOf, rangeOf, shift, withSpan, type Cursor, type Span } from '@shared/span'
import type { DayDigest, DaySummary, PeriodSummary, RangeStatus } from '@shared/types'
import { CopyButton, Spinner, Tip, errMsg, modelLabel } from '../common'

export default function SummaryView(): ReactNode {
  // 자정을 넘겨도 "오늘"이 어제로 굳지 않도록 창이 열릴 때마다 재평가한다
  const [today, setToday] = useState(() => kstDateOf(Date.now()))
  const [cursor, setCursor] = useState<Cursor>(() => cursorOf('week', kstDateOf(Date.now())))
  const [status, setStatus] = useState<RangeStatus | null>(null)
  // status가 어느 구간의 것인지. 구간을 옮기는 동안 이전 구간의 날짜와 개수가
  // 새 라벨 아래 남아 있으면 화면이 거짓말을 한다 (8월 라벨에 지난주 7일).
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<Map<string, DaySummary>>(new Map())
  const [period, setPeriod] = useState<PeriodSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [composing, setComposing] = useState(false)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 한 번 읽은 원본 내역은 메모리에 두고 재사용한다 (날짜를 다시 펼쳐도 재스캔 없음)
  const [digests, setDigests] = useState<Map<string, DayDigest>>(new Map())
  const [digestBusy, setDigestBusy] = useState<string | null>(null)
  const [digestErr, setDigestErr] = useState<string | null>(null)

  // 구간을 빠르게 전환할 때 이전 구간의 응답이 늦게 도착해 덮어쓰는 것을 막는다
  const reqRef = useRef(0)
  const { start, end } = rangeOf(cursor)
  const periodKey = keyOf(cursor)

  const load = useCallback((): void => {
    const key = periodKey
    const id = ++reqRef.current
    setLoading(true)
    setError(null)
    void window.api.getPeriod(periodKey).then((p) => {
      if (id === reqRef.current) setPeriod(p)
    })
    window.api
      .listRange(start, end)
      .then((r) => {
        if (id !== reqRef.current) return
        setStatus(r.status)
        setSummaries(new Map(r.summaries.map((s) => [s.date, s])))
        setLoadedKey(key)
      })
      .catch((e: unknown) => {
        if (id === reqRef.current) setError(errMsg(e))
      })
      .finally(() => {
        if (id === reqRef.current) setLoading(false)
      })
  }, [periodKey, start, end])

  useEffect(load, [load])
  useEffect(() => window.api.onDayUpdated(() => load()), [load])

  useEffect(() => {
    const refreshToday = (): void => setToday(kstDateOf(Date.now()))
    window.addEventListener('focus', refreshToday)
    return () => window.removeEventListener('focus', refreshToday)
  }, [])

  const loadDigest = useCallback(
    (date: string, force = false): void => {
      if (!force && digests.has(date)) return
      setDigestBusy(date)
      setDigestErr(null)
      window.api
        .getDayDigest(date, force)
        .then((d) => setDigests((prev) => new Map(prev).set(date, d)))
        .catch((e: unknown) => setDigestErr(errMsg(e)))
        .finally(() => setDigestBusy(null))
    },
    [digests]
  )

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
      .backfillRange(start, end)
      .then((s) => setStatus(s))
      .catch((e: unknown) => setError(errMsg(e)))
      .finally(() => {
        setBackfilling(false)
        load()
      })
  }

  const compose = (): void => {
    setComposing(true)
    setError(null)
    window.api
      .generatePeriod({ kind: cursor.span, key: periodKey })
      .then((p) => setPeriod(p))
      .catch((e: unknown) => setError(errMsg(e)))
      .finally(() => setComposing(false))
  }

  // 캐시가 없는 활동일 수. 이 숫자가 곧 '전체 정리하기'의 claude 호출 횟수다.
  // 다른 구간의 응답은 쓰지 않는다. 숫자가 라벨과 맞지 않으면 버튼이 거짓 약속을 한다.
  const settled = loadedKey === periodKey
  const done = new Set(settled ? (status?.summarizedDays ?? []) : [])
  const active = settled ? (status?.activeDays ?? []) : []
  const pending = active.filter((d) => !done.has(d)).length
  const busy = busyDate !== null || backfilling || composing
  const spanWord = cursor.span === 'week' ? '주간' : '월간'
  const days = [...active].sort().reverse()
  const todayInRange = today >= start && today <= end

  const setSpan = (span: Span): void => setCursor(withSpan(cursor, span))

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
            <strong>{labelOf(cursor)}</strong>
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
            {busyDate === today ? '오늘 요약 생성 중…' : '오늘 하루 정리하기'}
          </button>
        )}
        {/* 날짜 수만큼 claude를 부르는 유일한 버튼이다. 라벨에는 남은 날짜 수만,
            호출 횟수는 말풍선에 둔다. 둘 다 라벨에 넣으면 괄호가 붙어 지저분하다. */}
        <button type="button" className="btn tip-host" disabled={busy || pending === 0} onClick={runBackfill}>
          {backfilling
            ? '전체 정리 중…'
            : pending === 0
              ? '전체 정리 완료'
              : `밀린 ${pending}일 전체 정리하기`}
          <Tip
            toLeft
            text={
              pending === 0
                ? '이 구간은 모두 정리돼 있습니다.'
                : // 짧은 줄을 가운데 두면 오른쪽 끝이 움푹 들어가 보인다. 긴 줄부터 놓는다.
                  `요약이 없는 ${pending}일을 하나씩 차례로 만듭니다.\n진행 중에 위쪽 막대에서 중단할 수 있습니다.\nclaude를 ${pending}번 부릅니다.`
            }
          />
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        {loading && <Spinner label="기록을 읽는 중…" />}
        {!loading && days.length === 0 && (
          <div className="muted">이 기간에는 Claude Code 활동 기록이 없습니다.</div>
        )}
        {days.map((date) => {
          const s = summaries.get(date)
          const open = openDate === date
          return (
            <div key={date} className="day-item">
              <div
                className="row spread"
                onClick={() => setOpenDate(open ? null : date)}
                role="button"
              >
                <strong>{shortDateKo(date)}</strong>
                <span className="grow muted ellipsis">
                  {s?.empty ? '활동 없음' : (s?.headline ?? s?.fallbackText?.slice(0, 40) ?? '')}
                </span>
                {busyDate === date ? (
                  // 요약이 이미 있는 날짜를 다시 만들 때도 진행이 보여야 한다.
                  // 예전에는 그 행이 'AI 요약됨'으로 남아, 다른 날짜가 왜 다 잠겼는지 알 수 없었다.
                  <span className="badge busy">생성 중…</span>
                ) : s ? (
                  <span className={`badge${s.empty ? '' : ' on'}`}>
                    {s.empty ? '없음' : 'AI 요약됨'}
                  </span>
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
                  busy={busyDate === date}
                  anyBusy={busy}
                  onGenerate={(force) => generateDay(date, force)}
                  digest={digests.get(date) ?? null}
                  digestBusy={digestBusy === date}
                  digestErr={digestBusy === date ? null : digestErr}
                  onLoadDigest={(force) => loadDigest(date, force)}
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="card">
        <div className="row spread">
          <h3>{spanWord} 요약</h3>
          <div className="row">
            {period && <CopyButton text={period.text} />}
            <button
              type="button"
              className="btn steady tip-host"
              disabled={busy || pending > 0 || active.length === 0}
              onClick={compose}
            >
              {composing ? '만드는 중…' : period ? '다시 만들기' : '만들기'}
              <Tip
                toLeft
                text={'이미 만들어 둔 날짜별 요약을 묶습니다.\nclaude를 1번만 부릅니다.'}
              />
            </button>
          </div>
        </div>
        {pending > 0 ? (
          <div className="muted">
            날짜별 요약이 모두 있어야 만들 수 있습니다. 위에서 전체 정리를 먼저 끝내세요.
          </div>
        ) : active.length === 0 ? (
          <div className="muted">이 기간에는 묶을 기록이 없습니다.</div>
        ) : null}
        {period && (
          <>
            {period.stale && (
              <div className="muted">
                ⚠️ {shortDateKo(period.end)}까지만 반영된 요약입니다. 다시 만드세요.
              </div>
            )}
            <div className="pre">{period.text}</div>
            <div className="muted">
              {modelLabel(period.model)} · {kstDateTimeKo(period.generatedAt)}
            </div>
          </>
        )}
      </div>
    </>
  )
}

function DayDetail({
  date,
  summary,
  busy,
  anyBusy,
  onGenerate,
  digest,
  digestBusy,
  digestErr,
  onLoadDigest
}: {
  date: string
  summary: DaySummary | null
  busy: boolean
  anyBusy: boolean
  onGenerate: (force?: boolean) => void
  digest: DayDigest | null
  digestBusy: boolean
  digestErr: string | null
  onLoadDigest: (force?: boolean) => void
}): ReactNode {
  const hasAi = !!summary && !summary.empty
  const [sub, setSub] = useState<'raw' | 'ai'>(hasAi ? 'ai' : 'raw')

  // 요약이 막 생성되면 결과가 보이도록 AI 탭으로 전환한다 (false→true 전이에서만)
  useEffect(() => {
    if (hasAi) setSub('ai')
  }, [hasAi])

  // 원본 탭을 처음 열 때만 읽는다. 이미 읽어둔 날짜는 상위 캐시에서 즉시 표시된다
  useEffect(() => {
    if (sub === 'raw' && !digest && !digestBusy) onLoadDigest()
  }, [sub, digest, digestBusy, onLoadDigest])

  // 화면에 보이는 것과 복사되는 것이 같아야 한다. 키워드가 빠지면 그 줄은
  // 선택도 복사도 안 되는 죽은 텍스트가 된다
  const keywords = summary?.keywords ?? []
  const aiText =
    summary && !summary.empty
      ? summary.fallbackText ??
        [
          `${shortDateKo(date)} ${summary.headline ?? ''}`,
          ...(summary.items ?? []).map((i) => `- [${i.project}] ${i.work}`),
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
              <ul className="items">
                {(summary.items ?? []).map((i, idx) => (
                  <li key={idx}>
                    <span className="muted">[{i.project}]</span> {i.work}
                  </li>
                ))}
              </ul>
              {/* 키워드·모델·생성시각은 요약 본문이 아니라 그 요약에 붙는 정보라 선으로 가른다 */}
              <div className="detail-foot">
                <div className="row spread">
                  <span className="muted selectable grow">{keywords.join(', ')}</span>
                  <button
                    type="button"
                    className="btn"
                    disabled={anyBusy}
                    onClick={() => onGenerate(true)}
                  >
                    {busy ? '생성 중…' : '다시 생성'}
                  </button>
                </div>
                <div className="muted">
                  {modelLabel(summary.model)} · {kstDateTimeKo(summary.generatedAt)}
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
              className="btn primary"
              disabled={anyBusy}
              onClick={() => onGenerate()}
            >
              {busy ? '생성 중…' : 'AI 요약 생성'}
            </button>
          </div>
        ))}

      {sub === 'raw' && (
        <>
          {digestErr && <div className="error">{digestErr}</div>}
          {digestBusy && <Spinner label="원본 내역 추출 중… (AI 호출 없음)" />}
          {digest && (
            <>
              {digest.projects.length === 0 ? (
                <div className="muted">기록이 없습니다.</div>
              ) : (
                <div className="pre">{renderDigestText(digest)}</div>
              )}
              <div className="detail-foot">
                <div className="row spread">
                  <span className="muted">{kstDateTimeKo(digest.builtAt)} 추출됨</span>
                  <button
                    type="button"
                    className="btn"
                    disabled={digestBusy}
                    onClick={() => onLoadDigest(true)}
                  >
                    {digestBusy ? '읽는 중…' : '새로고침'}
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
