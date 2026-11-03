// 채팅 봇의 순수 로직: 부를지 판단, 말투 예시 고르기, 프롬프트 만들기, 답 쪼개기 (설계 2026-11-03-chat-bot §4).
// 외부 의존 없음. handler.ts가 DB·Anthropic 호출을 맡는다.

export type ChatLine = { handle: string | null; body: string | null; image: boolean; bot: boolean }
export type Example = { id: number; context: string; reply: string }

/** 봇 답 한 번에 보내는 말풍선 최대 개수 */
export const MAX_BUBBLES = 6
/** daily_chat_body_len과 같다 */
export const MAX_BUBBLE_CHARS = 300
/** 프롬프트에 넣는 최근 채팅 줄 수 */
export const TRANSCRIPT_LINES = 30
/** 관련 예시 + 무작위 예시 */
export const RELATED_EXAMPLES = 16
export const RANDOM_EXAMPLES = 10

/** 부름 말이 들어 있는가 (대소문자·앞뒤 공백 무시, 부분 일치) */
export function isTriggered(body: string | null, triggers: string[]): boolean {
  if (!body) return false
  const b = body.toLowerCase()
  return triggers.some((t) => t.trim() !== '' && b.includes(t.trim().toLowerCase()))
}

/** 한글·영문·숫자 2글자 이상 덩어리. 조사 정도는 앞 2~3글자 접두로 흡수한다. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) ?? []) {
    out.add(w)
    if (/^[가-힣]{3,}$/.test(w)) out.add(w.slice(0, 2))
  }
  return out
}

/** 결정적 의사 난수 (mulberry32). 같은 시드면 같은 예시가 뽑힌다 → 테스트 가능 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * 최근 대화와 단어가 많이 겹치는 예시 related개 + 나머지에서 무작위 random개.
 * 겹침이 0인 예시는 관련 예시로 치지 않는다.
 */
export function pickExamples(
  pool: Example[], recentText: string, seed: number,
  related = RELATED_EXAMPLES, random = RANDOM_EXAMPLES,
): Example[] {
  const want = tokens(recentText)
  const scored = pool
    .map((e) => {
      let s = 0
      for (const t of tokens(e.context + ' ' + e.reply)) if (want.has(t)) s += t.length >= 3 ? 2 : 1
      return { e, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.id - b.e.id)
  const chosen = scored.slice(0, related).map((x) => x.e)
  const taken = new Set(chosen.map((e) => e.id))
  const rest = pool.filter((e) => !taken.has(e.id))
  const r = rng(seed)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [...chosen, ...rest.slice(0, random)]
}

export function lineText(l: ChatLine): string | null {
  const body = l.body?.trim() ? l.body.trim().replace(/\s*\n\s*/g, ' / ') : null
  if (!body && !l.image) return null
  return [body, l.image ? '(사진)' : null].filter(Boolean).join(' ')
}

/** 최근 대화(오래된 것 → 최신)를 "이름: 말" 줄로. 봇 글은 봇 이름으로 */
export function transcript(lines: ChatLine[], botHandle: string): string {
  return lines
    .slice(-TRANSCRIPT_LINES)
    .map((l) => {
      const t = lineText(l)
      if (!t) return null
      return `${l.bot ? botHandle : l.handle ?? '누군가'}: ${t}`
    })
    .filter((x): x is string => x !== null)
    .join('\n')
}

export function userPrompt(examples: Example[], convo: string, botHandle: string): string {
  const ex = examples
    .map((e) => `[대화]\n${e.context}\n[${botHandle}]\n${e.reply}`)
    .join('\n\n')
  return [
    '아래는 실제 단톡방에서 이 사람이 했던 말의 예시다. 말투만 참고하고, 내용을 그대로 베끼지 않는다.',
    '',
    ex,
    '',
    '---',
    '지금 대화방 상황이다. 마지막 메시지에 이어서 ' + botHandle + '가 보낼 말풍선만 출력한다.',
    '',
    convo,
  ].join('\n')
}

/** 모델 출력 → 말풍선 목록. 이름표·따옴표·빈 줄을 걷고 개수와 길이를 자른다 */
export function parseBubbles(text: string, names: string[]): string[] {
  const label = new RegExp(`^\\s*(?:\\[?(?:${names.map(escapeRe).join('|')})\\]?\\s*[:：]\\s*)`)
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(label, '').trim())
    .map((l) => l.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim())
    .filter((l) => l !== '' && !/^\[.*\]$/.test(l) && l !== '---')
    .slice(0, MAX_BUBBLES)
    .map((l) => (l.length > MAX_BUBBLE_CHARS ? l.slice(0, MAX_BUBBLE_CHARS) : l))
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
