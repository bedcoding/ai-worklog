import { describe, expect, it } from 'vitest'
import type { SchedulerRun } from '@shared/types'
import { MAX_RECENT, nextSchedulerState } from '../src/main/scheduler-history'

/** 실행일과 대상이 같은 경우 (dailySubject: 'today') */
function run(date: string, outcome: SchedulerRun['outcome'] = 'ok'): SchedulerRun {
  return { at: `${date}T01:00:00.000Z`, ranOn: date, date, outcome, ms: 1000 }
}

/** 어제치를 오늘 요약한 경우 (dailySubject: 'yesterday') */
function runYesterday(ranOn: string, date: string): SchedulerRun {
  return { at: `${ranOn}T01:00:00.000Z`, ranOn, date, outcome: 'ok', ms: 1000 }
}

describe('자동 실행 이력', () => {
  it('실패는 실행일을 올리지 않는다', () => {
    // 실패한 날의 날짜가 남으면 catch-up 이 그날 다시 시도하지 않아
    // 하루치 요약이 조용히 빈다
    const prev = { lastAutoRunDate: '2026-08-25' }
    const next = nextSchedulerState(prev, run('2026-08-26', 'error'), false)
    expect(next.lastAutoRunDate).toBe('2026-08-25')
    expect(next.recent?.[0].outcome).toBe('error')
  })

  it('성공은 실행일을 올린다', () => {
    const next = nextSchedulerState({ lastAutoRunDate: '2026-08-25' }, run('2026-08-26'), true)
    expect(next.lastAutoRunDate).toBe('2026-08-26')
  })

  it('건너뛰기도 실행일을 올린다', () => {
    // 같은 날 반복해서 묻지 않기 위해서다
    const next = nextSchedulerState({}, run('2026-08-26', 'skipped'), true)
    expect(next.lastAutoRunDate).toBe('2026-08-26')
  })

  it('최신이 앞에 오고 기존 이력을 보존한다', () => {
    const prev = { recent: [run('2026-08-25')] }
    const next = nextSchedulerState(prev, run('2026-08-26'), true)
    expect(next.recent?.map((r) => r.date)).toEqual(['2026-08-26', '2026-08-25'])
  })

  it(`${MAX_RECENT}개를 넘으면 오래된 것부터 버린다`, () => {
    const prev = {
      recent: Array.from({ length: MAX_RECENT }, (_, i) =>
        run(`2026-07-${String(i + 1).padStart(2, '0')}`)
      )
    }
    const next = nextSchedulerState(prev, run('2026-08-26'), true)
    expect(next.recent).toHaveLength(MAX_RECENT)
    expect(next.recent?.[0].date).toBe('2026-08-26')
    expect(next.recent?.some((r) => r.date === '2026-07-14')).toBe(false)
  })

  it('어제치를 요약해도 실행일은 오늘로 남는다', () => {
    // 요약 대상(어제)을 남기면 "오늘은 아직 안 돌았다"로 판정되어
    // 같은 날 15분마다 계속 다시 돈다
    const next = nextSchedulerState({}, runYesterday('2026-08-26', '2026-08-25'), true)
    expect(next.lastAutoRunDate).toBe('2026-08-26')
    expect(next.recent?.[0].date).toBe('2026-08-25')
  })

  it('ranOn 이 없는 옛 기록은 date 를 실행일로 본다', () => {
    // 대상 설정이 생기기 전에는 둘이 늘 같았다
    const legacy = { at: '2026-08-20T01:00:00.000Z', date: '2026-08-20', outcome: 'ok', ms: 1 }
    const next = nextSchedulerState({}, legacy as SchedulerRun, true)
    expect(next.lastAutoRunDate).toBe('2026-08-20')
  })

  it('상태 파일의 다른 필드를 지우지 않는다', () => {
    // 통째로 덮어쓰던 예전 동작이 되살아나면 이력이 날아간다
    const prev = { lastAutoRunDate: '2026-08-25', recent: [run('2026-08-25')] }
    const next = nextSchedulerState(prev, run('2026-08-26', 'error'), false)
    expect(next.recent).toHaveLength(2)
    expect(next.lastAutoRunDate).toBe('2026-08-25')
  })
})
