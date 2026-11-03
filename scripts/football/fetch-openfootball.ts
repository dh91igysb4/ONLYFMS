// openfootball 경기 일정에서 리그·시즌별 참가팀을 받아 data/football/openfootball/team_competitions.csv로 쓴다.
// 설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §3.5. 사용법은 data/football/README.md.
//
//   npm run football:openfootball -- [--to 2026] [--seasons 3] [--leagues Q9448,Q15804] [--no-cache] [--merge]
//
// 팀 이름은 이미 수집한 teams.csv·aliases.csv로 위키데이터 QID에 잇는다(그래서 football:fetch를 한 번 돌린 뒤에 쓴다).
// 못 잇거나 애매한 이름은 openfootball/unmatched.csv에 남기고, manual/openfootball_teams.csv에 ID를 적어 다시 돌린다.
// 결과(openfootball/*.csv)는 다음 football:fetch가 합친다(그 팀 선수까지 수집). 명단이 다 이어진 시즌은 openfootball이 기준이고
// 위키데이터에만 있는 팀은 빠지며, 그중 같은 이름의 다른 ID는 remap.csv로 우승 기록 ID를 옮긴다(설계 §3.5).
// --merge는 수집을 다시 돌리지 않고 지금 CSV(team_competitions·honours·teams 등)에 바로 반영한다.
//
// 받는 곳은 raw.githubusercontent.com/openfootball (퍼블릭 도메인). 응답은 .cache/openfootball/에 보관한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LEAGUES } from './leagues.ts'
import { buildIndex, combineTeamComps, completeSeasons, matchTeam, OF_SOURCES, parseJsonTeams, parseTxtTeams, readOverrides, sourceUrls, type SeasonInfo } from './openfootball.ts'
import { checkDataset, FILE_NAMES, FILES, sortRows, type Dataset } from './schema.ts'
import { cmp, currentSeason, mergeTeamComps, parseCsv, seasonWindows, toCsv, type Row, type TeamCompetition } from './wikidata.ts'

const log = (...m: unknown[]) => console.error(...m)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function args() {
  const a = process.argv.slice(2)
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined }
  const to = Number(get('to') ?? currentSeason(new Date()))
  const seasons = get('seasons')
  const override = seasons === undefined ? undefined : Number(seasons)
  if (override !== undefined && !(Number.isInteger(override) && override >= 1)) throw new Error(`--seasons는 1 이상의 정수: ${seasons}`)
  const only = get('leagues')?.split(',')
  const supported = LEAGUES.filter((l) => OF_SOURCES[l.id])
  const leagues = only ? supported.filter((l) => only.includes(l.id)) : supported
  if (only && leagues.length !== only.length) throw new Error(`openfootball에 없는 리그: ${only.filter((q) => !supported.some((l) => l.id === q)).join(', ')} (scripts/football/openfootball.ts OF_SOURCES)`)
  return {
    leagues, windows: seasonWindows(leagues, to, override),
    dir: get('out') ?? 'data/football',
    cacheDir: a.includes('--no-cache') ? null : (get('cache') ?? '.cache/openfootball'),
    merge: a.includes('--merge'),
  }
}

const MISSING = '\u0000missing'

/** 파일 하나를 받는다. 없으면(404) null. 없음도 캐시한다(--no-cache로 다시 확인) */
async function download(url: string, path: string, cacheDir: string | null): Promise<string | null> {
  const file = cacheDir && join(cacheDir, path)
  if (file && existsSync(file)) { const t = readFileSync(file, 'utf8'); return t === MISSING ? null : t }
  for (let attempt = 0; ; attempt++) {
    await sleep(200)
    const res = await fetch(url, { headers: { 'User-Agent': 'ONLYFMS-data/0.1 (https://github.com/dh91igysb4/ONLYFMS)' } })
    if (res.ok || res.status === 404) {
      const text = res.ok ? await res.text() : null
      if (file) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text ?? MISSING) }
      return text
    }
    if (attempt >= 4) throw new Error(`openfootball ${res.status}: ${url}`)
    await sleep(2000 * 2 ** attempt)
  }
}

const readCsv = (f: string): Row[] => (existsSync(f) ? parseCsv(readFileSync(f, 'utf8')) : [])

async function main() {
  const o = args()
  const teams = readCsv(join(o.dir, 'teams.csv'))
  if (!teams.length) throw new Error(`${o.dir}/teams.csv가 없습니다. 먼저 npm run football:fetch`)
  const aliases = readCsv(join(o.dir, 'aliases.csv'))
  const wd = readCsv(join(o.dir, 'team_competitions.csv')) as unknown as TeamCompetition[]
  const spells = new Map<string, number>()
  for (const s of readCsv(join(o.dir, 'spells.csv'))) spells.set(s.team_id, (spells.get(s.team_id) ?? 0) + 1)
  const overrides = readOverrides(readCsv(join(o.dir, 'manual', 'openfootball_teams.csv')))

  const namesOf = new Map<string, string[]>()
  for (const a of aliases) namesOf.set(a.entity_id, [...(namesOf.get(a.entity_id) ?? []), a.alias])
  const clubs = teams.filter((t) => t.kind === 'club' && t.retired !== 'true')
  const idx = buildIndex(clubs.map((t) => ({ id: t.id, nation_id: t.nation_id, names: [t.name_en, t.short_name, ...(namesOf.get(t.id) ?? [])].filter(Boolean) })), spells, wd)
  const nameOf = new Map(teams.map((t) => [t.id, t.name_ko || t.name_en]))

  const found: TeamCompetition[] = []
  const unmatched = new Map<string, { competition_id: string; name: string; status: string; seasons: number[]; candidates: string[] }>()
  const table: string[] = []
  const info: SeasonInfo[] = []

  for (const league of o.leagues) {
    const w = o.windows.get(league.id)!
    const cells: string[] = []
    for (let season = w.from; season <= w.to; season++) {
      let names: string[] | null = null
      for (const src of sourceUrls(league.id, season)) {
        const text = await download(src.url, src.path, o.cacheDir)
        if (text === null) continue
        if (src.kind === 'json') names = parseJsonTeams(text)
        else {
          const p = parseTxtTeams(text)
          if (p.declared !== null && p.declared !== p.teams.length) log(`  경고: ${src.path} 머리말 팀 수 ${p.declared}, 읽은 팀 ${p.teams.length}`)
          names = p.teams
        }
        break
      }
      const wdTeams = new Set(wd.filter((t) => t.competition_id === league.id && Number(t.season) === season).map((t) => t.team_id))
      if (!names) { cells.push(`${String(wdTeams.size).padStart(3)}/  -`); continue }
      const ofTeams = new Set<string>()
      for (const name of names) {
        const m = matchTeam(name, league, idx, overrides)
        if (m.status === 'ok') { ofTeams.add(m.team_id); found.push({ team_id: m.team_id, competition_id: league.id, season: String(season) }); continue }
        const key = `${league.id}|${name}`
        const u = unmatched.get(key) ?? { competition_id: league.id, name, status: m.status, seasons: [], candidates: m.candidates }
        u.seasons.push(season)
        unmatched.set(key, u)
      }
      const matched = names.length - [...unmatched.values()].filter((u) => u.competition_id === league.id && u.seasons.includes(season)).length
      info.push({ competition_id: league.id, season: String(season), teams: String(names.length), matched: String(matched) })
      const after = matched === names.length ? ofTeams.size : new Set([...wdTeams, ...ofTeams]).size
      cells.push(`${String(wdTeams.size).padStart(3)}/${String(names.length).padStart(3)}${matched < names.length ? '?' : ' '}→${String(after).padStart(2)}`)
    }
    table.push(`  ${league.name_ko.padEnd(10)} ${w.from}~${w.to}  ${cells.join(' ')}`)
  }

  // 쓰기: 연결된 참가팀, 못 이은 이름
  const outDir = join(o.dir, 'openfootball')
  mkdirSync(outDir, { recursive: true })
  const rows = mergeTeamComps(found, [])
  writeFileSync(join(outDir, 'team_competitions.csv'), toCsv(FILES.team_competitions.columns, sortRows('team_competitions', rows) as Record<string, unknown>[]))
  writeFileSync(join(outDir, 'seasons.csv'), toCsv(['competition_id', 'season', 'teams', 'matched'], info))
  const complete = completeSeasons(info)
  const combined = combineTeamComps(wd, rows, complete, (id) => namesOf.get(id) ?? [])
  // remap은 누적한다. --merge 뒤에는 옛 ID가 team_competitions.csv에서 사라져 다시 계산되지 않지만, 다음 football:fetch는 여전히 필요하다
  const remap = new Map([...readCsv(join(outDir, 'remap.csv')).map((r) => [r.from_id, r.to_id] as const), ...combined.remap])
  writeFileSync(join(outDir, 'remap.csv'), toCsv(['from_id', 'to_id'], [...remap].sort((a, b) => cmp(a[0], b[0])).map(([from_id, to_id]) => ({ from_id, to_id }))))
  const um = [...unmatched.values()].sort((a, b) => cmp(a.competition_id, b.competition_id) || cmp(a.name, b.name))
  writeFileSync(join(outDir, 'unmatched.csv'), toCsv(['competition_id', 'name', 'status', 'seasons', 'candidates'], um.map((u) => ({
    ...u, seasons: u.seasons.join(' '), candidates: u.candidates.slice(0, 5).map((id) => `${id} ${nameOf.get(id) ?? ''}`.trim()).join('; '),
  }))))

  log('\n시즌별 참가팀 수: 위키데이터/openfootball(?는 못 이은 이름 있음)→합친 결과(다 이으면 openfootball 기준), -는 openfootball 파일 없음')
  for (const line of table) log(line)
  log(`\n연결 ${rows.length}행 → ${outDir}/team_competitions.csv`)
  if (um.length) {
    log(`못 이은 이름 ${um.length}개 → ${outDir}/unmatched.csv. manual/openfootball_teams.csv(competition_id,name,team_id)에 ID를 적고 다시 돌린다:`)
    for (const u of um) log(`  ${u.status === 'ambiguous' ? '애매' : '없음'} ${u.competition_id} ${u.name} [${u.seasons.join(' ')}] ${u.candidates.slice(0, 3).map((id) => `${id} ${nameOf.get(id) ?? ''}`).join(', ')}`)
  }
  if (combined.dropped.length) {
    log(`\n명단이 다 이어진 시즌에서 위키데이터에만 있어 뺄 참가팀 ${combined.dropped.length}개 (같은 이름 다른 ID로 옮김 ${combined.remap.size}개 → ${outDir}/remap.csv):`)
    const byTeam = new Map<string, string[]>()
    for (const d of combined.dropped) byTeam.set(d.team_id, [...(byTeam.get(d.team_id) ?? []), `${d.competition_id} ${d.season}`])
    for (const [id, where] of byTeam) log(`  ${id} ${nameOf.get(id) ?? ''}${combined.remap.has(id) ? ` → ${combined.remap.get(id)} ${nameOf.get(combined.remap.get(id)!) ?? ''}` : ''} [${where.join(', ')}]`)
  }

  if (!o.merge) return
  // --merge: 지금 CSV에 반영한다. 직접 입력은 다시 얹고, 팀 목록에 없는 팀(다음 football:fetch에서 들어옴)은 뺀다
  const known = new Set(teams.map((t) => t.id))
  const manual = readCsv(join(o.dir, 'manual', 'team_competitions.csv'))
  const merged = mergeTeamComps(combined.rows.filter((r) => known.has(r.team_id)), manual)
  const skipped = combined.rows.filter((r) => !known.has(r.team_id)).length
  writeFileSync(join(o.dir, 'team_competitions.csv'), toCsv(FILES.team_competitions.columns, sortRows('team_competitions', merged) as Record<string, unknown>[]))
  log(`\n반영: team_competitions.csv ${wd.length} → ${merged.length}행${skipped ? ` (teams.csv에 없는 팀 ${skipped}행은 다음 football:fetch에서)` : ''}`)
  // 우승 기록의 팀 ID 옮기기
  const honours = readCsv(join(o.dir, 'honours.csv'))
  let moved = 0
  for (const h of honours) { const to = remap.get(h.team_id); if (to && known.has(to)) { h.team_id = to; moved++ } }
  if (moved) writeFileSync(join(o.dir, 'honours.csv'), toCsv(FILES.honours.columns, sortRows('honours', honours) as Record<string, unknown>[]))
  // 옮긴 뒤 아무 데서도 안 쓰는 옛 ID 팀은 지운다(다음 football:fetch도 만들지 않는다)
  const used = new Set([...merged.map((r) => r.team_id), ...honours.map((h) => h.team_id),
    ...readCsv(join(o.dir, 'spells.csv')).map((r) => r.team_id), ...readCsv(join(o.dir, 'caps.csv')).map((r) => r.team_id)])
  const gone = new Set([...remap.keys(), ...combined.dropped.map((d) => d.team_id)].filter((id) => !used.has(id)))
  const drop = (f: 'teams' | 'aliases' | 'external_ids', col: string) => {
    const rs = readCsv(join(o.dir, `${f}.csv`))
    const left = rs.filter((r) => !gone.has(r[col]))
    if (left.length < rs.length) writeFileSync(join(o.dir, `${f}.csv`), toCsv(FILES[f].columns, left as Record<string, unknown>[]))
    return rs.length - left.length
  }
  const removed = drop('teams', 'id')
  drop('aliases', 'entity_id'); drop('external_ids', 'entity_id')
  log(`우승 기록 팀 ID ${moved}개 옮김, 쓰이지 않게 된 팀 ${removed}개 지움`)
  const files = {} as Dataset['files'], headers = {} as Dataset['headers']
  for (const f of FILE_NAMES) {
    const text = readFileSync(join(o.dir, `${f}.csv`), 'utf8')
    files[f] = parseCsv(text)
    headers[f] = text.split(/\r?\n/, 1)[0].split(',')
  }
  const problems = checkDataset({ files, headers }, readCsv(join(o.dir, 'manual', 'legends.csv')))
  if (problems.length) {
    log(`CSV 검사 오류 ${problems.length}개 (앞 30개):`)
    for (const m of problems.slice(0, 30)) log(`  ${m}`)
    process.exitCode = 1
  } else log('CSV 검사 통과')
}

main().catch((e) => { console.error(e); process.exit(1) })
