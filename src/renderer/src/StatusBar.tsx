import { useEffect, useState, type ReactNode } from 'react'
import type { ClaudeInfo, ModelChoice } from '@shared/types'
import { errMsg, modelLabel } from './common'

/**
 * 어떤 claude 실행 파일이 어떤 모델로 연결돼 있는지 항상 보이게 한다.
 * 요약이 "어디로 나가는지" 사용자가 확인할 수 있어야 하기 때문.
 */
export default function StatusBar({
  nonce,
  onOpenSettings
}: {
  nonce: number
  onOpenSettings: () => void
}): ReactNode {
  const [info, setInfo] = useState<ClaudeInfo | null>(null)
  const [model, setModel] = useState<ModelChoice>('default')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let alive = true
    setChecking(true)
    setError(null)
    void window.api.getSettings().then((s) => alive && setModel(s.model))
    window.api
      .detectClaude()
      .then((i) => alive && setInfo(i))
      .catch((e: unknown) => {
        if (!alive) return
        setInfo(null)
        setError(errMsg(e))
      })
      .finally(() => alive && setChecking(false))
    return () => {
      alive = false
    }
  }, [nonce])

  const version = info?.version.replace(/\s*\(Claude Code\)\s*/, '') ?? ''

  return (
    <button type="button" className="statusbar" onClick={onOpenSettings} title={info?.path ?? ''}>
      {checking ? (
        <span className="muted">claude 연결 확인 중…</span>
      ) : error ? (
        <span className="error">claude 연결 안 됨 — 클릭해 경로를 지정하세요</span>
      ) : (
        <>
          <span className="dot ok" />
          <span className="grow ellipsis">
            claude {version} · {modelLabel(model)}
          </span>
          <span className="muted ellipsis path">{info?.path}</span>
        </>
      )}
    </button>
  )
}
