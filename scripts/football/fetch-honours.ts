// 우승·수상·대표팀 엔트리·감독 수집기 (설계 docs/superpowers/specs/2026-11-25-football-honours-design.md).
//
//   npm run football:honours -- [--only Q166177,Q19317] [--no-cache] [--dir data/football] [--as-of 2026-11-25]
//
// 먼저 football:fetch → football:seasons 를 돌려 둔다(시즌 소속 season_memberships.csv를 쓴다).
// 설정 honour_catalog.csv를 읽어 honours_extra.csv·managers.csv·manager_spells.csv를 쓴다. 기존 honours.csv는 건드리지 않는다.
// 카탈로그 줄 하나가 실패해도(문서 없음·파싱 실패) 그 줄만 비고 계속한다. --only면 그 줄만 다시 모으고 나머지 줄의 행은 그대로 둔다.
// 선수 단위 우승(리그 포함)은 매번 팀 우승 전체와 시즌 소속으로 다시 계산한다(§3.1).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { managerSeasons, nationalTitles, playerTitles } from './honours.ts'
import { parseAwardList, parseFinals, parseManagerInfobox, parseSquads, type Hit } from './honourParsers.ts'
import { FILES, sortRows } from './schema.ts'
import { calendarOf, type Membership } from './seasons.ts'
import { log, query, type Cache } from './wdqs.ts'
import { currentSeason, parseCsv, toCsv, type Honour, type Row } from './wikidata.ts'
import { titlesToQids, wikitext } from './wikipedia.ts'
import { sectionText } from './wikitext.ts'

const a = process.argv.slice(2)
const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined }
const dir = get('dir') ?? 'data/football'
const today = get('as-of') ?? new Date().toISOString().slice(0, 10)
const only = get('only') ? new Set(get('only')!.split(',')) : null
const cache: Cache = { dir: get('cache') ?? '.cache/honours', refresh: a.includes('--no-cache') }
mkdirSync(cache.dir, { recursive: true })
const current = currentSeason(new Date(`${today}T00:00:00Z`))

const read = (f: string) => (existsSync(join(dir, f)) ? parseCsv(readFileSync(join(dir, f), 'utf8')) : [])
const catalog = read('honour_catalog.csv')
const teams = read('teams.csv')
const teamById = new Map(teams.map((t) => [t.id, t]))
const players = new Set(read('players.csv').map((p) => p.id))
const clubIds = new Set(teams.filter((t) => t.kind === 'club').map((t) => t.id))
const nationalIds = new Set(teams.filter((t) => t.kind === 'national').map((t) => t.id))

/** 리그 시즌 상(시즌 시작 연도). 나머지 상은 시상 연도 (설계 §3.4) */
const SEASON_AWARDS = new Set(['Q233454'])
const seasonColOf = (c: Row) => (c.nation_id !== '' || SEASON_AWARDS.has(c.id) ? 'start' : 'year')

// ---------------------------------------------------------------- 공용

/** 문서 제목들 → QID: 위키데이터 sitelink로 먼저(빠름), 못 찾은 것만 위키백과 API(리다이렉트) */
async function resolve(titles: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const uniq = [...new Set(titles)].sort()
  for (let i = 0; i < uniq.length; i += 400) {
    const chunk = uniq.slice(i, i + 400)
    const vals = chunk.map((t) => JSON.stringify(t) + '@en').join(' ')
    const rows = await query(`SELECT ?t ?item WHERE { VALUES ?t { ${vals} } ?a schema:name ?t ; schema:isPartOf <https://en.wikipedia.org/> ; schema:about ?item . }`, cache)
    for (const r of rows) out.set(r.t, r.item)
  }
  const rest = uniq.filter((t) => !out.has(t))
  if (rest.length) for (const [t, q] of await titlesToQids(rest, cache)) out.set(t, q)
  return out
}

/** "제목#절"이면 그 절만 */
async function page(spec: string, year?: number): Promise<{ title: string; text: string } | null> {
  const [title, section] = spec.replace('{year}', String(year ?? '')).split('#')
  const p = await wikitext(title, cache)
  if (!p || !section) return p
  const s = sectionText(p.text, section)
  return s === null ? null : { title: p.title, text: s }
}

type Report = { rows: number; dropped: number; note: string[] }
const reports = new Map<string, Report>()
const rep = (id: string) => { let r = reports.get(id); if (!r) reports.set(id, (r = { rows: 0, dropped: 0, note: [] })); return r }

/** 대회 시즌 항목(위키데이터)의 시즌·우승팀. international이면 시즌 = 항목 이름의 연도 */
async function editions(comp: Row): Promise<{ season: number; winner: string | null; label: string }[]> {
  const rows = await query(`SELECT ?e ?eLabel ?when ?start ?end ?w ?of ?rank WHERE {
  ?e wdt:P3450 wd:${comp.id} .
  OPTIONAL { ?e wdt:P585 ?when } OPTIONAL { ?e wdt:P580 ?start } OPTIONAL { ?e wdt:P582 ?end }
  OPTIONAL { ?e p:P1346 ?st . ?st ps:P1346 ?w . OPTIONAL { ?st pq:P642 ?of } OPTIONAL { ?st pq:P1352 ?rank } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}`, cache)
  const nat = comp.kind === 'international'
  const cal = nat ? 'year' : calendarOf(comp.nation_id || undefined)
  const by = new Map<string, { season: number; winners: Set<string>; label: string }>()
  for (const r of rows) {
    // 시즌: 항목 이름의 연도가 가장 믿을 만하다("2019–20 UEFA Champions League"는 예선이 6월에 시작해도 2019, "UEFA Euro 2020"은 2021년에 열려도 2020)
    let season: number | null = null
    const range = /\b((?:19|20)\d{2})\s*[–\-/]\s*(\d{2}|\d{4})\b/.exec(r.eLabel ?? '')
    const single = /\b(19|20)\d{2}\b/.exec(r.eLabel ?? '')
    if (range) season = Number(range[1])
    else if (single) season = Number(single[0])
    else {
      const d = r.start || r.when || r.end
      if (d) { const y = Number(d.slice(0, 4)), mo = Number(d.slice(5, 7)); season = nat || cal === 'year' ? y : mo >= 7 ? y : y - 1 }
    }
    if (season === null) continue
    const e = by.get(r.e) ?? { season, winners: new Set<string>(), label: r.eLabel ?? '' }
    by.set(r.e, e)
    const okRank = !r.rank || r.rank === '1'
    if (r.w && !r.of && okRank && teamById.has(r.w)) e.winners.add(r.w)
  }
  const out: { season: number; winner: string | null; label: string }[] = []
  for (const e of by.values()) {
    if (e.season < Number(comp.from) || e.season > current) continue
    if (e.winners.size > 1) { rep(comp.id).note.push(`${e.season} 우승팀 후보 ${e.winners.size}개(건너뜀)`); out.push({ season: e.season, winner: null, label: e.label }); continue }
    out.push({ season: e.season, winner: [...e.winners][0] ?? null, label: e.label })
  }
  return out.sort((x, y) => x.season - y.season)
}

// ---------------------------------------------------------------- 종류별 수집

async function collectCup(c: Row): Promise<Honour[]> {
  const eds = await editions(c)
  const out: Honour[] = eds.filter((e) => e.winner).map((e) => ({ honour: c.id, season: String(e.season), team_id: e.winner!, player_id: '' }))
  const have = new Set(out.map((h) => h.season))
  if (c.page) {
    const p = await page(c.page)
    if (!p) rep(c.id).note.push(`문서 없음: ${c.page}`)
    else {
      const hits = parseFinals(p.text, { from: Number(c.from), seasonCol: calendarOf(c.nation_id || undefined) === 'year' ? 'year' : 'start' })
        .filter((h) => !have.has(String(h.season)) && h.season <= current)
      const q = await resolve(hits.map((h) => h.link))
      for (const h of hits) {
        const t = q.get(h.link)
        if (t && teamById.has(t)) { out.push({ honour: c.id, season: String(h.season), team_id: t, player_id: '' }); have.add(String(h.season)) }
        else rep(c.id).note.push(`${h.season} 우승팀 ${h.link} 우리 DB에 없음`)
      }
    }
  }
  return out
}

async function collectInternational(c: Row): Promise<Honour[]> {
  const eds = await editions(c)
  const out: Honour[] = []
  for (const e of eds) {
    if (e.winner && nationalIds.has(e.winner)) out.push({ honour: c.id, season: String(e.season), team_id: e.winner, player_id: '' })
    if (!c.page) continue
    const p = await page(c.page, e.season)
    if (!p) { rep(c.id).note.push(`문서 없음: ${c.page.replace('{year}', String(e.season))}`); continue }
    const squads = parseSquads(p.text)
    if (!squads.length) { rep(c.id).note.push(`파싱 실패: ${p.title}`); continue }
    const q = await resolve([...squads.map((s) => `${s.team} national football team`), ...squads.flatMap((s) => s.players)])
    for (const s of squads) {
      const team = q.get(`${s.team} national football team`)
      if (!team || !nationalIds.has(team)) { rep(c.id).note.push(`${e.season} ${s.team} 대표팀 없음`); continue }
      for (const pl of s.players) {
        const id = q.get(pl)
        if (id && players.has(id)) out.push({ honour: `squad:${c.id}`, season: String(e.season), team_id: team, player_id: id })
        else rep(c.id).dropped++
      }
    }
  }
  return out
}

async function collectAward(c: Row): Promise<Honour[]> {
  if (!c.page) { rep(c.id).note.push('문서 제목(page) 없음'); return [] }
  const p = await page(c.page)
  if (!p) { rep(c.id).note.push(`문서 없음: ${c.page}`); return [] }
  const hits: Hit[] = parseAwardList(p.text, { from: Number(c.from), seasonCol: seasonColOf(c) }).filter((h) => h.season <= current)
  if (!hits.length) { rep(c.id).note.push(`파싱 실패: ${p.title}`); return [] }
  const q = await resolve(hits.map((h) => h.link))
  const out: Honour[] = []
  for (const h of hits) {
    const id = q.get(h.link)
    if (id && players.has(id)) out.push({ honour: `award:${c.id}`, season: String(h.season), team_id: '', player_id: id })
    else rep(c.id).dropped++
  }
  return out
}

type Spell = { manager_id: string; team_id: string; from_season: string; to_season: string; source_url: string }
async function collectManager(c: Row): Promise<Spell[]> {
  const p = await page(c.page || c.name_en)
  if (!p) { rep(c.id).note.push(`문서 없음: ${c.page || c.name_en}`); return [] }
  const stints = parseManagerInfobox(p.text)
  if (!stints.length) { rep(c.id).note.push(`정보상자 감독 경력 없음: ${p.title}`); return [] }
  const q = await resolve(stints.map((s) => s.club))
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`
  const by = new Map<string, Spell>()
  for (const s of stints) {
    const team = q.get(s.club)
    const t = team && teamById.get(team)
    if (!t) { rep(c.id).dropped++; continue }
    const cal = t.kind === 'national' ? 'year' : calendarOf(t.nation_id || undefined)
    const { from_season, to_season } = managerSeasons(s.from, s.to, cal, current)
    if (to_season < Number(c.from)) continue
    const k = `${team}|${from_season}`
    const prev = by.get(k)
    if (!prev || Number(prev.to_season) < to_season) by.set(k, { manager_id: c.id, team_id: team!, from_season: String(from_season), to_season: String(to_season), source_url: url })
  }
  return [...by.values()]
}

// ---------------------------------------------------------------- 실행

const catId = (honour: string) => honour.replace(/^(award|squad|final_goal):/, '')
const isDerived = (h: Row) => !/^(award|squad|final_goal):/.test(h.honour) && h.player_id !== ''

const oldExtra = read('honours_extra.csv') as unknown as Honour[]
const oldSpells = read('manager_spells.csv') as unknown as Spell[]
const keep = (id: string) => only !== null && !only.has(id)
const extra: Honour[] = oldExtra.filter((h) => !isDerived(h as unknown as Row) && keep(catId(h.honour)) && !h.honour.startsWith('final_goal:'))
const spells: Spell[] = oldSpells.filter((s) => keep(s.manager_id))

for (const c of catalog) {
  if (only && !only.has(c.id)) continue
  if (c.source === 'existing') continue
  log(`${c.kind} ${c.name_en} …`)
  try {
    const rows = c.kind === 'cup' || c.kind === 'continental' ? await collectCup(c)
      : c.kind === 'international' ? await collectInternational(c)
      : c.kind === 'award' ? await collectAward(c) : []
    if (c.kind === 'manager') { const s = await collectManager(c); spells.push(...s); rep(c.id).rows += s.length }
    extra.push(...rows); rep(c.id).rows += rows.length
  } catch (e) {
    rep(c.id).note.push(`실패: ${(e as Error).message.slice(0, 160)}`)
  }
}

// 월드컵 결승 득점자(직접 입력)
for (const r of read('manual/world_cup_final_scorers.csv')) extra.push({ honour: 'final_goal:Q19317', season: r.season, team_id: r.team_id, player_id: r.player_id })

// 선수 단위 우승: 리그(기존 honours.csv) + 컵·대륙 팀 우승 × 시즌 소속, 대표팀 대회 우승팀 엔트리
const leagueIds = new Set(catalog.filter((c) => c.kind === 'league').map((c) => c.id))
const cupIds = new Set(catalog.filter((c) => c.kind === 'cup' || c.kind === 'continental').map((c) => c.id))
const teamWins = [
  ...(read('honours.csv') as unknown as Honour[]).filter((h) => leagueIds.has(h.honour) && h.player_id === ''),
  ...extra.filter((h) => cupIds.has(h.honour) && h.player_id === ''),
]
const memberships = read('season_memberships.csv') as unknown as Membership[]
extra.push(...playerTitles(teamWins, memberships, clubIds))
extra.push(...nationalTitles(extra.filter((h) => h.honour.startsWith('squad:')), extra.filter((h) => h.player_id === '')))

// 쓰기 (키 중복 제거, 정렬)
const uniq = <T extends object>(rows: T[], key: (r: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()]
const extraOut = uniq(extra, (h) => `${h.honour}|${h.season}|${h.team_id}|${h.player_id}`)
const spellOut = uniq(spells, (s) => `${s.manager_id}|${s.team_id}|${s.from_season}`)
const managers = catalog.filter((c) => c.kind === 'manager' && spellOut.some((s) => s.manager_id === c.id)).map((c) => ({ id: c.id, name_en: c.name_en }))
writeFileSync(join(dir, 'honours_extra.csv'), toCsv(FILES.honours_extra.columns, sortRows('honours_extra', extraOut) as unknown as Record<string, unknown>[]))
writeFileSync(join(dir, 'manager_spells.csv'), toCsv(FILES.manager_spells.columns, sortRows('manager_spells', spellOut) as unknown as Record<string, unknown>[]))
writeFileSync(join(dir, 'managers.csv'), toCsv(FILES.managers.columns, sortRows('managers', managers) as unknown as Record<string, unknown>[]))

log('\n카탈로그 줄별 결과')
for (const c of catalog) {
  const r = reports.get(c.id)
  if (!r) continue
  log(`  ${c.name_en}: 행 ${r.rows}, 버린 선수·팀 ${r.dropped}${r.note.length ? ` — ${r.note.slice(0, 6).join(' / ')}${r.note.length > 6 ? ` 외 ${r.note.length - 6}` : ''}` : ''}`)
}
const derived = extraOut.filter((h) => isDerived(h as unknown as Row)).length
log(`\nhonours_extra ${extraOut.length}행 (선수 우승 ${derived}), manager_spells ${spellOut.length}행, managers ${managers.length}명`)
