import { useEffect, useState, type ReactNode } from 'react'
import { AUTH_FAILURE_MESSAGE } from '@shared/claude-error'
import type { BackfillProgress, PipelineError } from '@shared/types'
import StatusBar from './StatusBar'
import { Tip } from './common'
import SettingsView from './views/SettingsView'
import SummaryView from './views/SummaryView'

const TABS = [
  { id: 'summary', label: '요약' },
  { id: 'settings', label: '설정' }
] as const

type TabId = (typeof TABS)[number]['id']

export default function App(): ReactNode {
  const [tab, setTab] = useState<TabId>('summary')
  const [progress, setProgress] = useState<BackfillProgress | null>(null)
  // 설정을 저장하면 상태바가 claude 연결/모델을 다시 확인한다
  const [claudeNonce, setClaudeNonce] = useState(0)
  const [pinned, setPinned] = useState(false)
  const [pipelineError, setPipelineError] = useState<PipelineError | null>(null)
  const [authFailed, setAuthFailed] = useState(false)
  const [authDismissed, setAuthDismissed] = useState(false)

  useEffect(
    () => window.api.onBackfillProgress((p) => setProgress(p.phase === 'idle' ? null : p)),
    []
  )

  // main이 보내는 파이프라인 오류(자동 요약 실패, 알림 표시 불가 등)를 표시한다.
  // 수신자가 없으면 main의 '조용히 넘기지 않는다'가 실제로는 아무 데도 보이지 않는다.
  useEffect(() => window.api.onPipelineError(setPipelineError), [])

  /**
   * 로그인이 풀렸는지는 창이 닫혀 있는 동안에도 바뀐다. 열 때 한 번 읽고 그 뒤로는
   * push를 받는다. 다시 풀리면 닫아 둔 배너를 되살린다.
   */
  useEffect(() => {
    let alive = true
    void window.api
      .getAuthFailed()
      .then((v) => alive && setAuthFailed(v))
      .catch(() => {})
    const off = window.api.onAuthState((v) => {
      setAuthFailed(v)
      if (v) setAuthDismissed(false)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  // 핀 상태는 main이 갖고 있다 (blur 처리 주체가 main이기 때문). 초기값을 읽어 표시를 맞춘다.
  useEffect(() => {
    let alive = true
    void window.api.getWindowPinned().then((p) => alive && setPinned(p))
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="app">
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className={pinned ? 'pin pinned tip-host' : 'pin tip-host'}
          aria-pressed={pinned}
          onClick={() => void window.api.setWindowPinned(!pinned).then(setPinned)}
        >
          <PinIcon />
          <Tip
            toLeft
            text={
              pinned
                ? '창 고정 해제\n다른 곳을 클릭하면 창이 닫힙니다'
                : '창 고정\n다른 곳을 클릭해도 창이 닫히지 않습니다'
            }
          />
        </button>
      </nav>
      {/*
        로그인 문제는 다른 오류보다 위에 둔다. 이것이 풀리기 전까지는 나머지가 전부
        같은 이유로 실패하므로, 아래에 쌓인 실패들을 먼저 읽게 하면 헛짚게 된다.
      */}
      {authFailed && !authDismissed && (
        <div className="progress-wrap">
          <div className="row spread">
            <span className="error grow">{AUTH_FAILURE_MESSAGE}</span>
            <button type="button" className="btn" onClick={() => setAuthDismissed(true)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {pipelineError && (
        <div className="progress-wrap">
          <div className="row spread">
            <span className="error grow">{pipelineError.message}</span>
            <button type="button" className="btn" onClick={() => setPipelineError(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {progress && <ProgressBanner p={progress} />}
      <main className="content">
        {/* 진행 상황은 여기서 한 번만 받아 아래로 내린다. 목록이 어느 날짜를
            만들고 있는지 표시해야 하므로 배너만 알고 있으면 부족하다. */}
        {tab === 'summary' && <SummaryView progress={progress} />}
        {/* 설정은 언마운트하지 않는다. 저장 전 탭을 옮겨도 입력이 남아 있어야 한다 */}
        <div
          style={{
            display: tab === 'settings' ? 'contents' : 'none'
          }}
        >
          <SettingsView onSaved={() => setClaudeNonce((n) => n + 1)} />
        </div>
      </main>
      <StatusBar authFailed={authFailed} nonce={claudeNonce} onOpenSettings={() => setTab('settings')} />
    </div>
  )
}

/** 압정 아이콘. 고정 해제 상태에서는 CSS로 기울여 관례대로 구분한다 */
function PinIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M5 2h6v1.2l-1 .8v3.2l1.8 2.3H8.7V14H7.3V9.5H4.2L6 7.2V4L5 3.2V2z"
        fill="currentColor"
      />
    </svg>
  )
}

function ProgressBanner({ p }: { p: BackfillProgress }): ReactNode {
  // 중단은 돌고 있는 claude를 죽이지 않는다. 지금 날짜를 끝내고 다음으로 넘어가지 않을 뿐이다.
  // 그 사이(최대 2분) 화면이 그대로면 눌리지 않은 것처럼 보이므로 눌렀다는 사실을 남긴다.
  // 생성이 끝나면 phase가 idle이 되어 이 배너 자체가 사라지므로 상태를 되돌릴 필요가 없다.
  const [stopping, setStopping] = useState(false)
  const phaseLabel = stopping
    ? `${p.currentDate ?? '지금 날짜'}까지 만들고 중단합니다`
    : p.phase === 'scan'
      ? '기록 스캔 중'
      // 날짜는 붙이지 않는다. 목록에서 그 날짜 행이 직접 불을 켜므로,
      // 여기에 ISO 날짜를 괄호로 또 적으면 날짜가 있어야 할 자리에서 멀어진다.
      : `일별 요약 생성 중 ${p.done}/${p.total}`
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : undefined
  return (
    <div className="progress-wrap">
      <div className="row spread">
        <span className="muted">{phaseLabel}</span>
        <button
          type="button"
          className="btn tip-host"
          disabled={stopping}
          onClick={() => {
            setStopping(true)
            void window.api.cancelBackfill()
          }}
        >
          {/* 라벨을 '중단 중…'으로 바꾸면 폭이 44 → 70px로 늘어 옆 문구가 밀린다.
              눌렸다는 것은 비활성 처리와 왼쪽 진행 문구가 이미 알려주므로 글자는 그대로 둔다. */}
          중단
          <Tip toLeft text={'지금 만들고 있는 날짜는 끝내고\n다음 날짜부터 중단합니다'} />
        </button>
      </div>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: pct === undefined ? '30%' : `${pct}%` }}
        />
      </div>
    </div>
  )
}
