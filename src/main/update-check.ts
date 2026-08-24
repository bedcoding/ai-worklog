/**
 * 최신 릴리스 버전 확인.
 *
 * 이 파일은 앱에서 유일하게 네트워크를 쓰는 곳이다. scripts/check-no-network.mjs가
 * 나머지 src/ 전체에서 네트워크 호출을 금지하고 이 파일만 예외로 둔다. 예외를 한 곳에
 * 묶어 두어야 "무엇이 밖으로 나가는가"를 이 파일만 읽고 판단할 수 있다.
 *
 * 나가는 것은 GET 요청 하나뿐이다. 업무 기록도, 요약도, 사용자를 식별할 값도 보내지
 * 않는다. 받는 것은 최신 태그 이름과 릴리스 페이지 주소다.
 *
 * 자동 업데이트(다운로드·설치)는 하지 않는다. 새 버전이 있다고 알리고 브라우저로
 * 릴리스 페이지를 열어 줄 뿐, 내려받고 설치하는 것은 사용자가 한다.
 */
import { app, dialog, net, shell } from 'electron'
import { compareVersions } from '@shared/version'
import { readJson, updateStatePath, writeJsonAtomic } from './cache'

const API = 'https://api.github.com/repos/bedcoding/ai-worklog/releases/latest'
const PAGE = 'https://github.com/bedcoding/ai-worklog/releases/latest'

/** 실제 확인 주기. 급한 업데이트가 아니므로 주 1회면 충분하다 */
const CHECK_INTERVAL = 7 * 24 * 60 * 60 * 1000
/** 주기가 됐는지 살피는 간격. 잠자기로 타이머가 밀려도 이 간격 안에 따라잡는다 */
const TICK_INTERVAL = 6 * 60 * 60 * 1000
/** 기동 직후에는 네트워크가 아직 안 붙어 있을 수 있다 */
const FIRST_CHECK_DELAY = 30_000

interface UpdateState {
  lastCheckedAt?: string
  /** 사용자가 건너뛴 버전 태그. 자동 확인에서만 무시한다 */
  skippedVersion?: string
}

let timer: ReturnType<typeof setInterval> | null = null

async function readState(): Promise<UpdateState> {
  return (await readJson<UpdateState>(updateStatePath())) ?? {}
}

async function writeState(patch: Partial<UpdateState>): Promise<void> {
  await writeJsonAtomic(updateStatePath(), { ...(await readState()), ...patch })
}

/** 서버에서 받은 최신 태그. 실패하면 null이고, 그때는 주기를 리셋하지 않는다 */
async function fetchLatest(): Promise<{ tag: string; page: string } | null> {
  try {
    const res = await net.fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const json = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof json?.tag_name !== 'string' || !json.tag_name) return null
    return {
      tag: json.tag_name,
      page: typeof json.html_url === 'string' ? json.html_url : PAGE
    }
  } catch {
    // 오프라인이거나 API가 죽었다. 자동 확인이라면 조용히 넘어간다
    return null
  }
}

/**
 * @param manual 사용자가 직접 눌렀는가.
 *   자동 확인은 새 버전이 있을 때만 말을 건다. 수동 확인은 최신이어도 결과를 보여준다.
 *   아무 반응이 없으면 버튼이 고장난 것으로 보이기 때문이다.
 */
export async function checkForUpdate(manual = false): Promise<void> {
  if (!manual) {
    const { lastCheckedAt } = await readState()
    if (lastCheckedAt) {
      const elapsed = Date.now() - new Date(lastCheckedAt).getTime()
      // 시계가 뒤로 간 경우(elapsed < 0)는 확인을 막지 않는다
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < CHECK_INTERVAL) return
    }
  }

  const latest = await fetchLatest()
  const current = app.getVersion()

  if (!latest) {
    if (manual) {
      await dialog.showMessageBox({
        type: 'warning',
        title: '업데이트 확인',
        message: '업데이트를 확인하지 못했습니다',
        detail: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
        buttons: ['확인']
      })
    }
    // 실패는 기록하지 않는다. 다음 기회에 다시 시도해야 한다
    return
  }

  // 응답을 실제로 받았을 때만 주기를 리셋한다
  await writeState({ lastCheckedAt: new Date().toISOString() })

  if (compareVersions(latest.tag, current) <= 0) {
    if (manual) {
      await dialog.showMessageBox({
        type: 'info',
        title: '업데이트 확인',
        message: '최신 버전을 사용 중입니다',
        detail: `현재 버전 ${current}`,
        buttons: ['확인']
      })
    }
    return
  }

  // 건너뛴 버전은 자동 확인에서만 무시한다. 직접 눌렀다면 보여주는 것이 맞다
  if (!manual && (await readState()).skippedVersion === latest.tag) return

  const buttons = manual
    ? ['다운로드 페이지 열기', '나중에']
    : ['다운로드 페이지 열기', '나중에', '이 버전 건너뛰기']

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '업데이트 알림',
    message: `새 버전 ${latest.tag}이(가) 나왔습니다`,
    detail: `현재 ${current} → 최신 ${latest.tag.replace(/^v/, '')}`,
    buttons,
    defaultId: 0,
    cancelId: 1
  })

  if (response === 0) await shell.openExternal(latest.page)
  else if (response === 2) await writeState({ skippedVersion: latest.tag })
}

export function startUpdateChecker(): void {
  if (timer) clearInterval(timer)
  setTimeout(() => void checkForUpdate(false), FIRST_CHECK_DELAY)
  timer = setInterval(() => void checkForUpdate(false), TICK_INTERVAL)
}

export function stopUpdateChecker(): void {
  if (timer) clearInterval(timer)
  timer = null
}
