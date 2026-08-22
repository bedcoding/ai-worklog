import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { kstDateOf, ymOf } from '@shared/dates'
import { cacheRoot, daysRoot } from './cache'
import { getSettings } from './settings'

/** 이보다 오래된 고아 .tmp만 지운다 — 진행 중인 쓰기를 건드리지 않기 위한 안전장치 */
const TMP_STALE_MS = 60 * 60 * 1000

/**
 * 오래된 원본 추출(digest) 캐시 자동 정리 + 고아 tmp 청소.
 * - retentionMonths(기본 12, 0=무제한)보다 오래된 달의 *.digest.json만 삭제한다.
 * - AI 요약(*.summary.json)·기안 캐시는 용량이 미미해 영구 보관.
 * - ~/.claude 원본 로그는 절대 건드리지 않는다 (이 앱은 원본에 대해 읽기 전용).
 */
export async function cleanupOldDigests(now = new Date()): Promise<void> {
  await cleanupStaleTmp()

  const { retentionMonths } = await getSettings()
  if (!retentionMonths || retentionMonths <= 0) return

  // 앱 전체가 KST 고정으로 정규화되어 있으므로 cutoff도 KST로 계산해야 한다.
  // 로컬 타임존 Date 생성자를 쓰면 KST가 아닌 머신에서 월 경계가 한 달 어긋나
  // 아직 보관 기간 안인 원본 캐시를 삭제한다.
  const [ny, nm] = ymOf(kstDateOf(now.getTime())).split('-').map(Number)
  const monthsTotal = ny * 12 + (nm - 1) - retentionMonths
  const cutoffYm = `${Math.floor(monthsTotal / 12)}-${String((monthsTotal % 12) + 1).padStart(2, '0')}`

  let months: string[]
  try {
    months = await readdir(daysRoot())
  } catch {
    return
  }
  for (const ym of months) {
    if (!/^\d{4}-\d{2}$/.test(ym) || ym >= cutoffYm) continue
    let files: string[]
    try {
      files = await readdir(join(daysRoot(), ym))
    } catch {
      continue
    }
    for (const f of files) {
      if (f.endsWith('.digest.json')) {
        try {
          await unlink(join(daysRoot(), ym, f))
        } catch {
          // 삭제 실패는 무시 — 다음 실행에서 재시도된다
        }
      }
    }
  }
}

/**
 * writeJsonAtomic이 남긴 고아 .tmp 청소.
 * 프로세스가 write와 rename 사이에서 죽거나, rename 실패 후 정리까지 실패하면 남는다.
 * 보관 기간 필터 바깥에서 캐시 루트 전체를 훑어야 한다 — tmp는 최신 달에도,
 * days/ 밖(settings.json, periods/, reports/)에도 생긴다.
 */
async function cleanupStaleTmp(): Promise<void> {
  const cutoffMs = Date.now() - TMP_STALE_MS

  /** 이 디렉토리의 .tmp만 지운다 (재귀하지 않음) */
  const sweep = async (dir: string): Promise<void> => {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (!name.endsWith('.tmp')) continue
      const p = join(dir, name)
      try {
        const st = await stat(p)
        if (st.isFile() && st.mtimeMs < cutoffMs) await unlink(p)
      } catch {
        // 무시 — 다음 실행에서 재시도된다
      }
    }
  }

  // 우리가 쓰는 디렉토리만 대상으로 한다. userData 루트를 재귀 순회하면
  // Electron/Chromium 자체 캐시 디렉토리까지 훑게 되므로 하지 않는다.
  await sweep(cacheRoot())
  await sweep(join(cacheRoot(), 'periods'))
  await sweep(join(cacheRoot(), 'reports'))
  let months: string[]
  try {
    months = await readdir(daysRoot())
  } catch {
    return
  }
  for (const ym of months) {
    if (/^\d{4}-\d{2}$/.test(ym)) await sweep(join(daysRoot(), ym))
  }
}
