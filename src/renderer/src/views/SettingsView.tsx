import { useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/types'
import { Spinner, errMsg, shortVersion } from '../common'

/**
 * 설명을 상시 노출하지 않고 호버로 넘긴다 — 좁은 창에서 설명 줄이 화면을 크게 먹는다.
 * 다만 표식이 없으면 설명이 있다는 것 자체를 알 수 없으므로 ⓘ 는 남긴다.
 */
function Hint({ text }: { text: string }): ReactNode {
  return (
    <span className="hint" title={text} aria-label={text}>
      ⓘ
    </span>
  )
}

/** 연결 테스트 결과 — 성공 시 버전과 경로를 분리해야 좁은 줄에서 접히지 않는다 */
type ClaudeState =
  | { kind: 'idle' }
  | { kind: 'ok'; version: string; path: string }
  | { kind: 'error'; message: string }

export default function SettingsView({ onSaved }: { onSaved?: () => void }): ReactNode {
  const [form, setForm] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claude, setClaude] = useState<ClaudeState>({ kind: 'idle' })
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let alive = true
    setLoadError(null)
    window.api
      .getSettings()
      .then((s) => alive && setForm(s))
      // 실패를 삼키면 안 된다 — 폼을 기본값으로 채우면 그 스냅샷이 그대로 저장돼
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
      .then((i) => alive && setClaude({ kind: 'ok', version: shortVersion(i.version), path: i.path }))
      .catch((e: unknown) => alive && setClaude({ kind: 'error', message: errMsg(e) }))
    return () => {
      alive = false
    }
  }, [])

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
  if (!form) return <Spinner label="설정을 불러오는 중…" />

  const patch = (p: Partial<Settings>): void => {
    setForm({ ...form, ...p })
    setSaved(false)
  }

  const save = (): void => {
    setError(null)
    window.api
      .setSettings(form)
      .then((s) => {
        setForm(s)
        setSaved(true)
        onSaved?.()
        return window.api.setAutoLaunch(s.autoLaunch)
      })
      .catch((e: unknown) => setError(errMsg(e)))
  }

  const testClaude = (): void => {
    setTesting(true)
    setClaude({ kind: 'idle' })
    window.api
      .testClaude(form.claudePath ?? '')
      .then((i) => setClaude({ kind: 'ok', version: shortVersion(i.version), path: i.path }))
      .catch((e: unknown) => setClaude({ kind: 'error', message: errMsg(e) }))
      .finally(() => setTesting(false))
  }

  const restorePrompts = (): void => {
    void window.api.getDefaultPrompts().then((prompts) => patch({ prompts }))
  }

  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      {/* 트레이 앱은 켜져 있어야 아래의 매일 자동 요약이 돈다 — 그 전제를 맨 위에 둔다 */}
      <div className="card">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.autoLaunch}
            onChange={(e) => patch({ autoLaunch: e.target.checked })}
          />
          로그인 시 앱 자동 시작
          <Hint text="꺼두면 앱을 직접 실행한 동안에만 자동 요약이 동작합니다." />
        </label>
      </div>

      <div className="card">
        <h3>
          Claude CLI{' '}
          <Hint text="요약은 이 실행 파일을 로컬에서 호출합니다. 구독 쿼터를 사용하며 API 과금은 없습니다." />
        </h3>
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
          />
        </label>
        <div className="row">
          <button type="button" className="btn" disabled={testing} onClick={testClaude}>
            {testing ? '확인 중…' : '연결 테스트'}
          </button>
          {claude.kind === 'ok' && <span className="ok">✓ {claude.version}</span>}
          {claude.kind === 'error' && <span className="error grow">✗ {claude.message}</span>}
        </div>
        {/* 경로는 길어서 버튼 옆에 두면 세 줄로 접힌다. 한 줄로 두고 앞을 잘라 파일명이 보이게 한다 */}
        {claude.kind === 'ok' && (
          <div className="muted ellipsis path-tail" title={claude.path}>
            {claude.path}
          </div>
        )}
        <label>
          요약 모델
          <select
            value={form.model}
            onChange={(e) => patch({ model: e.target.value as Settings['model'] })}
          >
            <option value="default">CLI 기본 모델</option>
            <option value="haiku">Haiku 4.5 (빠르고 저렴)</option>
            <option value="sonnet">Sonnet 5</option>
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
              onChange={(e) => patch({ dailyAuto: e.target.value as Settings['dailyAuto'] })}
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
            />
          </label>
        </div>
        <label>
          <span>
            원본 추출 캐시 보관 기간 (개월, 0 = 무제한){' '}
            <Hint text="오래된 원본 추출 캐시만 자동 삭제합니다. AI 요약 기록은 영구 보관되며, ~/.claude의 Claude Code 원본 로그는 절대 삭제하지 않습니다." />
          </span>
          <input
            type="number"
            min={0}
            value={form.retentionMonths}
            onChange={(e) => patch({ retentionMonths: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
      </div>

      <div className="card">
        <div className="row spread">
          <h3>
            프롬프트 템플릿{' '}
            <Hint text="{date} {weekday} {digest} {label} {data} 자리표시자는 실행 시 치환됩니다. JSON 출력 형식을 없애면 자동 조립 대신 원문이 그대로 표시됩니다." />
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
          />
        </label>
        <label>
          주간/월간 요약
          <textarea
            value={form.prompts.period}
            onChange={(e) => patch({ prompts: { ...form.prompts, period: e.target.value } })}
          />
        </label>
      </div>

      {error && <div className="error">{error}</div>}
      <button type="submit" className="btn primary">
        {saved ? '저장됨 ✓' : '설정 저장'}
      </button>
    </form>
  )
}
