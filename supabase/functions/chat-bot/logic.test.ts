// 채팅 봇 순수 로직 테스트 (DB 없음).
import assert from 'node:assert/strict'
import {
  isTriggered, lineText, MAX_BUBBLES, MAX_BUBBLE_CHARS, parseBubbles, pickExamples, seedFrom, tokens, transcript,
  userPrompt, type Example,
} from './logic.ts'

Deno.test('isTriggered: 부분 일치, 대소문자 무시, 빈 부름말 무시', () => {
  assert(isTriggered('야 @재원 이거 봐', ['@재원']))
  assert(isTriggered('재원봇 뭐함', ['재원봇']))
  assert(isTriggered('JWbot hi', ['jwbot']))
  assert(!isTriggered('재 원', ['재원']))
  assert(!isTriggered('아무 말', ['', '  ']))
  assert(!isTriggered(null, ['재원']))
})

Deno.test('tokens: 2글자 이상, 긴 한글은 앞 2글자도 넣는다', () => {
  const t = tokens('토트넘이 또 졌냐 ㅋㅋ VAR')
  assert(t.has('토트넘이'))
  assert(t.has('토트'))
  assert(t.has('졌냐'))
  assert(t.has('var'))
  assert(!t.has('또'))
})

const pool: Example[] = [
  { id: 1, context: '친구1: 토트넘 또 짐', reply: '아니 왜' },
  { id: 2, context: '친구2: 점심 뭐먹음', reply: '국밥' },
  { id: 3, context: '친구3: 레스터 이김', reply: 'ㅗ' },
  { id: 4, context: '친구4: 심판 미쳤네', reply: '주심 뭐함' },
  { id: 5, context: '친구5: 맨유 지네', reply: '개추' },
]

Deno.test('pickExamples: 겹치는 예시가 먼저, 나머지는 시드에 따라 결정적', () => {
  const a = pickExamples(pool, '토트넘 심판 진짜', 7, 2, 2)
  assert.deepEqual(a.length, 4)
  assert.deepEqual(a.slice(0, 2).map((e) => e.id).sort(), [1, 4])
  const b = pickExamples(pool, '토트넘 심판 진짜', 7, 2, 2)
  assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id))
  assert.deepEqual(new Set(a.map((e) => e.id)).size, 4)
})

Deno.test('pickExamples: 겹침이 없으면 무작위만', () => {
  const a = pickExamples(pool, 'zzzz', seedFrom('x'), 3, 2)
  assert.deepEqual(a.length, 2)
})

Deno.test('lineText·transcript: 사진·줄바꿈·봇 이름', () => {
  assert.deepEqual(lineText({ handle: 'a', body: null, image: true, bot: false }), '(사진)')
  assert.deepEqual(lineText({ handle: 'a', body: '  ', image: false, bot: false }), null)
  const t = transcript([
    { handle: 'yong', body: '야\n재원아', image: false, bot: false },
    { handle: null, body: '?', image: false, bot: true },
    { handle: null, body: null, image: false, bot: false },
  ], '재원봇')
  assert.deepEqual(t, 'yong: 야 / 재원아\n재원봇: ?')
})

Deno.test('userPrompt: 예시와 대화가 들어간다', () => {
  const p = userPrompt([pool[0]], 'yong: 재원아', '재원봇')
  assert(p.includes('[재원봇]\n아니 왜'))
  assert(p.endsWith('yong: 재원아'))
})

Deno.test('parseBubbles: 이름표·따옴표·빈 줄 제거, 개수·길이 제한', () => {
  assert.deepEqual(parseBubbles('재원봇: ㅇㄴ\n\n"근데"\n[재원봇]\n재원 : 저건 왜 노카드임', ['재원봇', '재원']),
    ['ㅇㄴ', '근데', '저건 왜 노카드임'])
  const many = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n')
  assert.deepEqual(parseBubbles(many, ['재원봇']).length, MAX_BUBBLES)
  assert.deepEqual(parseBubbles('가'.repeat(400), ['재원봇'])[0].length, MAX_BUBBLE_CHARS)
  assert.deepEqual(parseBubbles('   \n---\n', ['재원봇']), [])
})
