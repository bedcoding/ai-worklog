import { useState, type ReactNode } from 'react'
import type { ModelChoice } from '@shared/types'

/** 설정의 모델 선택값을 사람이 읽는 이름으로 */
export function modelLabel(model: ModelChoice | string): string {
  if (model === 'haiku') return 'Haiku 4.5'
  if (model === 'sonnet') return 'Sonnet 5'
  if (model === 'default') return 'CLI 기본 모델'
  return model
}

/** invoke 에러를 사용자 문구로 (Electron이 붙이는 접두어 제거) */
export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function CopyButton({
  text,
  label = '복사',
  primary = false
}: {
  text: string
  label?: string
  primary?: boolean
}): ReactNode {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={`btn${primary ? ' primary' : ''}`}
      onClick={() => {
        void window.api.copyToClipboard(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      {done ? '복사됨 ✓' : label}
    </button>
  )
}

export function MonthNav({
  ym,
  onChange,
  disabled = false
}: {
  ym: string
  onChange: (ym: string) => void
  disabled?: boolean
}): ReactNode {
  const move = (delta: number): void => {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + delta, 1))
    onChange(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  const [y, m] = ym.split('-').map(Number)
  return (
    <div className="row">
      <button type="button" className="btn" disabled={disabled} onClick={() => move(-1)}>
        ◀
      </button>
      <strong className="grow" style={{ textAlign: 'center' }}>
        {y}년 {m}월
      </strong>
      <button type="button" className="btn" disabled={disabled} onClick={() => move(1)}>
        ▶
      </button>
    </div>
  )
}

export function Spinner({ label }: { label: string }): ReactNode {
  return <div className="muted">⏳ {label}</div>
}
