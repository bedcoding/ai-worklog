import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Settings, SchedulerRun } from '@shared/types'
import { Spinner, Tip, errMsg, shortModel, shortVersion } from '../common'

/** 0(일) ~ 6(토). Settings.excludeWeekdays의 인덱스와 같은 순서여야 한다 */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/**
 * 설명을 상시 노출하지 않고 호버로 넘긴다. 좁은 창에서 설명 줄이 화면을 크게 먹는다.
 * 다만 표식이 없으면 설명이 있다는 것 자체를 알 수 없으므로 ⓘ 는 남긴다.
 *
 * title 속성을 쓰지 않는다. 네이티브 툴팁은 뜨기까지 약 1초 걸리고 그 지연을
 * 페이지에서 바꿀 수 없다. 직접 그리면 즉시 뜨고 생김새도 앱과 맞춘다.
 *
 * @param toLeft 오른쪽 끝에 있는 ⓘ 는 말풍선을 왼쪽으로 펼쳐야 창 밖으로 안 나간다.
 *   창 폭이 고정(432px)이라 자동 뒤집기 없이 호출부에서 지정한다.
 */
function Hint({ text, toLeft }: { text: string; toLeft?: boolean }): ReactNode {
  return (
    // tabIndex로 키보드에서도 열 수 있게 한다
    <span className="hint tip-host" tabIndex={0} role="note" aria-label={text}>
      ⓘ
      <Tip text={text} toLeft={toLeft} />
    </span>
  )
}

/** 연결 테스트 결과. 성공 시 버전과 경로를 분리해야 좁은 줄에서 접히지 않는다 */
type ClaudeState =
  | { kind: 'idle' }
  | { kind: 'ok'; version: string; path: string; defaultModel: string | null }
  | { kind: 'error'; message: string }

/** 자동 저장 상태. 저장이 눈에 보이지 않으면 값이 남았는지 알 방법이 없다 */
type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

/**
 * 타이핑은 매 글자를 디스크에 쓰지 않고 멈춘 뒤에 쓴다.
 * 고르는 항목(select·checkbox)은 한 번의 동작으로 끝나므로 기다릴 이유가 없어 즉시 쓴다.
 */
const TYPING_DELAY = 500

export default function SettingsView({ onSaved }: { onSaved?: () => void }): ReactNode {
  const [form, setForm] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [claude, setClaude] = useState<ClaudeState>({ kind: 'idle' })
  const [testing, setTesting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 디바운스가 끝나면 보낼 스냅샷 */
  const queued = useRef<Settings | null>(null)
  /**
   * 저장을 한 줄로 세운다. 겹쳐 보내면 늦게 도착한 옛 스냅샷이 새 값을 덮는다.
   * 매번 폼 전체를 보내므로 마지막에 보낸 것이 디스크의 진실이 되어야 한다.
   */
  const chain = useRef<Promise<void>>(Promise.resolve())
  /** 마지막으로 OS에 반영한 자동 시작 값. 바뀔 때만 로그인 항목을 건드린다 */
  const lastAuto = useRef<boolean | null>(null)

  useEffect(() => {
    let alive = true
    setLoadError(null)
    window.api
      .getSettings()
      .then((s) => {
        if (!alive) return
        // 디스크에서 읽은 값을 기준선으로 둔다. 이후 이 값이 바뀔 때만 로그인 항목을 고친다
        lastAuto.current = s.autoLaunch
        setForm(s)
      })
      // 실패를 삼키면 안 된다. 폼을 기본값으로 채우면 그 스냅샷이 그대로 저장돼
      // 실제 설정을 덮어쓴다. 폼을 아예 그리지 않고 재시도를 제공한다.
      .catch((e: unknown) => alive && setLoadError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [reload])

  useEffect(() => {
    // 어떤 claude가 연결됐는지 열자마자 보이도록 자동 감지한다
    let alive = true
    window.api
      .detectClaude()
      .then(
        (i) =>
          alive &&
          setClaude({
            kind: 'ok',
            version: shortVersion(i.version),
            path: i.path,
            defaultModel: i.defaultModel ?? null
          })
      )
      .catch((e: unknown) => alive && setClaude({ kind: 'error', message: errMsg(e) }))
    return () => {
      alive = false
    }
  }, [])

  // '저장됨'은 잠시 뒤 스스로 사라진다. 계속 띄워 두면 폼 아래를 영구히 가린다.
  // 오류는 사용자가 조치해야 하므로 남긴다.
  useEffect(() => {
    if (save.kind !== 'saved') return
    const t = setTimeout(() => setSave({ kind: 'idle' }), 2500)
    return () => clearTimeout(t)
  }, [save])

  if (loadError) {
    return (
      <div className="card">
        <div className="error">{loadError}</div>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => setReload((n) => n + 1)}>
            다시 시도
          </button>
        </div>
      </div>
    )
  }
  if (!form) return <Spinner label="설정을 불러오는 중" />

  const commit = (next: Settings): void => {
    setSave({ kind: 'saving' })
    chain.current = chain.current.then(async () => {
      try {
        // span(주간/한달)은 요약 탭이 관리한다. 폼 스냅샷에 실려 있어도 보내지 않는다.
        // 보내면 설정 탭을 연 순간의 옛 값이, 그 사이 요약 탭에서 바꾼 필터를 덮는다.
        const toSave: Partial<Settings> = { ...next }
        delete toSave.span
        await window.api.setSettings(toSave)
        // 응답으로 폼을 덮지 않는다. 저장하는 동안 사용자가 더 고쳤으면 그것이 사라진다.
        // 폼 전체를 보내므로 main이 되돌려주는 값은 방금 보낸 것과 같다.
        if (lastAuto.current !== next.autoLaunch) {
          lastAuto.current = next.autoLaunch
          await window.api.setAutoLaunch(next.autoLaunch)
        }
        setSave({ kind: 'saved' })
        onSaved?.()
      } catch (e: unknown) {
        setSave({ kind: 'error', message: errMsg(e) })
      }
    })
  }

  /** 기다리던 저장을 지금 보낸다. 입력칸에서 포커스가 빠질 때도 부른다 */
  const flush = (): void => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const next = queued.current
    queued.current = null
    if (next) commit(next)
  }

  /**
   * @param now 고르는 항목은 즉시 저장한다. 예전에는 폼 맨 아래 저장 버튼을 눌러야
   *   했는데, 그 버튼이 프롬프트 입력칸 세 개 아래에 있어서 모델을 골라 놓고도
   *   저장되지 않은 채 지나갔다.
   */
  const patch = (p: Partial<Settings>, now = false): void => {
    const next = { ...form, ...p }
    setForm(next)
    queued.current = next
    if (timer.current) clearTimeout(timer.current)
    if (now) {
      flush()
      return
    }
    setSave({ kind: 'saving' })
    timer.current = setTimeout(flush, TYPING_DELAY)
  }

  /** 요일 하나를 제외 목록에 넣거나 뺀다. 즉시 저장한다 (타이핑이 아니라 클릭이다) */
  const toggleWeekday = (i: number): void => {
    const cur = form.excludeWeekdays ?? []
    const next = cur.includes(i) ? cur.filter((d) => d !== i) : [...cur, i].sort()
    patch({ excludeWeekdays: next }, true)
  }

  const testClaude = (): void => {
    setTesting(true)
    // 이전 결과를 지우지 않는다. 지우면 ✓ 칩과 '실제 실행되는 파일' 필드가 통째로
    // 사라졌다 다시 나타나 카드 높이가 출렁인다. 새 결과가 오면 덮어쓰기만 한다.
    window.api
      .testClaude(form.claudePath ?? '')
      .then((i) =>
        setClaude({
          kind: 'ok',
          version: shortVersion(i.version),
          path: i.path,
          defaultModel: i.defaultModel ?? null
        })
      )
      .catch((e: unknown) => setClaude({ kind: 'error', message: errMsg(e) }))
      .finally(() => setTesting(false))
  }

  const restorePrompts = (): void => {
    // 버튼 한 번으로 끝나는 동작이라 기다릴 이유가 없다
    void window.api.getDefaultPrompts().then((prompts) => patch({ prompts }, true))
  }

  return (
    <form
      className="settings"
      onSubmit={(e) => {
        // 입력칸에서 Enter를 누르면 기본 동작이 폼 제출이다. 기다리던 저장을 지금 보낸다
        e.preventDefault()
        flush()
      }}
    >
      {/* 트레이 앱은 켜져 있어야 아래의 매일 자동 요약이 돈다. 그 전제를 맨 위에 둔다 */}
      <div className="card">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.autoLaunch}
            onChange={(e) => patch({ autoLaunch: e.target.checked }, true)}
          />
          로그인 시 앱 자동 시작
          <Hint text={'꺼두면 앱을 직접 실행한 동안에만\n자동 요약이 동작합니다.'} />
        </label>
      </div>

      <div className="card">
        {/* 카드 동작 버튼은 머리 오른쪽에 둔다. 프롬프트 템플릿의 '기본값 복원'과 같은 자리.
            ✓ 버전은 버튼 옆에 남긴다. 이게 없으면 눌러도 화면이 안 바뀌어 실행됐는지 알 수 없다. */}
        <div className="row spread">
          <h3>
            Claude CLI{' '}
            <Hint
              text={
                '요약은 이 실행 파일을 로컬에서 호출합니다.\n구독 쿼터를 사용하며 API 과금은 없습니다.'
              }
            />
          </h3>
          <div className="row">
            {claude.kind === 'ok' && <span className="ok">✓ {claude.version}</span>}
            <button
              type="button"
              className="btn steady tip-host"
              disabled={testing}
              onClick={testClaude}
            >
              {testing ? '확인 중' : '연결 테스트'}
              {/* 한 줄이 말풍선 폭(270px)을 넘으면 자동으로 한 번 더 접힌다.
                  줄을 짧게 끊어 두면 의도한 곳에서만 나뉜다. */}
              <Tip
                toLeft
                text={
                  // 한 줄에 한 문장씩 담는다. 문장 중간에서 끊기면 읽다가 걸린다.
                  '위 경로를 실제 실행 파일로 해석합니다.\n그 파일로 claude --version을 실행합니다.\n여기서 되면 요약도 됩니다.'
                }
              />
            </button>
          </div>
        </div>
        <label>
          실행 파일 경로 (비우면 자동 탐지)
          <input
            value={form.claudePath ?? ''}
            placeholder={
              window.api.platform === 'win32'
                ? '예: C:\\Program Files\\nodejs\\claude.cmd'
                : '예: ~/.local/bin/claude'
            }
            onChange={(e) => patch({ claudePath: e.target.value.trim() || null })}
            onBlur={flush}
          />
        </label>
        {/* 실패 사유는 길어서 머리에 못 넣는다. 원인이 위 입력칸이므로 그 아래에 붙인다 */}
        {claude.kind === 'error' && <div className="error">✗ {claude.message}</div>}
        {claude.kind === 'ok' && (
          // 입력한 경로와 다를 수 있다. 윈도우에서는 .cmd/.ps1 셰임이 실제 .exe로
          // 해석된다. 위아래 필드와 같은 상자를 써서 "이 입력의 결과값"으로 읽히게 한다.
          <label>
            실제 실행되는 파일
            {/* input은 잘려도 …이 붙지 않아 잘린 것인지 알 수 없다. 상자 모양만 빌리고
                말풍선은 상자 안에 두되 잘리는 쪽(.ellipsis)밖에 둔다 */}
            <span className="readonly-box tip-host">
              <span className="ellipsis path-tail">{claude.path}</span>
              <Tip text={claude.path} />
            </span>
          </label>
        )}
        <label>
          <span>
            요약 모델{' '}
            <Hint
              toLeft
              text={
                '기본으로 두면 CLI 설정을 따라갑니다.\n코딩용으로 CLI 모델을 바꾸면 요약도 함께 바뀝니다.\n요약마다 실제로 쓴 모델이 아래에 적힙니다.'
              }
            />
          </span>
          <select
            value={form.model}
            onChange={(e) => patch({ model: e.target.value as Settings['model'] }, true)}
          >
            {/* '기본'이 실제로 무엇인지 적어 둔다. 이것을 몰라 Fable 5로 요약되는 줄
                모르고 지낼 수 있다. 읽지 못했으면 이름 없이 둔다. */}
            <option value="default">
              {claude.kind === 'ok' && claude.defaultModel
                ? `CLI 기본 모델 (${shortModel(claude.defaultModel)})`
                : 'CLI 기본 모델'}
            </option>
            <option value="opus">Opus 5</option>
            <option value="fable">Fable 5</option>
            <option value="sonnet">Sonnet 5</option>
            <option value="haiku">Haiku 4.5 (빠르고 저렴)</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h3>자동 실행</h3>
        <div className="grid2">
          <label>
            매일 자동 요약
            <select
              value={form.dailyAuto}
              onChange={(e) => patch({ dailyAuto: e.target.value as Settings['dailyAuto'] }, true)}
            >
              <option value="off">끄기</option>
              <option value="confirm">물어보고 실행</option>
              <option value="silent">조용히 자동 실행</option>
            </select>
          </label>
          <label>
            실행 시각
            <input
              type="time"
              value={form.dailyTime}
              onChange={(e) => patch({ dailyTime: e.target.value })}
              onBlur={flush}
            />
          </label>
          <label>
            <span>
              요약 대상{' '}
              <Hint
                text={
                  '아침에 실행한다면 어제를 고르세요.\n오늘을 고르면 그때까지의 몇 시간치만 요약됩니다.'
                }
              />
            </span>
            <select
              value={form.dailySubject}
              onChange={(e) =>
                patch({ dailySubject: e.target.value as Settings['dailySubject'] }, true)
              }
            >
              <option value="today">오늘</option>
              <option value="yesterday">어제</option>
            </select>
          </label>
        </div>
        <div className="fieldhead">
          <span>
            요약에서 제외할 요일{' '}
            <Hint
              text={
                '고른 요일은 요약 목록에서도 빠집니다.\n사람이 쉬는 날에도 자동화가 claude를\n부르면 그 기록이 업무로 요약되는 것을 막습니다.'
              }
            />
          </span>
          <div className="weekdays">
            {WEEKDAYS.map((ko, i) => {
              const off = (form.excludeWeekdays ?? []).includes(i)
              return (
                <button
                  key={ko}
                  type="button"
                  className={off ? 'off' : ''}
                  aria-pressed={off}
                  onClick={() => toggleWeekday(i)}
                >
                  {ko}
                </button>
              )
            })}
          </div>
        </div>
        <label>
          <span>
            원본 추출 캐시 보관 기간 (개월, 0 = 무제한){' '}
            <Hint
              toLeft
              text={
                '오래된 원본 추출 캐시만 자동 삭제합니다.\nAI 요약 기록은 영구 보관됩니다.\n~/.claude의 원본 로그는 건드리지 않습니다.'
              }
            />
          </span>
          <input
            type="number"
            min={0}
            value={form.retentionMonths}
            onChange={(e) => patch({ retentionMonths: Math.max(0, Number(e.target.value) || 0) })}
            onBlur={flush}
          />
        </label>
        <RunHistory />
      </div>

      <div className="card">
        <div className="row spread">
          <h3>
            프롬프트 템플릿{' '}
            <Hint
              text={
                '{date} {weekday} {digest} {label} {data}\n자리표시자는 실행 시 치환됩니다.\nJSON 형식을 없애면 원문이 그대로 나옵니다.'
              }
            />
          </h3>
          <button type="button" className="btn" onClick={restorePrompts}>
            기본값 복원
          </button>
        </div>
        <label>
          일일 요약
          <textarea
            value={form.prompts.day}
            onChange={(e) => patch({ prompts: { ...form.prompts, day: e.target.value } })}
            onBlur={flush}
          />
        </label>
        {/* 기간 요약은 두 번 부른다. 한 줄은 날짜별 헤드라인만, 상세는 날짜별 항목만
            {data}로 받는다. 그래서 템플릿도 따로 둔다. */}
        <label>
          주간/월간 한 줄 요약
          <textarea
            value={form.prompts.periodOverview}
            onChange={(e) =>
              patch({ prompts: { ...form.prompts, periodOverview: e.target.value } })
            }
            onBlur={flush}
          />
        </label>
        <label>
          주간/월간 상세 요약
          <textarea
            value={form.prompts.periodDetail}
            onChange={(e) => patch({ prompts: { ...form.prompts, periodDetail: e.target.value } })}
            onBlur={flush}
          />
        </label>
      </div>

      {/* 자동 저장은 눈에 보이지 않으면 저장됐는지 알 수 없다. 스크롤 위치와 무관하게
          보이도록 sticky로 띄운다. 예전의 저장 버튼은 프롬프트 입력칸 세 개 아래에
          있어서, 위에서 모델을 고르고도 저장하지 못한 채 지나갔다.

          다만 이것은 아래 내용을 덮으므로 평상시에는 아예 없다. */}
      {save.kind !== 'idle' && (
        <div className={`save-state${save.kind === 'error' ? ' wide' : ''}`} role="status">
          {save.kind === 'error' ? (
            <>
              <span className="error grow">{save.message}</span>
              {/* 폼에 있는 값이 사용자가 원하는 값이므로 그것을 다시 보낸다 */}
              <button type="button" className="btn" onClick={() => commit(form)}>
                다시 시도
              </button>
            </>
          ) : (
            <span className="muted">{save.kind === 'saving' ? '저장 중' : '저장됨 ✓'}</span>
          )}
        </div>
      )}
    </form>
  )
}


/** 자동 실행 결과 한 줄. 매일 도는 일이 제대로 도는지 여기서만 보인다 */
function RunHistory(): ReactNode {
  const [runs, setRuns] = useState<SchedulerRun[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    window.api
      .getSchedulerHistory()
      .then((r) => alive && setRuns(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (runs.length === 0) {
    return (
      <div className="runbox">
        <div className="fieldhead">최근 기록</div>
        <div className="runline">아직 실행된 적이 없습니다</div>
      </div>
    )
  }

  const last = runs[0]
  const failed = last.outcome === 'error'
  return (
    <div className="runbox">
      <div className="fieldhead">최근 기록</div>
      <div
        className={`runline${failed ? ' bad' : ''}${runs.length > 1 ? ' clickable' : ''}`}
        onClick={runs.length > 1 ? () => setOpen((v) => !v) : undefined}
      >
        {runLabel(last)}
        {runs.length > 1 && (
          <span className="runmore">{open ? '접기' : `이전 ${runs.length - 1}회`}</span>
        )}
      </div>
      {open && (
        <div className="runlist">
          {runs.slice(1).map((r) => (
            <div key={r.at} className={r.outcome === 'error' ? 'bad' : undefined}>
              {runLabel(r)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * "8/26 10:00 성공 (45초)" 꼴.
 * 요약한 날이 실행한 날과 다르면 무엇을 요약했는지 밝힌다. 어제치를 돌려 놓고
 * 실행 시각만 보이면 어느 날 기록인지 알 수 없다.
 */
function runLabel(r: SchedulerRun): string {
  const d = new Date(r.at)
  const when = Number.isNaN(d.getTime())
    ? r.date
    : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const ranOn = r.ranOn ?? r.date
  const subject = r.date === ranOn ? '' : ` ${r.date.slice(5).replace('-', '/')}분`
  const took = r.ms >= 1000 ? ` (${Math.round(r.ms / 1000)}초)` : ''
  switch (r.outcome) {
    case 'ok':
      return `${when}${subject} 성공${took}`
    case 'empty':
      return `${when}${subject} 활동 없음`
    case 'skipped':
      return `${when}${subject} 건너뜀`
    default:
      return `${when}${subject} 실패: ${r.error ?? '알 수 없는 오류'}`
  }
}
