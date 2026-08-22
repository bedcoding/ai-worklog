import { useEffect, useState, type ReactNode } from 'react'
import type { BackfillProgress } from '@shared/types'
import StatusBar from './StatusBar'
import DailyView from './views/DailyView'
import MonthView from './views/MonthView'
import SettingsView from './views/SettingsView'
import WeekView from './views/WeekView'

const TABS = [
  { id: 'daily', label: '일일' },
  { id: 'week', label: '주간' },
  { id: 'month', label: '월간 기안' },
  { id: 'settings', label: '설정' }
] as const

type TabId = (typeof TABS)[number]['id']

export default function App(): ReactNode {
  const [tab, setTab] = useState<TabId>('daily')
  const [progress, setProgress] = useState<BackfillProgress | null>(null)
  // 설정을 저장하면 상태바가 claude 연결/모델을 다시 확인한다
  const [claudeNonce, setClaudeNonce] = useState(0)
  const [pinned, setPinned] = useState(false)

  useEffect(
    () => window.api.onBackfillProgress((p) => setProgress(p.phase === 'idle' ? null : p)),
    []
  )

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
          className={pinned ? 'pin pinned' : 'pin'}
          aria-pressed={pinned}
          title={
            pinned
              ? '창 고정 해제 — 다른 곳을 클릭하면 창이 닫힙니다'
              : '창 고정 — 다른 곳을 클릭해도 창이 닫히지 않습니다'
          }
          onClick={() => void window.api.setWindowPinned(!pinned).then(setPinned)}
        >
          <PinIcon />
        </button>
      </nav>
      {progress && <ProgressBanner p={progress} />}
      <main className="content">
        {tab === 'daily' && <DailyView />}
        {tab === 'week' && <WeekView />}
        {tab === 'month' && <MonthView />}
        {/* 설정은 언마운트하지 않는다 — 저장 전 탭을 옮겨도 입력이 남아 있어야 한다 */}
        <div
          style={{
            display: tab === 'settings' ? 'contents' : 'none'
          }}
        >
          <SettingsView onSaved={() => setClaudeNonce((n) => n + 1)} />
        </div>
      </main>
      <StatusBar nonce={claudeNonce} onOpenSettings={() => setTab('settings')} />
    </div>
  )
}

/** 압정 아이콘 — 고정 해제 상태에서는 CSS로 기울여 관례대로 구분한다 */
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
  const phaseLabel =
    p.phase === 'scan'
      ? '기록 스캔 중…'
      : p.phase === 'report'
        ? '기안 문구 생성 중…'
        : `일별 요약 생성 중 ${p.done}/${p.total}${p.currentDate ? ` (${p.currentDate})` : ''}`
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : undefined
  return (
    <div className="progress-wrap">
      <div className="row spread">
        <span className="muted">{phaseLabel}</span>
        <button type="button" className="btn" onClick={() => void window.api.cancelBackfill()}>
          취소
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
