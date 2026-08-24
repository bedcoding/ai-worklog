import { describe, expect, it } from 'vitest'
import { classifyLine, splitLines } from '../src/main/claude/run'

// 실제 claude 2.1.234가 --output-format stream-json --include-partial-messages로
// 내보낸 줄을 그대로 옮겼다. 내 짐작이 아니라 CLI가 실제로 주는 모양이어야 한다.
const DELTA =
  '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"안녕하세요. \\""}},"session_id":"300c4c96","parent_tool_use_id":null,"uuid":"7f494dbd"}'
const THINKING =
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"사용자가 인사를"}},"session_id":"300c4c96"}'
const TOKENS =
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":340,"estimated_tokens_delta":2,"session_id":"300c4c96"}'
const SYSTEM = '{"type":"system","subtype":"init","session_id":"300c4c96","model":"claude-sonnet-4"}'
const RESULT =
  '{"type":"result","subtype":"success","is_error":false,"duration_api_ms":5695,"result":"안녕하세요","session_id":"300c4c96"}'

describe('classifyLine', () => {
  it('본문 조각을 뽑는다', () => {
    expect(classifyLine(DELTA)).toEqual({ kind: 'text', text: '안녕하세요. "' })
  })

  it('생각 조각을 본문과 다른 종류로 가른다', () => {
    // 같은 종류로 주면 생각 내용이 요약 본문 자리에 섞여 들어간다
    expect(classifyLine(THINKING)).toEqual({ kind: 'thinking', text: '사용자가 인사를' })
  })

  it('최종 봉투를 알아본다', () => {
    const r = classifyLine(RESULT)
    expect(r.kind).toBe('result')
    expect(r.kind === 'result' && r.envelope.result).toBe('안녕하세요')
  })

  it('생각 토큰 누계를 뽑는다', () => {
    // 실측: 이 이벤트가 5초부터 온다. 본문 첫 글자는 55초라 그 사이 유일한 숫자다
    expect(classifyLine(TOKENS)).toEqual({ kind: 'tokens', count: 340 })
  })

  it('쓰지 않는 system 이벤트와 빈 줄은 other 다', () => {
    expect(classifyLine(SYSTEM).kind).toBe('other')
    expect(classifyLine('').kind).toBe('other')
    expect(classifyLine('   ').kind).toBe('other')
  })

  it('깨진 줄은 던지지 않고 other 다', () => {
    // 청크 경계에서 잘린 줄이 여기까지 오면 예외 없이 넘겨야 한다
    expect(classifyLine('{"type":"stream_event","event":{"type":"cont').kind).toBe('other')
    expect(classifyLine('{깨짐').kind).toBe('other')
  })
})

describe('splitLines', () => {
  it('완전한 줄만 넘기고 나머지는 들고 있는다', () => {
    const r = splitLines('', 'a\nb\nc')
    expect(r.lines).toEqual(['a', 'b'])
    expect(r.carry).toBe('c')
  })

  it('앞 청크의 남은 조각과 이어붙인다', () => {
    // 이것이 안 되면 줄이 반으로 갈릴 때마다 그 조각을 통째로 흘린다
    const a = splitLines('', '{"type":"stream_ev')
    expect(a.lines).toEqual([])
    const b = splitLines(a.carry, 'ent"}\n')
    expect(b.lines).toEqual(['{"type":"stream_event"}'])
    expect(b.carry).toBe('')
  })

  it('한 줄이 세 청크에 걸쳐도 이어붙인다', () => {
    let carry = ''
    const got: string[] = []
    for (const chunk of ['{"a"', ':1', '}\n']) {
      const r = splitLines(carry, chunk)
      carry = r.carry
      got.push(...r.lines)
    }
    expect(got).toEqual(['{"a":1}'])
  })

  it('개행이 없으면 아무 줄도 넘기지 않는다', () => {
    expect(splitLines('', 'abc')).toEqual({ lines: [], carry: 'abc' })
  })

  it('실제 조각을 청크 중간에서 잘라도 본문이 온전하다', () => {
    // DELTA를 아무 데서나 둘로 쪼개도 합쳐진 뒤 같은 결과가 나와야 한다
    const cut = Math.floor(DELTA.length / 2)
    let carry = ''
    const texts: string[] = []
    for (const chunk of [DELTA.slice(0, cut), DELTA.slice(cut) + '\n']) {
      const r = splitLines(carry, chunk)
      carry = r.carry
      for (const line of r.lines) {
        const ev = classifyLine(line)
        if (ev.kind === 'text') texts.push(ev.text)
      }
    }
    expect(texts).toEqual(['안녕하세요. "'])
  })
})
