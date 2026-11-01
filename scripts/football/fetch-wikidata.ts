// 위키데이터에서 단계 1 데이터(선수·팀·국가·경력·국가대표·수상)를 받아 data/football/*.csv로 쓴다.
// 설계 docs/superpowers/specs/2026-10-31-football-data-design.md §4·§8. 사용법은 data/football/README.md.
//
//   npm run football:fetch -- [--from 2016] [--to 2025] [--leagues Q9448,Q19510] [--limit-teams 5] [--no-cache]
//
// 위키데이터 공식 질의 서비스(query.wikidata.org)만 쓴다. 한 번에 한 요청, 요청 사이 1초 간격.
// 응답은 .cache/wikidata/에 보관해 중간에 멈춰도 다시 돌리면 이어서 진행한다.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEAGUES, type League } from './leagues.ts'
import {
  applyLeagueNations, applyNamesKo, buildAliases, cmp, buildAwards, buildCaps, buildNations, buildPlayers, buildSeasons, buildSpells, buildTeams,
  coverage, flat, mergeTeamComps, parseCsv, qAliases, qAwards, qLeagueClubs, qNations, qPlayerDetails, qPlayersAtTeams,
  qSeasons, qSpells, qTeams, toCsv, type Binding, type Row, type Team,
} from './wikidata.ts'

const ENDPOINT = 'https://query.wikidata.org/sparql'
const UA = process.env.WIKIDATA_UA ?? 'ONLYFMS-data/0.1 (https://github.com/dh91igysb4/ONLYFMS; football quiz for friends)'

// ---------------------------------------------------------------- 인자

function args() {
  const a = process.argv.slice(2)
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined }
  const now = new Date()
  const current = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
  const to = Number(get('to') ?? current)
  const from = Number(get('from') ?? to - 9)
  const only = get('leagues')?.split(',')
  const leagues = only ? LEAGUES.filter((l) => only.includes(l.id)) : LEAGUES
  if (only && leagues.length !== only.length) throw new Error(`모르는 리그: ${only.filter((q) => !LEAGUES.some((l) => l.id === q)).join(', ')} (scripts/football/leagues.ts)`)
  const limit = get('limit-teams')
  return {
    from, to, leagues,
    limitTeams: limit ? Number(limit) : Infinity,
    out: get('out') ?? 'data/football',
    cacheDir: a.includes('--no-cache') ? null : (get('cache') ?? '.cache/wikidata'),
  }
}

// ---------------------------------------------------------------- 질의

class QueryTimeout extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...m: unknown[]) => console.error(...m)

async function query(sparql: string, cacheDir: string | null): Promise<Row[]> {
  const file = cacheDir && join(cacheDir, `${createHash('sha1').update(sparql).digest('hex')}.json`)
  if (file && existsSync(file)) return (JSON.parse(readFileSync(file, 'utf8')) as Binding[]).map(flat)
  for (let attempt = 0; ; attempt++) {
    await sleep(1000)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query: sparql }),
    })
    if (res.ok) {
      const bindings = (await res.json() as { results: { bindings: Binding[] } }).results.bindings
      if (file) writeFileSync(file, JSON.stringify(bindings))
      return bindings.map(flat)
    }
    const body = await res.text()
    // 질의 시간 초과(60초)는 다시 보내도 같으므로 묶음을 나눠 보내게 한다
    if (/TimeoutException|upstream request timeout/i.test(body)) throw new QueryTimeout()
    if (attempt >= 5 || ![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`위키데이터 ${res.status}: ${body.slice(0, 300)}`)
    const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * 2 ** attempt
    log(`  ${res.status}, ${wait / 1000}초 뒤 다시 시도`)
    await sleep(wait)
  }
}

/** 목록을 size개씩 나눠 질의한다. 시간 초과면 그 묶음을 반으로 나눠 다시 보낸다 */
async function batched(label: string, items: readonly string[], size: number, build: (chunk: string[]) => string, cacheDir: string | null): Promise<Row[]> {
  const out: Row[] = []
  const run = async (chunk: string[]): Promise<void> => {
    try {
      out.push(...await query(build(chunk), cacheDir))
    } catch (e) {
      if (!(e instanceof QueryTimeout)) throw e
      if (chunk.length === 1) { log(`  ${label}: ${chunk[0]} 시간 초과, 건너뜀`); return }
      const mid = chunk.length >> 1
      await run(chunk.slice(0, mid))
      await run(chunk.slice(mid))
    }
  }
  const sorted = [...items].sort()
  for (let i = 0; i < sorted.length; i += size) {
    log(`${label} ${Math.min(i + size, sorted.length)}/${sorted.length}`)
    await run(sorted.slice(i, i + size))
  }
  return out
}

// ---------------------------------------------------------------- 실행

function readManual(dir: string, name: string): Row[] {
  const f = join(dir, 'manual', name)
  return existsSync(f) ? parseCsv(readFileSync(f, 'utf8')) : []
}

function printCoverage(tc: ReturnType<typeof mergeTeamComps>, leagues: readonly League[], from: number, to: number) {
  log(`\n시즌별 참가팀 수 (${from}~${to}, 빈칸·16 미만은 data/football/manual/team_competitions.csv로 채운다)`)
  for (const { league, counts } of coverage(tc, leagues, from, to)) {
    log(`  ${league.name_ko.padEnd(10)} ${counts.map((n) => (n === 0 ? ' --' : String(n).padStart(3)) + (n > 0 && n < 16 ? '!' : ' ')).join('')}`)
  }
}

async function main() {
  const o = args()
  if (o.cacheDir) mkdirSync(o.cacheDir, { recursive: true })
  mkdirSync(o.out, { recursive: true })
  log(`리그 ${o.leagues.length}개, 시즌 ${o.from}~${o.to}`)

  // 1. 시즌별 참가팀·우승
  const seasons = buildSeasons(await query(qSeasons(o.leagues, o.from, o.to), o.cacheDir))
  const leagueIds = new Set(o.leagues.map((l) => l.id))
  const teamComps = mergeTeamComps(seasons.teamComps, readManual(o.out, 'team_competitions.csv').filter((r) => leagueIds.has(r.competition_id)))
  printCoverage(teamComps, o.leagues, o.from, o.to)

  // 2. 선수를 찾을 팀: 시즌 참가팀 + 지금 리그 소속 클럽
  const clubs = await query(qLeagueClubs(o.leagues), o.cacheDir)
  let seedTeams = [...new Set([...teamComps.map((t) => t.team_id), ...clubs.map((r) => r.team)])].sort()
  if (seedTeams.length > o.limitTeams) seedTeams = seedTeams.slice(0, o.limitTeams)
  log(`\n대상 팀 ${seedTeams.length}개`)

  // 3. 기간 안에 그 팀에 있었던 선수
  const playerIds = [...new Set((await batched('선수 찾기', seedTeams, 20, (c) => qPlayersAtTeams(c, o.from, o.to), o.cacheDir)).map((r) => r.p))]
  log(`선수 ${playerIds.length}명`)

  // 4. 선수의 전체 경력과 그 경력에 나오는 팀
  const spellRows = await batched('경력', playerIds, 100, qSpells, o.cacheDir)
  const teamIds = [...new Set([...spellRows.map((r) => r.team), ...seedTeams, ...seasons.honours.map((h) => h.team_id)])]
  const teams = buildTeams(await batched('팀', teamIds, 150, qTeams, o.cacheDir))
  applyLeagueNations(teams, teamComps, o.leagues)
  const teamMap = new Map<string, Team>(teams.map((t) => [t.id, t]))
  const { spells, national, dropped } = buildSpells(spellRows, teamMap)
  const caps = buildCaps(national)
  log(`경력 ${spells.length}개, 국가대표 ${caps.length}개 (유스·2군·날짜 없음으로 뺀 구간 ${dropped}개)`)

  // 5. 선수 정보·수상
  const { players, transfermarkt } = buildPlayers(await batched('선수 정보', playerIds, 100, qPlayerDetails, o.cacheDir), caps, teamMap)
  const awards = buildAwards(await batched('수상', playerIds, 200, qAwards, o.cacheDir))

  // 6. 국가
  const keptTeams = teams.filter((t) => t.kind !== 'other')
  const nationIds = [...new Set([...players.map((p) => p.nation_id), ...keptTeams.map((t) => t.nation_id), ...o.leagues.map((l) => l.nation_id)].filter(Boolean))]
  const nations = buildNations(await batched('국가', nationIds, 200, qNations, o.cacheDir))

  // 7. 직접 입력한 한글 이름, 검색용 별칭
  const namesKo = readManual(o.out, 'names_ko.csv')
  const fixed = applyNamesKo(players, namesKo) + applyNamesKo(keptTeams, namesKo) + applyNamesKo(nations, namesKo)
  const aliases = buildAliases([...players, ...keptTeams], await batched('별칭', [...playerIds, ...keptTeams.map((t) => t.id)], 200, qAliases, o.cacheDir))

  // 8. 쓰기 (팀은 유스·2군 제외, 경력·시즌 참가팀은 남은 팀만)
  const keptIds = new Set(keptTeams.map((t) => t.id))
  const write = (name: string, csv: string) => writeFileSync(join(o.out, name), csv)
  write('competitions.csv', toCsv(['id', 'name_ko', 'name_en', 'kind', 'nation_id', 'tier'], o.leagues.map((l) => ({ ...l, kind: 'league' }))))
  write('nations.csv', toCsv(['id', 'name_ko', 'name_en', 'iso2', 'confederation'], nations))
  write('teams.csv', toCsv(['id', 'kind', 'name_ko', 'name_en', 'short_name', 'nation_id', 'colors', 'founded', 'retired'], keptTeams))
  write('team_competitions.csv', toCsv(['team_id', 'competition_id', 'season'], teamComps.filter((t) => keptIds.has(t.team_id))))
  write('players.csv', toCsv(['id', 'name_ko', 'name_en', 'birth_date', 'birth_precision', 'nation_id', 'position', 'position_detail', 'foot', 'height_cm', 'shirt_number', 'popularity', 'retired'], players))
  write('aliases.csv', toCsv(['entity_id', 'alias', 'lang'], aliases))
  write('external_ids.csv', toCsv(['entity_id', 'source', 'external_id'], [...transfermarkt].sort().map(([entity_id, external_id]) => ({ entity_id, source: 'transfermarkt', external_id }))))
  write('spells.csv', toCsv(['player_id', 'team_id', 'start_date', 'end_date', 'date_precision', 'loan', 'apps', 'goals', 'source_ref'], spells))
  write('caps.csv', toCsv(['player_id', 'team_id', 'caps', 'goals', 'first_year', 'last_year'], caps))
  const honours = [...seasons.honours.filter((h) => keptIds.has(h.team_id)), ...awards]
    .sort((a, b) => cmp(a.honour, b.honour) || cmp(a.season, b.season) || cmp(a.team_id + a.player_id, b.team_id + b.player_id))
  write('honours.csv', toCsv(['honour', 'season', 'team_id', 'player_id'], honours))

  const noKo = players.filter((p) => !p.name_ko).length
  const noPos = players.filter((p) => !p.position).length
  log(`\n완료: ${o.out}/`)
  log(`  선수 ${players.length}명 (한글 이름 없음 ${noKo}, 포지션 없음 ${noPos}), 팀 ${keptTeams.length}개, 국가 ${nations.length}개`)
  log(`  경력 ${spells.length}, 국가대표 ${caps.length}, 수상·우승 ${honours.length}, 별칭 ${aliases.length}, 직접 입력 한글 이름 적용 ${fixed}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
