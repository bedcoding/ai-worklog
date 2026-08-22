import { useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/types'
import { Spinner, Tip, errMsg, shortVersion } from '../common'

/**
 * 설명을 상시 노출하지 않고 호버로 넘긴다 — 좁은 창에서 설명 줄이 화면을 크게 먹는다.
 * 다만 표식이 없으면 설명이 있다는 것 자체를 알 수 없으므로 ⓘ 는 남긴다.
 *
 * title 속성을 쓰지 않는다 — 네이티브 툴팁은 뜨기까지 약 1초 걸리고 그 지연을
 * 페이지에서 바꿀 수 없다. 직접 그리면 즉시 뜨고 생김새도 앱과 맞춘다.
 *
 * @param toLeft 오른쪽 끝에 있는 ⓘ 는 말풍선을 왼쪽으로 펼쳐야 창 밖으로 안 나간다.
 *   창 폭이 고정(432px)이라 자동 뒤집기 없이 호출부에서 지정한다.
 */
function Hint({ text, toLeft }: { text: string; toLeft?: boolean }): ReactNode {
  return (
    // tabIndex 로 키보드에서도 열 수 있게 한다
    <span className="hint tip-host" tabIndex={0} role="note" aria-label={text}>
      ⓘ
      <Tip text={text} toLeft={toLeft} />
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
      .then(
        (i) =>
          alive &&
          setClaude({ kind: 'ok', version: shortVersion(i.version), path: i.path })
      )
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
    // 이전 결과를 지우지 않는다 — 지우면 ✓ 칩과 '실제 실행되는 파일' 필드가 통째로
    // 사라졌다 다시 나타나 카드 높이가 출렁인다. 새 결과가 오면 덮어쓰기만 한다.
    window.api
      .testClaude(form.claudePath ?? '')
      .then((i) =>
        setClaude({ kind: 'ok', version: shortVersion(i.version), path: i.path })
      )
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
          <Hint text={'꺼두면 앱을 직접 실행한 동안에만\n자동 요약이 동작합니다.'} />
        </label>
      </div>

      <div className="card">
        {/* 카드 동작 버튼은 머리 오른쪽에 둔다 — 프롬프트 템플릿의 '기본값 복원'과 같은 자리.
            ✓ 버전은 버튼 옆에 남긴다. 이게 없으면 눌러도 화면이 안 바뀌어 실행됐는지 알 수 없다. */}
        <div className="row spread">
          <h3>
            Claude CLI{' '}
            <Hint
              text={
                '요약은 이 실행 파일을 로컬에서 호출합니다.\n구독 쿼터를 사용하며 API 과금은 없습니다.'
              }
            />
          </h3>
          <div className="row">
            {claude.kind === 'ok' && <span className="ok">✓ {claude.version}</span>}
            <button
              type="button"
              className="btn steady tip-host"
              disabled={testing}
              onClick={testClaude}
            >
              {testing ? '확인 중…' : '연결 테스트'}
              <Tip
                toLeft
                text={
                  '위 경로(비우면 자동 탐지)를 실제 실행 파일로 해석하고\nclaude --version 을 직접 실행해 봅니다.\n요약이 쓰는 것과 같은 경로라, 여기서 되면 요약도 됩니다.'
                }
              />
            </button>
          </div>
        </div>
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
        {/* 실패 사유는 길어서 머리에 못 넣는다. 원인이 위 입력칸이므로 그 아래에 붙인다 */}
        {claude.kind === 'error' && <div className="error">✗ {claude.message}</div>}
        {claude.kind === 'ok' && (
          // 입력한 경로와 다를 수 있다 — 윈도우에서는 .cmd/.ps1 셰임이 실제 .exe 로
          // 해석된다. 위아래 필드와 같은 상자를 써서 "이 입력의 결과값"으로 읽히게 한다.
          <label>
            실제 실행되는 파일
            {/* input 은 잘려도 … 이 붙지 않아 잘린 것인지 알 수 없다. 상자 모양만 빌리고
                말풍선은 상자 안에 두되 잘리는 쪽(.ellipsis) 밖에 둔다 */}
            <span className="readonly-box tip-host">
              <span className="ellipsis path-tail">{claude.path}</span>
              <Tip text={claude.path} />
            </span>
          </label>
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
            <Hint
              toLeft
              text={
                '오래된 원본 추출 캐시만 자동 삭제합니다.\nAI 요약 기록은 영구 보관됩니다.\n~/.claude 의 Claude Code 원본 로그는\n절대 삭제하지 않습니다.'
              }
            />
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
            <Hint
              text={
                '{date} {weekday} {digest} {label} {data}\n자리표시자는 실행 시 치환됩니다.\nJSON 출력 형식을 없애면 자동 조립 대신\n원문이 그대로 표시됩니다.'
              }
            />
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
