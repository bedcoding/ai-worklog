/**
 * 실제 ~/.claude 로그와 실제 claude CLI를 사용하는 통합 테스트.
 * CI에서는 돌지 않는다 — 로컬에서 INTEGRATION=1로 실행:
 *   INTEGRATION=1 npx vitest run tests/integration.test.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addDays, kstDateOf } from '@shared/dates'
import { renderDigestText } from '@shared/digest-text'
import { initCache } from '../src/main/cache'
import { claudeVersion, locateClaude } from '../src/main/claude/locate'
import { collectDigests } from '../src/main/pipeline/collector'
import { isActiveDigest } from '../src/main/pipeline/digest'
import { ensureDaySummary } from '../src/main/pipeline/summarizer'
import { setSettings } from '../src/main/settings'

describe.runIf(process.env.INTEGRATION === '1')('통합: 실제 로그 + 실제 claude CLI', () => {
  const today = kstDateOf(Date.now())
  const from = addDays(today, -6)

  it('실제 ~/.claude 로그에서 최근 7일 다이제스트를 수집한다', async () => {
    const { digests, skippedLines } = await collectDigests(from, today)
    console.log(`\n최근 7일 (${from}~${today}) 활동일: ${digests.size}일, 스킵 라인: ${skippedLines}`)
    for (const [date, d] of [...digests.entries()].sort()) {
      console.log(
        `  ${date}: 프로젝트 ${d.projects.length}개, 프롬프트 ${d.totals.promptCount}건, 도구 호출 ${d.totals.toolCallCount}건`
      )
    }
    expect(digests.size).toBeGreaterThan(0)
    const anyActive = [...digests.values()].some(isActiveDigest)
    expect(anyActive).toBe(true)
  }, 60_000)

  it('claude CLI를 찾고 버전을 확인한다', async () => {
    const path = await locateClaude(null)
    const version = await claudeVersion(path)
    console.log(`\nclaude: ${path} (${version})`)
    expect(version).toMatch(/\d+\.\d+/)
  }, 30_000)

  it('실제 claude 호출로 하루 요약을 생성한다 (haiku)', async () => {
    initCache(mkdtempSync(join(tmpdir(), 'worklog-integration-')))
    await setSettings({ model: 'haiku' })

    // 최근 7일 중 가장 최근 활동일을 요약
    const { digests } = await collectDigests(from, today)
    const active = [...digests.entries()]
      .filter(([, d]) => isActiveDigest(d))
      .sort()
      .pop()
    expect(active).toBeDefined()
    const [date, digest] = active!
    console.log(`\n요약 대상: ${date} (다이제스트 ${renderDigestText(digest).length}자)`)

    const summary = await ensureDaySummary(date, { preCollected: digest })
    console.log('요약 결과:', JSON.stringify(summary, null, 2))
    expect(summary.date).toBe(date)
    expect(summary.empty).toBeUndefined()
    expect(summary.fallbackText ?? summary.headline).toBeTruthy()
  }, 240_000)
})
