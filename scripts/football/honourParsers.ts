// 위키백과 문서 종류별 추출 (설계 2026-11-25-football-honours-design.md §3.3). 순수 함수만.
// 표 문서(수상자 목록, 역대 결승): 시즌 칸이 있는 행마다 "시즌 칸 뒤 첫 링크"를 수상자·우승팀으로 본다.
//   수상자 표는 선수 칸이 클럽 칸보다 앞이고, 결승 표는 우승팀 칸이 점수·준우승 칸보다 앞이라 같은 규칙이 맞는다.
//   순위 칸이 2위 이하인 행(발롱도르 2nd/3rd)과 "Not awarded" 행은 뺀다.
import { normalizeTitle, plainText, stripComments, stripRefs, tables, templateArgs, templates, wikiLinks } from './wikitext.ts'

export type Hit = { season: number; link: string }
export type SeasonOpts = { from: number; seasonCol: 'start' | 'year' }

const SEASON = /^(\d{4})(?:\s*[–\-/]\s*(\d{4}|\d{2}))?\b/
const RANK_BELOW_FIRST = /^(2nd|3rd|\d+th|second|third)$/i

/** 칸 원문에서 시즌 번호. start: 범위의 앞 해, year: 범위면 끝 해 */
function seasonOf(cell: string, col: SeasonOpts['seasonCol']): number | null {
  const m = SEASON.exec(plainText(cell))
  if (!m) return null
  const a = Number(m[1])
  if (a < 1850 || a > 2100) return null
  if (!m[2] || col === 'start') return a
  return m[2].length === 2 ? Number(String(a).slice(0, 2) + m[2]) + (Number(m[2]) < a % 100 ? 100 : 0) : Number(m[2])
}

/** 칸의 첫 링크. {{sortname|이름|성|링크|정렬키}}도 링크로 본다 */
function firstLink(cell: string): string | null {
  let s = stripRefs(stripComments(cell))
  // {{sort|키|{{sortname|…}}}}처럼 다른 틀 안에 있어도 찾는다: 안쪽부터 링크로 바꾼다
  for (;;) {
    const i = s.search(/\{\{\s*sortname\s*\|/i)
    if (i < 0) break
    let depth = 0, j = i
    for (; j < s.length - 1; j++) {
      if (s[j] === '{' && s[j + 1] === '{') { depth++; j++ } else if (s[j] === '}' && s[j + 1] === '}') { depth--; j++; if (depth === 0) break }
    }
    const b = s.slice(i, j + 1)
    const { positional, named } = templateArgs(b)
    const [first = '', last = '', link = ''] = positional
    const dab = named.get('dab')
    const target = link.trim() || `${first.trim()} ${last.trim()}`.trim() + (dab ? ` (${dab})` : '')
    s = s.slice(0, i) + `[[${target}]]` + s.slice(j + 1)
  }
  return wikiLinks(s)[0] ?? null
}

function seasonTable(t: string, opts: SeasonOpts, preferSortname = false): Hit[] {
  const out: Hit[] = []
  const seen = new Set<string>()
  for (const table of tables(t)) {
    for (const row of table) {
      const si = row.findIndex((c) => seasonOf(c, opts.seasonCol) !== null)
      if (si < 0) continue
      const season = seasonOf(row[si], opts.seasonCol)!
      if (season < opts.from) continue
      const rest = row.slice(si + 1)
      if (rest.some((c) => /not awarded|no award|cancelled|abandoned/i.test(plainText(c)))) continue
      if (rest.some((c) => RANK_BELOW_FIRST.test(plainText(c)))) continue
      // 수상자 표: {{sortname}} 칸이 있으면 그 칸이 선수다(클럽 칸이 앞에 오는 표 대비). 없으면 링크가 있는 첫 칸
      const sortCell = preferSortname ? rest.find((c) => /\{\{\s*sortname\s*\|/i.test(c)) : undefined
      // 결승 표: 굵게 표시한 팀이 있으면 그 팀이 우승팀(두 경기 결승 표는 홈·원정 순서라 첫 링크가 우승팀이 아니다)
      const boldCell = preferSortname ? undefined : rest.find((c) => /'''\s*\[\[/.test(c))
      const cell = sortCell ?? boldCell ?? rest.find((c) => firstLink(c) !== null)
      if (!cell) continue
      // 공동 수상자가 한 칸에 <hr/>·<br/>로 나뉘어 있으면 모두 (수상자 표만)
      const parts = preferSortname ? cell.split(/<hr\s*\/?>|<br\s*\/?>/i) : [cell]
      for (const part of parts) {
        const link = firstLink(part)
        if (!link) continue
        const k = `${season}|${link}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ season, link })
      }
    }
  }
  return out
}

/** 수상자 목록 표 */
export function parseAwardList(t: string, opts: SeasonOpts): Hit[] {
  return seasonTable(t, opts, true)
}

/** 역대 결승·우승 표. 시즌당 하나(첫 행)만 */
export function parseFinals(t: string, opts: SeasonOpts): Hit[] {
  const out: Hit[] = []
  const seen = new Set<number>()
  for (const h of seasonTable(t, opts)) if (!seen.has(h.season)) { seen.add(h.season); out.push(h) }
  return out
}

/** 엔트리 문서: 나라 절마다 선수 틀(nat fs player, National football squad player)의 name= 링크 */
export function parseSquads(t: string): { team: string; players: string[] }[] {
  const out: { team: string; players: string[] }[] = []
  const lines = stripComments(t).split('\n')
  let team: string | null = null, body: string[] = []
  const flush = () => {
    if (team === null) return
    const players: string[] = []
    for (const b of templates(body.join('\n'), /^(nat fs (g |r )?player|national football squad player)$/i)) {
      const name = templateArgs(b).named.get('name')
      const link = name ? wikiLinks(name)[0] : undefined
      if (link && !players.includes(link)) players.push(link)
    }
    if (players.length) out.push({ team, players })
  }
  for (const line of lines) {
    const h = /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(line)
    if (h) { flush(); team = plainText(h[2]); body = [] } else body.push(line)
  }
  flush()
  return out
}

/** 정보상자 감독 경력: manager(_)yearsN · manager(_)clubsN */
export function parseManagerInfobox(t: string): { club: string; from: number; to: number | null; caretaker: boolean }[] {
  const s = stripRefs(stripComments(t))
  const field = (kind: 'years' | 'clubs') => {
    const m = new Map<number, string>()
    for (const x of s.matchAll(new RegExp(`\\|\\s*manager_?${kind}(\\d+)\\s*=([^\\n]*)`, 'gi'))) m.set(Number(x[1]), x[2].trim())
    return m
  }
  const years = field('years'), clubs = field('clubs')
  const out: { club: string; from: number; to: number | null; caretaker: boolean }[] = []
  for (const n of [...clubs.keys()].sort((a, b) => a - b)) {
    const clubRaw = clubs.get(n)!, yr = plainText(years.get(n) ?? '')
    const club = wikiLinks(clubRaw)[0]
    const ys = [...yr.matchAll(/\d{4}/g)].map((x) => Number(x[0]))
    if (!club || !ys.length) continue
    // 코치·유스·2군 경력은 감독 재임이 아니다(예: 안첼로티 이탈리아 1992–95 수석코치, 뢰브 독일 2004–06 코치)
    if (/assistant|youth|reserves?\b|\bU-?\d{2}\b|under-\d{2}/i.test(plainText(clubRaw).replace(club, ''))) continue
    const open = /[–\-—]\s*$|present/i.test(yr)
    out.push({ club: normalizeTitle(club), from: ys[0], to: ys.length > 1 ? ys[1] : open ? null : ys[0], caretaker: /caretaker|interim/i.test(clubRaw) })
  }
  return out
}

/**
 * 정보상자 선수 경력(성인 클럽만): yearsN · clubsN. youthyears·national_years·manageryears는 이름이 달라 잡히지 않는다.
 * "→ [[클럽]] (loan)"은 임대. 링크 없는 칸(Total 등)과 연도 없는 칸은 뺀다. "2014–"·"present"는 아직 소속(to = null).
 */
export function parsePlayerInfobox(t: string): { club: string; from: number; to: number | null; loan: boolean }[] {
  const s = stripRefs(stripComments(t))
  const field = (kind: 'years' | 'clubs') => {
    const m = new Map<number, string>()
    for (const x of s.matchAll(new RegExp(`\\|\\s*${kind}(\\d+)\\s*=([^\\n]*)`, 'gi'))) m.set(Number(x[1]), x[2].trim())
    return m
  }
  const years = field('years'), clubs = field('clubs')
  const out: { club: string; from: number; to: number | null; loan: boolean }[] = []
  for (const n of [...clubs.keys()].sort((a, b) => a - b)) {
    const clubRaw = clubs.get(n)!, yr = plainText(years.get(n) ?? '')
    const club = wikiLinks(clubRaw)[0]
    const ys = [...yr.matchAll(/\d{4}/g)].map((x) => Number(x[0]))
    if (!club || !ys.length) continue
    const open = /[–\-—]\s*$|present/i.test(yr)
    out.push({ club: normalizeTitle(club), from: ys[0], to: ys.length > 1 ? ys[1] : open ? null : ys[0], loan: /→|\(loan\)/i.test(clubRaw) })
  }
  return out
}
