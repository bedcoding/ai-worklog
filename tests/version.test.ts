import { describe, expect, it } from 'vitest'
import { compareVersions } from '@shared/version'

describe('버전 비교', () => {
  it('자리마다 숫자로 본다', () => {
    // 문자열로 비교하면 "0.9.0" > "0.11.0" 이 되어 새 버전을 놓친다
    expect(compareVersions('0.11.0', '0.9.0')).toBe(1)
    expect(compareVersions('0.9.0', '0.11.0')).toBe(-1)
  })

  it('앞의 v 는 있어도 없어도 같다', () => {
    // 태그는 v0.1.2, app.getVersion() 은 0.1.2 로 온다
    expect(compareVersions('v0.1.2', '0.1.2')).toBe(0)
    expect(compareVersions('v0.1.3', '0.1.2')).toBe(1)
  })

  it('자리 수가 달라도 비교한다', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBe(1)
    expect(compareVersions('1', '1.0.1')).toBe(-1)
  })

  it('같은 버전은 0', () => {
    expect(compareVersions('0.1.2', '0.1.2')).toBe(0)
  })

  it('숫자가 아닌 자리는 0으로 본다', () => {
    // 태그에 접미사가 붙어도 죽지 않아야 한다. 정확한 판정보다 안 죽는 것이 중요하다
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0)
    expect(compareVersions('1.1.0-beta', '1.0.0')).toBe(1)
  })
})
