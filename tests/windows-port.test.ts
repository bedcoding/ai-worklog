import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectDigests, cwdKey } from '../src/main/pipeline/collector'
import { buildDigest, newProjectAcc, projectNameOf, type DayAcc } from '../src/main/pipeline/digest'
import { POPUP_HEIGHT, POPUP_WIDTH, popupBounds, type Rect } from '../src/main/popup-bounds'

const CURSOR = { x: 500, y: 500 }

/** 창이 작업영역 안에 완전히 들어왔는지 */
function inside(r: Rect, wa: Rect): boolean {
  return (
    r.x >= wa.x &&
    r.y >= wa.y &&
    r.x + r.width <= wa.x + wa.width &&
    r.y + r.height <= wa.y + wa.height
  )
}

describe('popupBounds — 트레이 팝업이 항상 작업영역 안에 들어온다', () => {
  it('윈도우 하단 작업표시줄: 창을 트레이 위쪽에 놓는다 (실측 기하)', () => {
    // 이 프로젝트를 포팅한 머신의 실측값. 원래 코드는 y=828(화면 높이 823)로 화면 밖에 놓았다.
    const wa: Rect = { x: 0, y: 0, width: 1966, height: 775 }
    const tray: Rect = { x: 1756, y: 775, width: 33, height: 49 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.width).toBe(POPUP_WIDTH)
    expect(r.height).toBe(POPUP_HEIGHT)
    expect(r.y).toBe(149) // 775 - 620 - 6
    expect(inside(r, wa)).toBe(true)
  })

  it('맥 상단 메뉴바: 창을 메뉴바 아래에 놓는다', () => {
    const wa: Rect = { x: 0, y: 25, width: 1440, height: 875 }
    const tray: Rect = { x: 1200, y: 0, width: 24, height: 24 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.y).toBe(31) // 25 + 6
    expect(inside(r, wa)).toBe(true)
  })

  it('작업표시줄이 왼쪽에 있으면 창을 왼쪽에 붙인다', () => {
    const wa: Rect = { x: 60, y: 0, width: 1400, height: 900 }
    const tray: Rect = { x: 0, y: 400, width: 48, height: 48 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.x).toBe(66) // 60 + 6
    expect(inside(r, wa)).toBe(true)
  })

  it('작업표시줄이 오른쪽에 있으면 창을 오른쪽에 붙인다', () => {
    const wa: Rect = { x: 0, y: 0, width: 1400, height: 900 }
    const tray: Rect = { x: 1400, y: 400, width: 48, height: 48 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.x).toBe(974) // 1400 - 420 - 6
    expect(inside(r, wa)).toBe(true)
  })

  // 좌우 배치는 작업영역 원점이 0이 아닌 보조 모니터에서 계산이 어긋나기 쉽다
  it('원점이 0이 아닌 모니터의 왼쪽 작업표시줄', () => {
    const wa: Rect = { x: 1980, y: 0, width: 1400, height: 900 }
    const tray: Rect = { x: 1920, y: 400, width: 48, height: 48 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.x).toBe(1986) // 1980 + 6
    expect(inside(r, wa)).toBe(true)
  })

  it('원점이 음수인 모니터의 오른쪽 작업표시줄', () => {
    const wa: Rect = { x: -1920, y: 0, width: 1400, height: 900 }
    const tray: Rect = { x: -520, y: 400, width: 48, height: 48 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.x).toBe(-946) // -1920 + 1400 - 420 - 6
    expect(inside(r, wa)).toBe(true)
  })

  it('트레이가 화면 우측 끝이어도 x가 화면을 넘지 않는다', () => {
    const wa: Rect = { x: 0, y: 0, width: 1966, height: 775 }
    const tray: Rect = { x: 1940, y: 775, width: 26, height: 49 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.x + r.width).toBeLessThanOrEqual(wa.width)
    expect(inside(r, wa)).toBe(true)
  })

  it('작업영역이 창보다 낮으면 위치가 아니라 높이부터 줄인다', () => {
    // 크기 클램프 없이 위치만 클램프하면 하한이 상한을 넘어 다시 화면을 벗어난다
    const wa: Rect = { x: 0, y: 0, width: 800, height: 360 }
    const tray: Rect = { x: 700, y: 360, width: 33, height: 40 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.height).toBe(348) // 360 - 6*2
    expect(inside(r, wa)).toBe(true)
  })

  it('작업영역이 창보다 좁으면 폭도 줄인다', () => {
    const wa: Rect = { x: 0, y: 0, width: 300, height: 900 }
    const tray: Rect = { x: 250, y: 900, width: 33, height: 40 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.width).toBe(288) // 300 - 6*2
    expect(inside(r, wa)).toBe(true)
  })

  it('작업영역이 여백보다도 좁은 극단에서 음수 크기를 만들지 않는다', () => {
    const wa: Rect = { x: 0, y: 0, width: 10, height: 10 }
    const r = popupBounds({ x: 5, y: 10, width: 4, height: 4 }, wa, CURSOR)
    expect(r.width).toBeGreaterThan(0)
    expect(r.height).toBeGreaterThan(0)
  })

  it('원점이 음수인 보조 모니터에서도 그 모니터 안에 들어온다', () => {
    const wa: Rect = { x: -1920, y: 0, width: 1920, height: 1040 }
    const tray: Rect = { x: -200, y: 1040, width: 33, height: 49 }
    const r = popupBounds(tray, wa, CURSOR)
    expect(r.x).toBe(-426) // -1920 + 1920 - 420 - 6
    expect(inside(r, wa)).toBe(true)
  })

  it('트레이 bounds가 비어 있으면 커서 위치를 기준으로 삼는다', () => {
    const wa: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
    const tray: Rect = { x: 0, y: 0, width: 0, height: 0 }
    const r = popupBounds(tray, wa, { x: 900, y: 900 })
    expect(r.x).toBe(690) // 900 - 210
    expect(inside(r, wa)).toBe(true)
  })

  it('자동 숨김 작업표시줄처럼 트레이가 작업영역과 겹치면 절반 기준으로 배치한다', () => {
    const wa: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
    const upper = popupBounds({ x: 900, y: 100, width: 33, height: 40 }, wa, CURSOR)
    const lower = popupBounds({ x: 900, y: 900, width: 33, height: 40 }, wa, CURSOR)
    expect(upper.y).toBe(6) // 위쪽 절반 → top
    expect(lower.y).toBe(414) // 아래쪽 절반 → bottom (1040 - 620 - 6)
    expect(inside(upper, wa)).toBe(true)
    expect(inside(lower, wa)).toBe(true)
  })
})

// 플랫폼을 인자로 넘겨 맥에서도 win32 규칙을 검증한다.
// process.platform에 의존하면 이 저장소의 주 환경(맥)에서 윈도우 회귀를 전혀 잡지 못한다.
describe('projectNameOf — 프로젝트명은 마지막 경로 조각만 쓴다', () => {
  it('윈도우: 백슬래시와 슬래시 모두 구분자로 본다', () => {
    // 고치기 전에는 경로 전체가 프로젝트명이 되어 사내 제출 증빙까지 흘러갔다
    expect(projectNameOf('D:\\dev\\ai-worklog', 'win32')).toBe('ai-worklog')
    expect(projectNameOf('C:\\Users\\me\\.ownchat\\workspace', 'win32')).toBe('workspace')
    expect(projectNameOf('C:/Users/me/proj', 'win32')).toBe('proj')
  })

  it('윈도우: 드라이브 루트만 있으면 원문을 쓴다', () => {
    expect(projectNameOf('D:\\', 'win32')).toBe('D:\\')
  })

  it('POSIX: 슬래시만 구분자로 본다 (백슬래시는 정상 파일명 문자)', () => {
    expect(projectNameOf('/Users/test/proj', 'darwin')).toBe('proj')
    // 맥에서 'a\b'는 한 디렉토리 이름이므로 잘라서는 안 된다
    expect(projectNameOf('/Users/me/a\\b', 'darwin')).toBe('a\\b')
    expect(projectNameOf('my\\weird dir', 'darwin')).toBe('my\\weird dir')
  })

  it('buildDigest가 이 규칙을 그대로 쓴다', () => {
    const cwd = process.platform === 'win32' ? 'D:\\dev\\proj' : '/Users/test/proj'
    const proj = newProjectAcc(cwd)
    proj.sessions.add('s1')
    proj.prompts = [
      { tsMs: Date.parse('2026-07-19T01:00:00Z'), text: '작업', isSessionFirst: true }
    ]
    const acc: DayAcc = { date: '2026-07-19', projects: new Map([[cwd, proj]]), sources: new Map() }
    expect(buildDigest(acc, 0).projects[0].name).toBe('proj')
  })
})

describe('cwdKey — 윈도우에서만 대소문자를 무시한다', () => {
  it('윈도우: 드라이브 문자 대소문자가 달라도 같은 키', () => {
    expect(cwdKey('D:\\dev\\Foo', 'win32')).toBe(cwdKey('d:\\dev\\foo', 'win32'))
  })

  it('POSIX: 대소문자를 구분한다', () => {
    expect(cwdKey('/Users/me/Foo', 'darwin')).not.toBe(cwdKey('/Users/me/foo', 'darwin'))
    expect(cwdKey('/Users/me/Foo', 'darwin')).toBe('/Users/me/Foo')
  })
})

describe('collector — 같은 프로젝트가 대소문자로 갈라지지 않는다 (호스트 플랫폼 기준)', () => {
  const rec = (cwd: string, ts: string, text: string): string =>
    JSON.stringify({
      type: 'user',
      timestamp: ts,
      cwd,
      sessionId: 's1',
      message: { role: 'user', content: [{ type: 'text', text }] }
    })

  it('한 프로젝트의 두 케이싱 표기를 호스트 규칙대로 묶는다', async () => {
    const base = mkdtempSync(join(tmpdir(), 'worklog-cwdcase-'))
    const dir = join(base, 'projects', 'p1')
    mkdirSync(dir, { recursive: true })
    const [a, b] =
      process.platform === 'win32'
        ? ['D:\\dev\\foo', 'd:\\dev\\foo']
        : ['/Users/me/Foo', '/Users/me/foo']
    writeFileSync(
      join(dir, 's1.jsonl'),
      [rec(a, '2026-07-15T01:00:00.000Z', 'A'), rec(b, '2026-07-15T02:00:00.000Z', 'B')].join('\n')
    )
    const { digests } = await collectDigests('2026-07-15', '2026-07-15', { claudeDir: base })
    const day = digests.get('2026-07-15')
    // 윈도우는 하나로 묶이고, POSIX는 서로 다른 디렉토리이므로 둘로 남는다
    expect(day?.projects.length).toBe(process.platform === 'win32' ? 1 : 2)
    expect(day?.totals.promptCount).toBe(2)
  })
})
