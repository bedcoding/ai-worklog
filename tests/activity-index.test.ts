import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { todayKst } from '@shared/dates'
import { activityPath, daysRoot, initCache, writeJsonAtomic } from '../src/main/cache'
import { activeDatesInRange } from '../src/main/pipeline/activity'

/**
 * 원본 로그를 흉내낸 디렉토리.
 * 실제 ~/.claude 는 500MB 라 테스트에서 읽으면 안 된다.
 */
function fakeLogs(byDate: Record<string, boolean>): string {
  const base = mkdtempSync(join(tmpdir(), 'worklog-activity-'))
  const lines: string[] = []
  for (const [date, active] of Object.entries(byDate)) {
    if (!active) continue
    // KST 12:00 = UTC 03:00. 날짜 경계에서 흔들리지 않는 시각을 쓴다
    lines.push(
      JSON.stringify({
        type: 'user',
        timestamp: `${date}T03:00:00.000Z`,
        cwd: '/proj/a',
        sessionId: `s-${date}`,
        message: { role: 'user', content: [{ type: 'text', text: '작업' }] }
      })
    )
  }
  const f = join(base, 'projects', 'proj-a', 'sess.jsonl')
  mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(f, `${lines.join('\n')}\n`)
  return base
}

function readIndexRaw(ym: string): { version: number; days: Record<string, boolean> } {
  return JSON.parse(readFileSync(activityPath(ym), 'utf8'))
}

let claudeDir = ''

beforeEach(() => {
  initCache(mkdtempSync(join(tmpdir(), 'worklog-cache-')))
  // 7/1 활동, 7/2 없음, 7/3 활동, 7/4 없음, 7/5 활동
  claudeDir = fakeLogs({
    '2026-07-01': true,
    '2026-07-02': false,
    '2026-07-03': true,
    '2026-07-04': false,
    '2026-07-05': true
  })
})

describe('활동 인덱스', () => {
  it('처음에는 원본을 훑고, 두 번째부터는 저장된 것을 읽는다', async () => {
    const first = await activeDatesInRange('2026-07-01', '2026-07-05', { claudeDir })
    expect(first.dates).toEqual(['2026-07-01', '2026-07-03', '2026-07-05'])
    expect(first.cache).toMatchObject({ cachedDays: 0, scannedDays: 5 })

    const second = await activeDatesInRange('2026-07-01', '2026-07-05', { claudeDir })
    expect(second.dates).toEqual(first.dates)
    // 지난 날짜뿐인 구간이므로 원본을 한 번도 읽지 않는다
    expect(second.cache).toMatchObject({ cachedDays: 5, scannedDays: 0 })
    expect(second.cache.builtAt).toBeTruthy()
  })

  it('활동이 없던 날도 기억한다. 그러지 않으면 매번 다시 훑는다', async () => {
    await activeDatesInRange('2026-07-01', '2026-07-05', { claudeDir })
    const idx = readIndexRaw('2026-07')
    expect(idx.days['2026-07-02']).toBe(false)
    expect(idx.days['2026-07-03']).toBe(true)
    // '모른다'와 '활동 없다'는 다르다. 키가 있어야 아는 것이다
    expect(Object.keys(idx.days).sort()).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05'
    ])
  })

  it('오늘은 저장하지 않는다. 아직 끝나지 않은 하루다', async () => {
    const today = todayKst()
    const r = await activeDatesInRange(today, today, { claudeDir })
    // 오늘은 늘 원본에서 읽는다
    expect(r.cache).toMatchObject({ cachedDays: 0, scannedDays: 1 })
    expect(() => readIndexRaw(today.slice(0, 7))).toThrow()
  })

  it('다시 읽기는 저장된 것을 무시하고 원본을 훑는다', async () => {
    await activeDatesInRange('2026-07-01', '2026-07-05', { claudeDir })
    const again = await activeDatesInRange('2026-07-01', '2026-07-05', {
      claudeDir,
      refresh: true
    })
    expect(again.cache).toMatchObject({ cachedDays: 0, scannedDays: 5 })
    expect(again.dates).toEqual(['2026-07-01', '2026-07-03', '2026-07-05'])
  })

  it('판정 로직이 바뀌어 버전이 안 맞으면 저장된 것을 버린다', async () => {
    // 참/거짓만 남기므로, 판정이 바뀌면 저장된 값이 조용히 틀려진다
    await writeJsonAtomic(activityPath('2026-07'), {
      version: 0,
      builtAt: '2026-07-06T00:00:00.000Z',
      days: { '2026-07-01': false, '2026-07-03': false, '2026-07-05': false }
    })
    const r = await activeDatesInRange('2026-07-01', '2026-07-05', { claudeDir })
    expect(r.cache).toMatchObject({ cachedDays: 0, scannedDays: 5 })
    expect(r.dates).toEqual(['2026-07-01', '2026-07-03', '2026-07-05'])
  })

  it('원본 로그가 사라져도 요약해 둔 날짜는 목록에 남는다', async () => {
    // Claude Code 가 옛 세션 로그를 자체 보존 기간에 따라 지운 상황
    const empty = fakeLogs({})
    await writeJsonAtomic(join(daysRoot(), '2026-07', '2026-07-09.summary.json'), {
      date: '2026-07-09',
      digestHash: 'h',
      model: 'default',
      generatedAt: '2026-07-10T00:00:00.000Z',
      headline: '작업'
    })
    const r = await activeDatesInRange('2026-07-01', '2026-07-31', { claudeDir: empty })
    // 원본에는 아무것도 없다. 요약 캐시만으로 살아남은 것이어야 한다
    expect(r.dates).toEqual(['2026-07-09'])
  })

  it('구간이 두 달에 걸치면 달마다 따로 저장한다', async () => {
    const logs = fakeLogs({ '2026-06-29': true, '2026-07-02': true })
    const r = await activeDatesInRange('2026-06-28', '2026-07-03', { claudeDir: logs })
    expect(r.dates).toEqual(['2026-06-29', '2026-07-02'])
    expect(readIndexRaw('2026-06').days['2026-06-29']).toBe(true)
    expect(readIndexRaw('2026-07').days['2026-07-02']).toBe(true)
    expect(readIndexRaw('2026-06').days['2026-07-02']).toBeUndefined()
  })
})
