import { describe, expect, it } from 'vitest'
import { BRAG_MS, CHAT_GAP_MS, CHAT_MAX, CHAT_MS, EMOTE_MS, EMOTES, bragCard, cleanChat, encodeBrag, encodeChat, encodeEmote, parseShow } from './show.ts'
import { price } from './logic.ts'
import { SPECIES } from './data.ts'

describe('show 형식 (설계 2026-11-25-fishing-brag-discard)', () => {
  it('시간: 자랑 6초, 이모트 3초; 이모트 여섯', () => {
    expect(BRAG_MS).toBe(6000)
    expect(EMOTE_MS).toBe(3000)
    expect(EMOTES.map((e) => e.char)).toEqual(['👍', '😂', '😮', '😭', '❤️', '🎣'])
  })
  it('자랑·이모트 왕복', () => {
    expect(encodeBrag({ species: 'mackerel', sizeCm: 40, perfect: true })).toBe('b:mackerel:40:1')
    expect(parseShow('b:mackerel:40:1')).toEqual({ kind: 'brag', species: 'mackerel', sizeCm: 40, perfect: true })
    expect(parseShow(encodeEmote('lol'))).toEqual({ kind: 'emote', id: 'lol', char: '😂' })
  })
  it('모르는 어종·크기 범위 밖·소수·모양이 틀리면 null', () => {
    const m = SPECIES.find((s) => s.id === 'mackerel')!
    for (const bad of [undefined, '', 'x', 'b:nope:10:0', `b:mackerel:${m.maxCm + 1}:0`, `b:mackerel:${m.minCm - 1}:0`, 'b:mackerel:40.5:0', 'b:mackerel:40:2', 'b:mackerel:40', 'e:nope', 'e:', 'b:__proto__:1:0']) {
      expect(parseShow(bad), String(bad)).toBeNull()
    }
  })
  it('카드: 이름 크기 · 기본 판매가 · 희귀도, 전설·신화는 tone', () => {
    const card = bragCard({ kind: 'brag', species: 'mackerel', sizeCm: 40, perfect: false })
    expect(card.text).toBe(`고등어 40cm · ${price('mackerel', 40, false).toLocaleString('ko-KR')} G · 흔함`)
    expect(card.tone).toBe('common')
    const legend = SPECIES.find((s) => s.rarity === 'legend')!
    expect(bragCard({ kind: 'brag', species: legend.id, sizeCm: legend.minCm, perfect: true }).tone).toBe('legend')
    expect(bragCard({ kind: 'brag', species: 'mackerel', sizeCm: 40, perfect: true }).text).toContain('퍼펙트')
  })
})

describe('말풍선 (설계 2026-11-25-fishing-chat)', () => {
  it('상수: 5초, 40자, 3초에 한 번', () => {
    expect([CHAT_MS, CHAT_MAX, CHAT_GAP_MS]).toEqual([5000, 40, 3000])
  })
  it('cleanChat: 앞뒤 공백·줄바꿈·제어 문자 정리, 40자(코드포인트)로 자름, 비면 null', () => {
    expect(cleanChat('  안녕\n 하세요\t ')).toBe('안녕 하세요')
    expect(cleanChat('a\u0000b‮c')).toBe('abc')
    expect(cleanChat('😀'.repeat(50))).toBe('😀'.repeat(40))
    expect(cleanChat('   ')).toBeNull()
    expect(cleanChat('')).toBeNull()
  })
  it('왕복: 콜론이 들어 있어도 그대로, 받는 쪽도 다시 정리·자른다', () => {
    expect(parseShow(encodeChat('3:2로 이김'))).toEqual({ kind: 'chat', text: '3:2로 이김' })
    expect(parseShow('c:' + 'x'.repeat(60))).toEqual({ kind: 'chat', text: 'x'.repeat(40) })
    expect(parseShow('c:   ')).toBeNull()
  })
})
