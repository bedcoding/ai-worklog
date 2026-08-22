import { useEffect, useState, type ReactNode } from 'react'
import type { ModelChoice } from '@shared/types'

/** 설정의 모델 선택값을 사람이 읽는 이름으로 */
export function modelLabel(model: ModelChoice | string, defaultModel?: string | null): string {
  if (model === 'haiku') return 'Haiku 4.5'
  if (model === 'sonnet') return 'Sonnet 5'
  if (model === 'opus') return 'Opus 5'
  if (model === 'fable') return 'Fable 5'
  // 'CLI 기본 모델'만 적으면 그게 fable인지 opus인지 알 수 없다. 알아냈으면 밝힌다
  if (model === 'default') {
    return defaultModel ? `${shortModel(defaultModel)} (CLI 기본)` : 'CLI 기본 모델'
  }
  return model
}

/**
 * 모델명을 짧게. claude- 접두어와 [1m] 같은 꼬리표를 떼고 날짜도 뗀다.
 * claude-fable-5 -> fable-5, claude-haiku-4-5-20251001 -> haiku-4.5
 */
export function shortModel(name: string): string {
  const base = name
    .replace(/^claude-/, '')
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}$/, '')
  // haiku-4-5 처럼 버전이 하이픈으로 갈린 것만 점으로 되돌린다
  return base.replace(/-(\d+)-(\d+)$/, '-$1.$2')
}

/**
 * 요약 아래에 찍는 모델 표기. 실제로 응답한 모델명이 있으면 그것을 쓴다.
 * 'CLI 기본 모델'만 적으면 그게 fable인지 opus인지 화면에서 알 수 없다.
 */
export function madeByLabel(model: string, modelName?: string): string {
  if (!modelName) return modelLabel(model)
  const short = shortModel(modelName)
  // 고른 값이 'default'면 실제 이름만으로는 그것이 CLI 설정이었다는 사실이 사라진다
  return model === 'default' ? `${short} (CLI 기본)` : short
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
