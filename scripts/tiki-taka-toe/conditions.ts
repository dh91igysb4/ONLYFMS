// 티키타카토 머리칸 조건과 조건별 선수 집합 (설계 docs/superpowers/specs/2026-11-26-tiki-taka-toe-design.md §3.4·§4).
// 축구 CSV(data/football/)를 읽어 조건 목록과 "조건 id → 선수 id 집합"을 만든다. 판 고르기는 generate.ts.
//
// 판정 규칙(설계 §4, 2026-11-26 결정):
// - 모든 집합은 1987년 이후 기록만 쓴다(FROM).
// - 클럽·리그 경력은 "한 시즌이라도 소속"(그 시즌 클럽이 둘이어도 둘 다 센다).
// - 팀 동료 기준 선수는 인지도 80 이상 중 인지도 높은 순 → 클럽 시즌 수 많은 순 150명.
// - 팀 동료·감독(클럽)은 우승과 같은 규칙: 그 시즌 클럽 소속이 둘 이상인 선수의 그 시즌은 세지 않는다(대표팀은 클럽 수에 넣지 않는다).
// - "PL" 우승·득점왕은 프리미어리그(Q9448, 1992~)만. "잉글랜드 1부"는 잉글랜드 대회 중 1부였던 시기
//   (competition_eras.csv: 풋볼리그 1부 Q754839 1987~1991 + PL)를 합친다.
// - 국적은 players.nation_id 하나(이중 국적 없음). 대륙은 manual/nation_continents.csv.
// - 테마(§3.4): 클럽은 대상 유럽 9개 리그 1부(team_competitions × 1부 시기)에 1987년 이후 한 시즌이라도 있던 클럽만,
//   그 리그 테마 + eur. 리그·리그 우승·리그 득점왕·국내 컵 우승은 그 리그 테마 + eur. 나머지는 모든 테마.
//   K리그(대상 유럽 리그 밖 나라의 리그·컵·득점왕)는 어느 테마에도 넣지 않아 조건을 만들지 않는다.
// - 개인상은 honour_catalog의 award만(한글 이름이 있는 것). honours.csv의 카탈로그 밖 상은 쓰지 않는다.
//
// manual/nation_continents.csv(2026-11-26 작성): 위키데이터 P30(대륙)으로 한 번 만들었다. 북중미는 중미·카리브 포함,
// 오세아니아는 Q538·Q55643. 대륙이 여럿이거나 없는 나라는 축구 연맹 기준으로 골랐다: 튀르키예·러시아·카자흐스탄·
// 소련·독립국가연합·이스라엘·아제르바이잔·아르메니아 → 유럽(UEFA), 오스트레일리아 → 아시아(AFC). P30이 없는 지역
// (코르시카·아스투리아스·아라곤·안달루시아·파다니아·올란드·건지섬·서아르메니아) → 유럽, nations.csv에 잘못 들어간
// "캄페오나투 브라질레이루 세리에 C"(Q2037826) → 남미. 수리남·가이아나·프랑스령 기아나는 지리대로 남미다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cmp, parseCsv, type Row } from '../football/wikidata.ts'

export type Theme = 'eng' | 'esp' | 'ita' | 'ger' | 'eur'
export const THEMES: readonly Theme[] = ['eng', 'esp', 'ita', 'ger', 'eur']

export type ConditionKind = 'club' | 'nation' | 'continent' | 'league' | 'teammate' | 'title' | 'squad' | 'award' | 'manager' | 'final_goal'
export type Condition = { id: string; kind: ConditionKind; label_ko: string; label_en: string; ref: string; themes: Theme[] }

export type FootballData = {
  players: Row[]; teams: Row[]; nations: Row[]; competitions: Row[]; competition_eras: Row[]; team_competitions: Row[]
  season_memberships: Row[]
  /** honours.csv + honours_extra.csv를 load.sql 규칙으로 합친 것(mergeHonours) */
  honours: Row[]
  honour_catalog: Row[]; manager_spells: Row[]; nation_continents: Row[]
}

export const CONTINENTS = ['europe', 'south_america', 'north_america', 'africa', 'asia', 'oceania'] as const
const CONTINENT_LABEL: Record<string, [string, string]> = {
  europe: ['유럽', 'Europe'], south_america: ['남미', 'South America'], north_america: ['북중미', 'North & Central America'],
  africa: ['아프리카', 'Africa'], asia: ['아시아', 'Asia'], oceania: ['오세아니아', 'Oceania'],
}

/** 이 해부터의 기록만 쓴다 (season_memberships.csv가 1987년부터) */
export const FROM = 1987
/** 팀 동료 기준 선수: 인지도 이 값 이상인 선수를 인지도 높은 순, 같으면 클럽 시즌 수가 많은 순으로 TEAMMATE_ANCHORS명 */
export const TEAMMATE_MIN_POPULARITY = 80
export const TEAMMATE_ANCHORS = 150

/** 대상 유럽 9개 리그 나라 → 테마. eur만 있는 나라는 [] */
const TARGET_NATIONS: Record<string, Theme[]> = {
  Q21: ['eng'], Q29: ['esp'], Q38: ['ita'], Q183: ['ger'], Q142: [], Q55: [], Q45: [], Q43: [], Q31: [],
}
const ENGLAND = 'Q21'
const PL = 'Q9448'

// 머리칸에 쓰는 짧은 이름 (없으면 카탈로그 이름에서 괄호를 뗀다)
const SHORT_KO: Record<string, string> = {
  Q9448: 'PL', Q18756: 'UCL', Q18760: 'UEL', Q193041: 'AFC 챔스', Q40241: '컵위너스컵', Q19317: '월드컵', Q260858: '유로',
  Q178750: '코파 아메리카', Q157894: '아시안컵', Q794775: 'PL 득점왕',
}
const SHORT_EN: Record<string, string> = {
  Q9448: 'PL', Q18756: 'UCL', Q18760: 'UEL', Q193041: 'AFC CL', Q19317: 'World Cup', Q260858: 'Euro', Q157894: 'Asian Cup',
  Q794775: 'PL Golden Boot',
}
const stripParen = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, '').trim()

/** 이름 끝 글자 받침으로 "과/와" */
export function withParticle(name: string): string {
  const c = name.charCodeAt(name.length - 1)
  if (c >= 0xac00 && c <= 0xd7a3) return name + ((c - 0xac00) % 28 === 0 ? '와' : '과')
  return name + '와'
}

// 한글 클럽 이름에서 떼는 토큰: 대문자 약칭(FC, AFC, SSC…), 점 약칭(F.C., 1.), 독일식(VfL, VfB, SpVgg), 끝의 창단 연도(1846, 1909).
// 가운데 연도("TSV 1860 뮌헨")는 이름의 일부라 둔다. 영문 이름은 끝의 FC류만 뗀다("AVS Futebol SAD"가 "Futebol"이 되지 않게).
const CLUB_AFFIX = /^(?:[A-Z]{1,4}|VfL|VfB|SpVgg|(?:[A-Z]\.){1,4}|\d\.)$/
const CLUB_YEAR = /^1[89]\d\d$/
const LATIN_SUFFIX = new Set(['FC', 'F.C.', 'AFC', 'A.F.C.', 'CF', 'C.F.'])
/** "아스널 FC" → "아스널", "1. FC 하이덴하임 1846" → "하이덴하임", "Arsenal F.C." → "Arsenal". 다 떼면 원래 이름 */
export function clubLabel(name: string): string {
  const t = name.trim().split(/\s+/)
  let kept: string[]
  if (/[가-힣]/.test(name)) {
    kept = t.filter((x) => !CLUB_AFFIX.test(x))
    if (kept.length > 1 && CLUB_YEAR.test(kept[kept.length - 1])) kept.pop()
  } else {
    kept = [...t]
    while (kept.length > 1 && LATIN_SUFFIX.has(kept[kept.length - 1])) kept.pop()
  }
  return kept.length ? kept.join(' ') : name.trim()
}
/** 클럽 머리칸 이름들: 뗀 이름이 겹치거나, 다른 클럽 이름의 앞부분이거나("파리 FC" → "파리"), 나라 이름과 같으면("AS 모나코 FC" → "모나코") 원래 이름 */
function clubLabels(names: ReadonlyMap<string, string>, reserved: ReadonlySet<string>): Map<string, string> {
  const short = new Map([...names].map(([id, n]) => [id, clubLabel(n)]))
  const all = [...short.values()]
  const out = new Map<string, string>()
  for (const [id, l] of short) {
    const full = names.get(id)!.trim()
    const clash = reserved.has(l) || all.filter((x) => x === l).length > 1 || all.some((x) => x.startsWith(`${l} `))
    out.set(id, clash && l !== full ? full : l)
  }
  return out
}

/** 한글 표기에서 성이 앞에 오는 나라(일본·중국·한국·북한·대만·홍콩·마카오): "가가와 신지" → "가가와" */
const FAMILY_FIRST_NATIONS = new Set(['Q17', 'Q148', 'Q884', 'Q423', 'Q865', 'Q8646', 'Q14773'])

const SURNAME_PARTICLES = new Set(['판', '반', '텐', '테어', '델', '데', '디', 'ter', 'van', 'ten', 'del', 'de', 'di', 'da'])
/** "루이 판 할" → "판 할", "아르센 벵거" → "벵거" */
export function surname(full: string): string {
  const t = full.trim().split(/\s+/)
  if (t.length >= 3 && SURNAME_PARTICLES.has(t[t.length - 2])) return t.slice(-2).join(' ')
  return t[t.length - 1]
}

/** load.sql과 같은 규칙: 카탈로그 개인상 행과, honours_extra에 팀 우승이 있는 대회·시즌의 팀 우승 행을 빼고 honours_extra를 더한다 */
export function mergeHonours(honours: readonly Row[], extra: readonly Row[], catalog: readonly Row[]): Row[] {
  const awards = new Set(catalog.filter((c) => c.kind === 'award').map((c) => `award:${c.id}`))
  const fixedTeam = new Set(extra.filter((e) => e.player_id === '').map((e) => `${e.honour}|${e.season}`))
  const kept = honours.filter((h) => !awards.has(h.honour) && !(h.player_id === '' && fixedTeam.has(`${h.honour}|${h.season}`)))
  const out = new Map<string, Row>()
  for (const r of [...kept, ...extra]) {
    const row = { honour: r.honour, season: r.season, team_id: r.team_id, player_id: r.player_id }
    out.set(`${row.honour}|${row.season}|${row.team_id}|${row.player_id}`, row)
  }
  return [...out.values()]
}

function readCsv(file: string): Row[] {
  return parseCsv(readFileSync(file, 'utf8'))
}

export function readFootballData(dir: string): FootballData {
  const f = (name: string) => readCsv(join(dir, `${name}.csv`))
  const honour_catalog = f('honour_catalog')
  return {
    players: f('players'), teams: f('teams'), nations: f('nations'), competitions: f('competitions'),
    competition_eras: f('competition_eras'), team_competitions: f('team_competitions'), season_memberships: f('season_memberships'),
    honours: mergeHonours(f('honours'), f('honours_extra'), honour_catalog), honour_catalog,
    manager_spells: f('manager_spells'), nation_continents: readCsv(join(dir, 'manual', 'nation_continents.csv')),
  }
}

function add<K, V>(m: Map<K, Set<V>>, k: K, v: V) {
  const s = m.get(k)
  if (s) s.add(v); else m.set(k, new Set([v]))
}
function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k)
  if (l) l.push(v); else m.set(k, [v])
}
const sortThemes = (t: Iterable<Theme>) => THEMES.filter((x) => new Set(t).has(x))

export function buildConditions(d: FootballData, opts: { teammateAnchors?: number } = {}): { conditions: Condition[]; players: Map<string, Set<string>> } {
  const conditions: Condition[] = []
  const players = new Map<string, Set<string>>()
  const known = new Set(d.players.map((p) => p.id))
  const emit = (c: Condition, set: Iterable<string>) => {
    const s = new Set([...set].filter((p) => known.has(p)))
    if (s.size === 0 || c.themes.length === 0 || players.has(c.id)) return
    conditions.push(c)
    players.set(c.id, s)
  }
  const teams = new Map(d.teams.map((t) => [t.id, t]))
  const clubIds = new Set(d.teams.filter((t) => t.kind === 'club').map((t) => t.id))
  const catalog = new Map(d.honour_catalog.map((c) => [c.id, c]))
  const ALL = [...THEMES]
  const themesOfNation = (n: string): Theme[] => (n in TARGET_NATIONS ? sortThemes([...TARGET_NATIONS[n], 'eur']) : [])

  // ---- 1부 시기: 대회 → [from, to, nation] (대상 나라만)
  const tier1 = new Map<string, { from: number; to: number; nation: string }[]>()
  for (const e of d.competition_eras) {
    if (e.tier !== '1' || !(e.nation_id in TARGET_NATIONS)) continue
    push(tier1, e.competition_id, { from: Number(e.from_season), to: e.to_season === '' ? Infinity : Number(e.to_season), nation: e.nation_id })
  }
  const tier1Nation = (comp: string, season: number) => tier1.get(comp)?.find((e) => e.from <= season && season <= e.to)?.nation
  // 리그 조건을 따로 만드는 대회: 1987년 이후에도 1부였던 대회 중 잉글랜드 옛 1부(풋볼리그 1부)는 "잉글랜드 1부"로만
  const leagueIds = [...tier1.keys()].filter((c) => tier1.get(c)!.some((e) => e.to >= FROM) && !(tier1Nation(c, FROM) === ENGLAND && c !== PL)).sort(cmp)

  // ---- 시즌 소속 (1987~)
  const mems = d.season_memberships.filter((m) => Number(m.season) >= FROM)
  const clubsOf = new Map<string, string[]>() // player|season → 클럽들
  for (const m of mems) if (clubIds.has(m.team_id)) push(clubsOf, `${m.player_id}|${m.season}`, m.team_id)
  const singleAt = new Map<string, Set<string>>() // team|season → 그 시즌 클럽이 하나인 선수
  const singleSeasons = new Map<string, { season: string; team: string }[]>()
  for (const [k, cs] of clubsOf) {
    if (cs.length !== 1) continue
    const [player, season] = k.split('|')
    add(singleAt, `${cs[0]}|${season}`, player)
    push(singleSeasons, player, { season, team: cs[0] })
  }

  // ---- 클럽
  const clubThemes = new Map<string, Set<Theme>>()
  const leagueTeams = new Map<string, Set<string>>() // `${league}` → team|season
  for (const tc of d.team_competitions) {
    const season = Number(tc.season)
    if (season < FROM) continue
    const nation = tier1Nation(tc.competition_id, season)
    if (!nation) continue
    if (clubIds.has(tc.team_id)) for (const t of themesOfNation(nation)) add(clubThemes, tc.team_id, t)
    const key = `${tc.team_id}|${tc.season}`
    if (leagueIds.includes(tc.competition_id)) add(leagueTeams, tc.competition_id, key)
    if (nation === ENGLAND) add(leagueTeams, 'eng-top', key)
  }
  const atClub = new Map<string, Set<string>>()
  for (const m of mems) add(atClub, m.team_id, m.player_id)
  const clubList = [...clubThemes].filter(([team]) => atClub.has(team)).sort((a, b) => cmp(a[0], b[0]))
  const ko = clubLabels(new Map(clubList.map(([team]) => { const t = teams.get(team)!; return [team, t.name_ko || t.short_name || t.name_en] })), new Set(d.nations.map((n) => n.name_ko)))
  const en = clubLabels(new Map(clubList.map(([team]) => { const t = teams.get(team)!; return [team, t.short_name || t.name_en] })), new Set(d.nations.map((n) => n.name_en)))
  for (const [team, th] of clubList) {
    emit({ id: `club:${team}`, kind: 'club', label_ko: ko.get(team)!, label_en: en.get(team)!, ref: team, themes: sortThemes(th) }, atClub.get(team) ?? [])
  }

  // ---- 국적·대륙
  const byNation = new Map<string, Set<string>>()
  for (const p of d.players) if (p.nation_id) add(byNation, p.nation_id, p.id)
  for (const n of [...d.nations].sort((a, b) => cmp(a.id, b.id))) {
    emit({ id: `nation:${n.id}`, kind: 'nation', label_ko: n.name_ko || n.name_en, label_en: n.name_en, ref: n.id, themes: ALL }, byNation.get(n.id) ?? [])
  }
  const continentOf = new Map(d.nation_continents.map((r) => [r.nation_id, r.continent]))
  const byContinent = new Map<string, Set<string>>()
  for (const p of d.players) { const c = continentOf.get(p.nation_id); if (c) add(byContinent, c, p.id) }
  for (const c of CONTINENTS) {
    emit({ id: `continent:${c}`, kind: 'continent', label_ko: CONTINENT_LABEL[c][0], label_en: CONTINENT_LABEL[c][1], ref: c, themes: ALL }, byContinent.get(c) ?? [])
  }

  // ---- 리그 경력
  const comps = new Map(d.competitions.map((c) => [c.id, c]))
  const leaguePlayers = (key: string) => {
    const ts = leagueTeams.get(key) ?? new Set()
    return mems.filter((m) => ts.has(`${m.team_id}|${m.season}`)).map((m) => m.player_id)
  }
  for (const id of leagueIds) {
    const c = comps.get(id)
    emit({ id: `league:${id}`, kind: 'league', label_ko: c?.name_ko || id, label_en: c?.name_en || id, ref: id, themes: themesOfNation(tier1.get(id)![0].nation) }, leaguePlayers(id))
  }
  emit({ id: 'league:eng-top', kind: 'league', label_ko: '잉글랜드 1부', label_en: 'English top flight', ref: 'eng-top', themes: themesOfNation(ENGLAND) }, leaguePlayers('eng-top'))

  // ---- 팀 동료
  const clubSeasons = new Map<string, number>()
  for (const k of clubsOf.keys()) { const p = k.split('|')[0]; clubSeasons.set(p, (clubSeasons.get(p) ?? 0) + 1) }
  const anchors = d.players
    .filter((p) => Number(p.popularity) >= TEAMMATE_MIN_POPULARITY && clubSeasons.has(p.id))
    .sort((a, b) => Number(b.popularity) - Number(a.popularity) || clubSeasons.get(b.id)! - clubSeasons.get(a.id)! || cmp(a.id, b.id))
    .slice(0, opts.teammateAnchors ?? TEAMMATE_ANCHORS)
  // 감독 머리칸과 같은 성 규칙("즐라탄 이브라히모비치" → "이브라히모비치", 한 단어 이름은 그대로).
  // 성이 앞인 나라는 첫 토큰. 기준 선수끼리 짧은 이름이 겹치면(다비드 실바·치아구 실바) 전체 이름.
  const sorted = anchors.sort((x, y) => cmp(x.id, y.id))
  const shortName = (full: string, nation: string) => {
    const t = full.trim().split(/\s+/)
    return FAMILY_FIRST_NATIONS.has(nation) && t.length > 1 ? t[0] : surname(full)
  }
  const names = sorted.map((a) => {
    const ko = a.name_ko || a.name_en
    return { a, ko, en: a.name_en, sko: shortName(ko, a.nation_id), sen: shortName(a.name_en, a.nation_id) }
  })
  const count = (key: 'sko' | 'sen', v: string) => names.filter((n) => n[key] === v).length
  for (const { a, ko, en, sko, sen } of names) {
    const mates = new Set<string>()
    for (const { season, team } of singleSeasons.get(a.id) ?? []) for (const p of singleAt.get(`${team}|${season}`) ?? []) if (p !== a.id) mates.add(p)
    const lko = count('sko', sko) > 1 ? ko : sko
    const len = count('sen', sen) > 1 ? en : sen
    emit({ id: `teammate:${a.id}`, kind: 'teammate', label_ko: `${withParticle(lko)} 뛴 선수`, label_en: `Played with ${len}`, ref: a.id, themes: ALL }, mates)
  }

  // ---- 우승·대표팀 대회·개인상·결승 득점
  const hs = d.honours.filter((h) => Number(h.season) >= FROM && h.player_id !== '')
  const titleSeasons = new Map<string, Map<string, Set<string>>>() // honour → player → seasons
  const rowsOf = new Map<string, Set<string>>() // squad:/award:/final_goal: → players
  const squadsOf = new Map<string, { season: number; player: string }[]>() // national team → 엔트리
  for (const h of hs) {
    if (h.honour.includes(':')) {
      add(rowsOf, h.honour, h.player_id)
      if (h.honour.startsWith('squad:')) push(squadsOf, h.team_id, { season: Number(h.season), player: h.player_id })
      continue
    }
    let m = titleSeasons.get(h.honour)
    if (!m) titleSeasons.set(h.honour, (m = new Map()))
    add(m, h.player_id, h.season)
  }
  const short = (id: string) => [SHORT_KO[id] ?? stripParen(catalog.get(id)?.name_ko || id), SHORT_EN[id] ?? catalog.get(id)?.name_en ?? id] as const
  const atLeast = (seasons: Map<string, Set<string>> | undefined, n: number) => [...(seasons ?? new Map<string, Set<string>>())].filter(([, s]) => s.size >= n).map(([p]) => p)
  const titleLabel = (ko: string, en: string, n: number) => n === 1 ? [`${ko} 우승`, `${en} winner`] : [`${ko} ${n}회 이상 우승`, `${en} ${n}+ titles`]

  // 리그 우승: 1부 시기 시즌만
  const leagueSeasons = (comps: (c: string, s: number) => boolean) => {
    const out = new Map<string, Set<string>>()
    for (const [honour, m] of titleSeasons) for (const [p, ss] of m) for (const s of ss) if (comps(honour, Number(s))) add(out, p, `${honour}|${s}`)
    return out
  }
  for (const id of leagueIds) {
    const seasons = leagueSeasons((c, s) => c === id && tier1Nation(c, s) !== undefined)
    const [ko, en] = short(id)
    for (const n of [1, 3]) {
      const [lk, le] = titleLabel(ko, en, n)
      emit({ id: `title:${id}:${n}`, kind: 'title', label_ko: lk, label_en: le, ref: id, themes: themesOfNation(tier1.get(id)![0].nation) }, atLeast(seasons, n))
    }
  }
  const engTop = leagueSeasons((c, s) => tier1Nation(c, s) === ENGLAND)
  for (const n of [1, 3]) {
    const [lk, le] = titleLabel('잉글랜드 1부', 'English top flight', n)
    emit({ id: `title:eng-top:${n}`, kind: 'title', label_ko: lk, label_en: le, ref: 'eng-top', themes: themesOfNation(ENGLAND) }, atLeast(engTop, n))
  }
  // 컵·대륙·대표팀 대회 우승 (1회). 국내 컵은 그 나라 리그 테마 + eur(대상 유럽 리그 밖 나라의 컵은 빠진다), 대륙·대표팀 대회는 모든 테마
  for (const c of [...d.honour_catalog].sort((a, b) => cmp(a.id, b.id))) {
    if (!['cup', 'continental', 'international'].includes(c.kind)) continue
    const [ko, en] = short(c.id)
    const [lk, le] = titleLabel(ko, en, 1)
    const themes = c.kind === 'cup' && c.nation_id ? themesOfNation(c.nation_id) : ALL
    emit({ id: `title:${c.id}:1`, kind: 'title', label_ko: lk, label_en: le, ref: c.id, themes }, atLeast(titleSeasons.get(c.id), 1))
    if (c.kind === 'international') {
      emit({ id: `squad:${c.id}`, kind: 'squad', label_ko: `${ko} 출전`, label_en: `${en} squad`, ref: c.id, themes: ALL }, rowsOf.get(`squad:${c.id}`) ?? [])
    }
  }
  for (const c of [...d.honour_catalog].sort((a, b) => cmp(a.id, b.id))) {
    if (c.kind !== 'award') continue
    const themes = c.nation_id ? themesOfNation(c.nation_id) : ALL
    const [ko, en] = short(c.id)
    emit({ id: `award:${c.id}`, kind: 'award', label_ko: ko, label_en: en, ref: c.id, themes }, rowsOf.get(`award:${c.id}`) ?? [])
  }

  // ---- 감독
  const spellsOf = new Map<string, Row[]>()
  for (const s of d.manager_spells) push(spellsOf, s.manager_id, s)
  for (const c of [...d.honour_catalog].sort((a, b) => cmp(a.id, b.id))) {
    if (c.kind !== 'manager') continue
    const set = new Set<string>()
    for (const s of spellsOf.get(c.id) ?? []) {
      const from = Math.max(FROM, Number(s.from_season))
      const to = s.to_season === '' ? Infinity : Number(s.to_season)
      if (clubIds.has(s.team_id)) {
        for (let y = from; y <= Math.min(to, 2100); y++) for (const p of singleAt.get(`${s.team_id}|${y}`) ?? []) set.add(p)
      } else if (teams.get(s.team_id)?.kind === 'national') {
        for (const e of squadsOf.get(s.team_id) ?? []) if (from <= e.season && e.season <= to) set.add(e.player)
      }
    }
    const ko = c.name_ko || c.name_en
    emit({ id: `manager:${c.id}`, kind: 'manager', label_ko: `${surname(ko)} 감독`, label_en: `Played under ${surname(c.name_en)}`, ref: c.id, themes: ALL }, set)
  }

  // ---- 월드컵 결승 득점
  emit({ id: 'final_goal:Q19317', kind: 'final_goal', label_ko: '월드컵 결승 득점', label_en: 'Scored in a World Cup final', ref: 'Q19317', themes: ALL }, rowsOf.get('final_goal:Q19317') ?? [])

  return { conditions, players }
}
