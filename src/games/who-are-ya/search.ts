// 선수 이름 검색 (화면 전용, 원본 단독판과 같은 규칙). 순수 함수, React 없음.
import { PLAYERS, TEAMS } from './data.ts'

const SPECIAL: Record<string, string> = {
  'ø': 'o', 'Ø': 'o', 'ß': 'ss', 'ł': 'l', 'Ł': 'l', 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'ı': 'i',
  'đ': 'd', 'Đ': 'd', 'þ': 'th', 'ð': 'd',
}

/** 악센트·특수 문자를 없앤 소문자 영숫자 (공백 하나로 구분) */
export function norm(s: string): string {
  return [...s].map((c) => SPECIAL[c] ?? c).join('').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// 한글 자판 상태로 쳐도 영문으로 (두벌식 자판 위치 매핑)
const JAMO: Record<string, string> = {
  'ㅂ': 'q', 'ㅃ': 'q', 'ㅈ': 'w', 'ㅉ': 'w', 'ㄷ': 'e', 'ㄸ': 'e', 'ㄱ': 'r', 'ㄲ': 'r', 'ㅅ': 't', 'ㅆ': 't',
  'ㅛ': 'y', 'ㅕ': 'u', 'ㅑ': 'i', 'ㅐ': 'o', 'ㅒ': 'o', 'ㅔ': 'p', 'ㅖ': 'p', 'ㅁ': 'a', 'ㄴ': 's', 'ㅇ': 'd',
  'ㄹ': 'f', 'ㅎ': 'g', 'ㅗ': 'h', 'ㅓ': 'j', 'ㅏ': 'k', 'ㅣ': 'l', 'ㅋ': 'z', 'ㅌ': 'x', 'ㅊ': 'c', 'ㅍ': 'v',
  'ㅠ': 'b', 'ㅜ': 'n', 'ㅡ': 'm',
  'ㅘ': 'hk', 'ㅙ': 'ho', 'ㅚ': 'hl', 'ㅝ': 'nj', 'ㅞ': 'np', 'ㅟ': 'nl', 'ㅢ': 'ml', 'ㄳ': 'rt', 'ㄵ': 'sw',
  'ㄶ': 'sg', 'ㄺ': 'fr', 'ㄻ': 'fa', 'ㄼ': 'fq', 'ㄽ': 'ft', 'ㄾ': 'fx', 'ㄿ': 'fv', 'ㅀ': 'fg', 'ㅄ': 'qt',
}
const HL = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const HV = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
const HT = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

/** 완성형 한글·자모를 두벌식 자판의 영문 키로 바꾼다 ("ㅏ묻" → "kane") */
export function deHangul(s: string): string {
  let o = ''
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (c >= 0xac00 && c <= 0xd7a3) {
      const x = c - 0xac00
      o += JAMO[HL[Math.floor(x / 588)]] + JAMO[HV[Math.floor((x % 588) / 28)]] + (x % 28 ? JAMO[HT[x % 28]] : '')
    } else o += JAMO[ch] ?? ch
  }
  return o
}

export type Suggestion = { id: number; name: string; team: string; cc: string; grp: string }

type Entry = Suggestion & { n: string; toks: string[]; flat: string; tier: number }
let index: Entry[] | null = null
function entries(): Entry[] {
  if (!index) {
    index = PLAYERS.map((p) => {
      const n = norm(p[1])
      return { id: p[0], name: p[1], team: TEAMS[p[2]][0], cc: p[3], grp: p[6], tier: p[9], n, toks: n.split(' '), flat: n.replace(/ /g, '') }
    })
  }
  return index
}

/** 전체 데이터에서 이름으로 찾는다 (최대 limit명). 이름 앞부분 일치 → 단어 앞부분 일치 → 부분 일치, 같으면 유명한 선수 먼저 */
export function search(q: string, exclude: ReadonlySet<number>, limit = 8): Suggestion[] {
  const nq = norm(deHangul(q))
  if (!nq) return []
  const qt = nq.split(' ')
  const qf = nq.replace(/ /g, '')
  const out: [number, Entry][] = []
  for (const p of entries()) {
    if (exclude.has(p.id)) continue
    const tokOk = qt.every((t) => p.toks.some((w) => w.startsWith(t)))
    const sub = !tokOk && qf.length >= 3 && p.flat.includes(qf)
    if (!tokOk && !sub) continue
    out.push([(p.n.startsWith(nq) ? 0 : tokOk ? 1 : 2) * 10 + p.tier, p])
  }
  out.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
  return out.slice(0, limit).map(([, p]) => ({ id: p.id, name: p.name, team: p.team, cc: p.cc, grp: p.grp }))
}
