import { useEffect, useState, type ReactNode } from 'react'
import type { BackfillProgress } from '@shared/types'
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

  useEffect(
    () => window.api.onBackfillProgress((p) => setProgress(p.phase === 'idle' ? null : p)),
    []
  )

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
          <SettingsView />
        </div>
      </main>
    </div>
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
