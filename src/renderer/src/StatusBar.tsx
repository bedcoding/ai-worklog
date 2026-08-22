import { useEffect, useState, type ReactNode } from 'react'
import type { ClaudeInfo, ModelChoice } from '@shared/types'
import { Tip, errMsg, modelLabel, shortVersion } from './common'

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
    // 설정을 읽지 못할 수 있다 — 모델 표기는 기본값으로 두고 rejection을 삼킨다
    window.api
      .getSettings()
      .then((s) => alive && setModel(s.model))
      .catch(() => alive && setModel('default'))
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

  const version = info ? shortVersion(info.version) : ''

  return (
    <button type="button" className="statusbar tip-host" onClick={onOpenSettings}>
      {/* 커서는 누를 수 있다고 하는데 예전 title 은 경로만 보여줘서 왜 누르는지 알 수 없었다.
          말풍선은 .ellipsis 안이 아니라 버튼의 직접 자식이어야 잘리지 않는다.
          창 맨 아래라 아래로 열면 화면 밖이므로 위로 펼친다. */}
      <Tip up text={info ? `클릭하면 설정 탭이 열립니다.\n${info.path}` : '클릭하면 설정 탭이 열립니다.'} />
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
