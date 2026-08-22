import { describe, expect, it } from 'vitest'
import { resultOf, splitLines, textDeltaOf } from '../src/main/claude/run'

// 실제 claude 2.1.234 가 --output-format stream-json --include-partial-messages 로
// 내보낸 줄을 그대로 옮겼다. 내 짐작이 아니라 CLI 가 실제로 주는 모양이어야 한다.
const DELTA =
  '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"안녕하세요. \\""}},"session_id":"300c4c96","parent_tool_use_id":null,"uuid":"7f494dbd"}'
const THINKING =
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"사용자가 인사를"}},"session_id":"300c4c96"}'
const SYSTEM = '{"type":"system","subtype":"thinking_tokens","session_id":"300c4c96"}'
const RESULT =
  '{"type":"result","subtype":"success","is_error":false,"duration_api_ms":5695,"result":"안녕하세요","session_id":"300c4c96"}'

describe('textDeltaOf', () => {
  it('본문 조각을 뽑는다', () => {
    expect(textDeltaOf(DELTA)).toBe('안녕하세요. "')
  })

  it('thinking_delta 는 본문이 아니다', () => {
    // 모델이 혼자 생각하는 내용이다. 흘리면 화면에 결과와 무관한 글이 흐른다
    expect(textDeltaOf(THINKING)).toBeNull()
  })

  it('system·result·빈 줄은 본문이 아니다', () => {
    expect(textDeltaOf(SYSTEM)).toBeNull()
    expect(textDeltaOf(RESULT)).toBeNull()
    expect(textDeltaOf('')).toBeNull()
    expect(textDeltaOf('   ')).toBeNull()
  })

  it('깨진 줄은 조용히 버린다', () => {
    // 청크 경계에서 잘린 줄이 여기까지 오면 던지지 말고 넘겨야 한다
    expect(textDeltaOf('{"type":"stream_event","event":{"type":"cont')).toBeNull()
  })
})

describe('resultOf', () => {
  it('최종 봉투를 알아본다', () => {
    expect(resultOf(RESULT)?.result).toBe('안녕하세요')
  })

  it('다른 줄은 null 이다', () => {
    expect(resultOf(DELTA)).toBeNull()
    expect(resultOf(SYSTEM)).toBeNull()
    expect(resultOf('{깨짐')).toBeNull()
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
    // DELTA 를 아무 데서나 둘로 쪼개도 합쳐진 뒤 같은 결과가 나와야 한다
    const cut = Math.floor(DELTA.length / 2)
    let carry = ''
    const texts: string[] = []
    for (const chunk of [DELTA.slice(0, cut), DELTA.slice(cut) + '\n']) {
      const r = splitLines(carry, chunk)
      carry = r.carry
      for (const line of r.lines) {
        const t = textDeltaOf(line)
        if (t !== null) texts.push(t)
      }
    }
    expect(texts).toEqual(['안녕하세요. "'])
  })
})
