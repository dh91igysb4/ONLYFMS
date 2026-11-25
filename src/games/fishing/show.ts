// 펨타듀 밸리 자랑·이모트의 show 문자열(설계 docs/superpowers/specs/2026-11-25-fishing-brag-discard-design.md).
// 플랫폼 위치 메시지의 show 칸에 실어 보낸다. 보낸 쪽을 믿되 받는 쪽은 모양·어종·크기 범위를 확인한다. 순수 함수만.
import { RARITY_NAMES, SPECIES, type Rarity } from './data.ts'
import { price } from './logic.ts'

/** 자랑(물고기 들기) 시간(ms) */
export const BRAG_MS = 6000
/** 이모트 시간(ms) */
export const EMOTE_MS = 3000

export const EMOTES = [
  { id: 'like', char: '👍' },
  { id: 'lol', char: '😂' },
  { id: 'wow', char: '😮' },
  { id: 'cry', char: '😭' },
  { id: 'love', char: '❤️' },
  { id: 'fish', char: '🎣' },
] as const
export type EmoteId = (typeof EMOTES)[number]['id']

export type Brag = { kind: 'brag'; species: string; sizeCm: number; perfect: boolean }
export type Emote = { kind: 'emote'; id: EmoteId; char: string }
export type Show = Brag | Emote

export const encodeBrag = (f: { species: string; sizeCm: number; perfect: boolean }) => `b:${f.species}:${f.sizeCm}:${f.perfect ? 1 : 0}`
export const encodeEmote = (id: EmoteId) => `e:${id}`

const INT_RE = /^\d{1,4}$/

export function parseShow(s: string | undefined): Show | null {
  if (typeof s !== 'string') return null
  const parts = s.split(':')
  if (parts[0] === 'e' && parts.length === 2) {
    const e = EMOTES.find((x) => x.id === parts[1])
    return e ? { kind: 'emote', id: e.id, char: e.char } : null
  }
  if (parts[0] === 'b' && parts.length === 4) {
    const sp = SPECIES.find((x) => x.id === parts[1])
    if (!sp || !INT_RE.test(parts[2]) || (parts[3] !== '0' && parts[3] !== '1')) return null
    const sizeCm = Number(parts[2])
    if (sizeCm < sp.minCm || sizeCm > sp.maxCm) return null
    return { kind: 'brag', species: sp.id, sizeCm, perfect: parts[3] === '1' }
  }
  return null
}

/** 이름표 아래 카드 한 줄: `고등어 40cm · 1,234 G · 흔함`(퍼펙트면 이름 뒤에 ★퍼펙트). 가격은 버프를 뺀 기본 판매가 */
export function bragCard(b: Brag): { text: string; tone: Rarity } {
  const sp = SPECIES.find((x) => x.id === b.species)!
  const g = price(b.species, b.sizeCm, b.perfect).toLocaleString('ko-KR')
  return { text: `${sp.name}${b.perfect ? ' ★퍼펙트' : ''} ${b.sizeCm}cm · ${g} G · ${RARITY_NAMES[sp.rarity]}`, tone: sp.rarity }
}
