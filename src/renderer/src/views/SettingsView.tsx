import { useEffect, useState, type ReactNode } from 'react'
import type { Profile, Settings } from '@shared/types'
import { Spinner, errMsg } from '../common'

const PROFILE_FIELDS: { key: keyof Profile; label: string; placeholder: string }[] = [
  { key: 'gianTitle', label: '기안 제목', placeholder: '예: OO본부 생성형 AI' },
  { key: 'gianLink', label: '기안 링크', placeholder: '결재 문서 URL' },
  { key: 'gianApprovedDate', label: '기안 승인일', placeholder: '예: 2026. 7. 1' },
  { key: 'corp', label: '법인', placeholder: '예: OO엔터테인먼트' },
  { key: 'dept', label: '소속', placeholder: '팀명 (최하위 1개)' },
  { key: 'name', label: '이름', placeholder: '이름' },
  { key: 'empNo', label: '사번', placeholder: '예: EMP000' },
  { key: 'email', label: '회사메일', placeholder: 'name@example.com' },
  { key: 'aiService', label: '사용 중인 AI 서비스', placeholder: '예: Claude' },
  { key: 'plan', label: '구독 플랜', placeholder: '예: Max 5x' },
  { key: 'billingCycle', label: '결제주기', placeholder: '예: 월간' },
  { key: 'amount', label: '금액(현지통화)', placeholder: '예: 100 US' }
]

export default function SettingsView({ onSaved }: { onSaved?: () => void }): ReactNode {
  const [form, setForm] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claudeInfo, setClaudeInfo] = useState<string | null>(null)
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
      .then((i) => alive && setClaudeInfo(`✓ ${i.version} — ${i.path}`))
      .catch((e: unknown) => alive && setClaudeInfo(`✗ ${errMsg(e)}`))
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
  const patchProfile = (key: keyof Profile, value: string): void =>
    patch({ profile: { ...form.profile, [key]: value } })

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
    setClaudeInfo(null)
    window.api
      .testClaude(form.claudePath ?? '')
      .then((info) => setClaudeInfo(`✓ ${info.version} — ${info.path}`))
      .catch((e: unknown) => setClaudeInfo(`✗ ${errMsg(e)}`))
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
        </label>
        <div className="muted">
          꺼두면 앱을 직접 실행한 동안에만 자동 요약이 동작합니다.
        </div>
      </div>

      <div className="card">
        <h3>제출 양식 프로필 (고정값)</h3>
        <div className="grid2">
          {PROFILE_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                value={form.profile[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => patchProfile(f.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Claude CLI</h3>
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
          {claudeInfo && <span className="muted grow">{claudeInfo}</span>}
        </div>
        <div className="muted">
          요약은 이 실행 파일을 로컬에서 호출합니다. 구독 쿼터를 사용하며 API 과금은 없습니다.
        </div>
        <div className="grid2">
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
          <label>
            월 절감 시간 (기안 문구용, 선택)
            <input
              type="number"
              min={0}
              value={form.monthlySavedHours ?? ''}
              placeholder="예: 20"
              onChange={(e) =>
                patch({ monthlySavedHours: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </label>
        </div>
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
          원본 추출 캐시 보관 기간 (개월, 0 = 무제한)
          <input
            type="number"
            min={0}
            value={form.retentionMonths}
            onChange={(e) => patch({ retentionMonths: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <div className="muted">
          오래된 원본 추출 캐시만 자동 삭제합니다. AI 요약·기안 기록은 영구 보관되며, ~/.claude의
          Claude Code 원본 로그는 절대 삭제하지 않습니다.
        </div>
      </div>

      <div className="card">
        <div className="row spread">
          <h3>프롬프트 템플릿</h3>
          <button type="button" className="btn" onClick={restorePrompts}>
            기본값 복원
          </button>
        </div>
        <div className="muted">
          {'{date} {weekday} {digest} {label} {data} {ym} {savedHours}'} 자리표시자는 실행 시
          치환됩니다. JSON 출력 형식을 없애면 자동 조립 대신 원문이 그대로 표시됩니다.
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
        <label>
          기안 문구 (사용 목적/예상 업무 결과물)
          <textarea
            value={form.prompts.gian}
            onChange={(e) => patch({ prompts: { ...form.prompts, gian: e.target.value } })}
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
