import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { daysRoot } from './cache'
import { getSettings } from './settings'

/**
 * 오래된 원본 추출(digest) 캐시 자동 정리.
 * - retentionMonths(기본 12, 0=무제한)보다 오래된 달의 *.digest.json만 삭제한다.
 * - AI 요약(*.summary.json)·기안 캐시는 용량이 미미해 영구 보관.
 * - ~/.claude 원본 로그는 절대 건드리지 않는다 (이 앱은 원본에 대해 읽기 전용).
 */
export async function cleanupOldDigests(now = new Date()): Promise<void> {
  const { retentionMonths } = await getSettings()
  if (!retentionMonths || retentionMonths <= 0) return

  const cutoff = new Date(now.getFullYear(), now.getMonth() - retentionMonths, 1)
  const cutoffYm = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`

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
