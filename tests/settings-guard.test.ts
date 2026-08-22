import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 설정 소실 방어 회귀 테스트.
 *
 * 윈도우는 강제 파일 락이 있어(맥은 없음) 백신·인덱서가 settings.json을 잡으면 읽기가
 * EBUSY로 실패한다. 그때 기본값을 진실처럼 다루면, 렌더러가 그 기본값 스냅샷을 폼에 담고
 * 나중에 전체를 되돌려 저장해 사번·법인·이름·커스텀 프롬프트가 디스크에서 사라진다.
 * 실제 파일 락은 플랫폼 의존이라, 여기서는 읽기 계층을 대체해 결정 로직만 검증한다.
 */
const mocks = vi.hoisted(() => ({
  readState: vi.fn(),
  writes: [] as Record<string, unknown>[]
}))

vi.mock('../src/main/cache', () => ({
  readJsonState: mocks.readState,
  settingsPath: () => 'fake-settings.json',
  writeJsonAtomic: async (_file: string, data: Record<string, unknown>) => {
    mocks.writes.push(data)
  }
}))

import {
  __resetSettingsCache,
  getSettings,
  getSettingsForEdit,
  setSettings
} from '../src/main/settings'

const STORED = {
  profile: { empNo: 'EMP001', name: '테스트', corp: '테스트법인' },
  dailyAuto: 'silent',
  retentionMonths: 0,
  prompts: { day: 'MY DAY' }
}

beforeEach(() => {
  __resetSettingsCache()
  mocks.readState.mockReset()
  mocks.writes.length = 0
})

describe('설정을 읽지 못한 상태에서는 저장하지 않는다', () => {
  it('편집용 조회는 기본값을 주지 않고 실패한다', async () => {
    mocks.readState.mockResolvedValue({ kind: 'unreadable', code: 'EBUSY' })
    await expect(getSettingsForEdit()).rejects.toThrow('설정 파일을 읽을 수 없습니다')
  })

  it('저장을 거부하고 디스크에 아무것도 쓰지 않는다', async () => {
    mocks.readState.mockResolvedValue({ kind: 'unreadable', code: 'EBUSY' })
    await expect(setSettings({ model: 'haiku' })).rejects.toThrow('설정 파일을 읽을 수 없습니다')
    expect(mocks.writes).toEqual([])
  })

  it('내부 소비자(스케줄러 등)는 기본값으로 계속 동작한다', async () => {
    mocks.readState.mockResolvedValue({ kind: 'unreadable', code: 'EBUSY' })
    const s = await getSettings()
    expect(s.dailyAuto).toBe('off')
    expect(s.profile.empNo).toBe('')
  })

  it('락이 풀리면 회복되고, 저장은 디스크 값 위에 병합된다', async () => {
    mocks.readState.mockResolvedValueOnce({ kind: 'unreadable', code: 'EBUSY' })
    await expect(setSettings({ model: 'haiku' })).rejects.toThrow()

    mocks.readState.mockResolvedValue({ kind: 'ok', value: STORED })
    const saved = await setSettings({ model: 'haiku' })
    expect(saved.model).toBe('haiku')
    // 실제 설정이 살아 있어야 한다
    expect(saved.profile.empNo).toBe('EMP001')
    expect(saved.dailyAuto).toBe('silent')
    expect(saved.retentionMonths).toBe(0)
    expect(saved.prompts.day).toBe('MY DAY')
    expect(mocks.writes).toHaveLength(1)
  })
})

describe('동시 조회가 상태를 갈라놓지 않는다', () => {
  it('진행 중인 읽기를 공유해 읽기가 한 번만 일어난다', async () => {
    // 예전 구현은 동시 호출이 각자 읽어서, 성공한 쪽이 먼저 끝나고 실패한 쪽이 나중에
    // 끝나면 유효한 캐시가 있는데도 래치가 남아 세션 내내 저장이 거부됐다.
    mocks.readState.mockResolvedValue({ kind: 'ok', value: STORED })
    const [a, b, c] = await Promise.all([getSettings(), getSettings(), getSettings()])
    expect(mocks.readState).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('한 번 읽은 뒤에는 일시적 실패가 저장을 막지 않는다', async () => {
    // 성공적으로 읽은 값이 있으면 그것이 진실이다. 이후 읽기가 실패해도 저장은 계속 가능해야 한다
    // (예전 구현은 래치가 한 번 켜지면 프로세스 수명 내내 저장이 거부됐다).
    mocks.readState.mockResolvedValueOnce({ kind: 'ok', value: STORED })
    await getSettings()
    mocks.readState.mockResolvedValue({ kind: 'unreadable', code: 'EBUSY' })
    const saved = await setSettings({ model: 'sonnet' })
    expect(saved.profile.empNo).toBe('EMP001')
    expect(saved.model).toBe('sonnet')
    expect(mocks.writes).toHaveLength(1)
  })
})

describe('깨진 설정 파일', () => {
  it('기본값으로 진행하되 저장은 허용한다 (파일은 별도로 보존된다)', async () => {
    mocks.readState.mockResolvedValue({ kind: 'corrupt' })
    const saved = await setSettings({ model: 'haiku' })
    expect(saved.model).toBe('haiku')
    expect(mocks.writes).toHaveLength(1)
  })

  it('파일이 아예 없으면 기본값에서 시작해 저장한다', async () => {
    mocks.readState.mockResolvedValue({ kind: 'absent' })
    const saved = await setSettings({ model: 'haiku' })
    expect(saved.model).toBe('haiku')
    expect(saved.profile.empNo).toBe('')
    expect(mocks.writes).toHaveLength(1)
  })
})
