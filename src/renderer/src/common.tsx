import { useEffect, useState, type ReactNode } from 'react'
import type { ModelChoice } from '@shared/types'

/** 설정의 모델 선택값을 사람이 읽는 이름으로 */
export function modelLabel(model: ModelChoice | string): string {
  if (model === 'haiku') return 'Haiku 4.5'
  if (model === 'sonnet') return 'Sonnet 5'
  if (model === 'default') return 'CLI 기본 모델'
  return model
}

/** invoke 에러를 사용자 문구로 (Electron이 붙이는 접두어 제거) */
/**
 * 즉시 뜨는 말풍선. title 속성의 네이티브 툴팁은 뜨기까지 약 1초 걸리고
 * 그 지연을 페이지에서 바꿀 수 없어서 직접 그린다.
 *
 * 부모에 `tip-host` 클래스를 달아야 그 부모를 기준으로 위치가 잡힌다.
 * 창 폭(432px)이 고정이라 자동 뒤집기 없이 호출부에서 방향을 지정한다.
 *
 * @param toLeft 오른쪽 끝에 붙는 대상. 왼쪽으로 펼친다
 * @param up 창 아래쪽에 붙는 대상. 위로 펼친다
 */
export function Tip({
  text,
  toLeft,
  up
}: {
  text: string
  toLeft?: boolean
  up?: boolean
}): ReactNode {
  const cls = ['tip', toLeft ? 'to-left' : '', up ? 'up' : ''].filter(Boolean).join(' ')
  return <span className={cls}>{text}</span>
}

/** claude --version 출력은 "2.1.234 (Claude Code)" 형태다. 좁은 줄에서는 번호만 쓴다 */
export function shortVersion(v: string): string {
  return v.replace(/\s*\(Claude Code\)\s*/, '').trim()
}

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

export function Spinner({ label }: { label: string }): ReactNode {
  return <div className="muted">⏳ {label}</div>
}

/**
 * 시작한 뒤 흐른 시간. 초가 올라가는 것만으로 '멈춘 것이 아니다'가 전해진다.
 * 모델이 아무것도 보내지 않는 구간이 수십 초라, 모델의 신호에 기대면 화면이 죽는다.
 */
export function Elapsed({ since }: { since: number }): ReactNode {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [since])
  return <>{Math.max(0, Math.floor((now - since) / 1000))}초</>
}
