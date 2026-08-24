import { useEffect, useState, type ReactNode } from 'react'
import type { ClaudeInfo, ModelChoice } from '@shared/types'
import { errMsg, modelLabel, shortVersion } from './common'

/**
 * claude가 연결됐는지와 어떤 모델로 요약하는지를 항상 보이게 한다.
 * 요약이 "어디로 나가는지" 사용자가 확인할 수 있어야 하기 때문.
 *
 * 앱 버전은 오른쪽 끝에 둔다. 자동 업데이트가 없어 사용자가 스스로 최신인지 알아야
 * 하고, 문제를 알릴 때도 어느 버전인지가 첫 정보다. 연결이 끊긴 화면에도 남긴다.
 *
 * 실행 파일 경로는 여기 두지 않는다. 이 폭에서는 꼬리만 남고,
 * 그 꼬리(claude-code/bin/claude.exe)는 어느 설치에서나 같아 식별에 쓸모가 없다.
 * 전체 경로는 설정 탭의 '실제 실행되는 파일'에서 본다.
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
  const [appVersion, setAppVersion] = useState('')

  // 앱 버전은 실행 중 바뀌지 않는다. nonce와 무관하게 한 번만 읽는다
  useEffect(() => {
    let alive = true
    window.api
      .getAppVersion()
      .then((v) => alive && setAppVersion(v))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    setChecking(true)
    setError(null)
    // 설정을 읽지 못할 수 있다. 모델 표기는 기본값으로 두고 rejection을 삼킨다
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

  // 연결이 끊겼을 때만 누를 수 있게 둔다. 설정 탭은 위에 항상 보이므로 평상시 클릭은
  // 같은 곳으로 가는 두 번째 길일 뿐이고, 그 대가로 창 아래를 지나갈 때마다 커서가
  // 바뀌고 말풍선이 떴다. 오류일 때는 문구 자체가 클릭을 안내하므로 그때만 버튼이다.
  if (error) {
    return (
      <button type="button" className="statusbar" onClick={onOpenSettings}>
        <span className="error">claude 연결 안 됨. 클릭해 경로를 지정하세요</span>
        {appVersion && <span className="appver">v{appVersion}</span>}
      </button>
    )
  }

  return (
    <div className="statusbar">
      {checking ? (
        <span className="muted">claude 연결 확인 중</span>
      ) : (
        <>
          <span className="dot ok" />
          <span className="ellipsis">
            claude {version} · {modelLabel(model, info?.defaultModel)}
          </span>
        </>
      )}
      {appVersion && <span className="appver">v{appVersion}</span>}
    </div>
  )
}
