// 위키데이터에서 단계 1 데이터(선수·팀·국가·경력·국가대표·수상)를 받아 data/football/*.csv로 쓴다.
// 설계 docs/superpowers/specs/2026-10-31-football-data-design.md §4·§8. 사용법은 data/football/README.md.
//
//   npm run football:fetch -- [--to 2026] [--seasons 3] [--leagues Q9448,Q19510] [--limit-teams 5] [--history-from 1987|off] [--no-cache]
//
// --history-from(기본 1987): 모든 대상 팀의 선수를 그해부터 받고, 시즌 참가팀도 리그·전신 대회(leagues.ts eras)의 그해부터 받는다.
// manual/history_clubs.csv의 클럽을 더한다. off면 리그별 최근 시즌만(이전 동작). 설계 docs/superpowers/specs/2026-11-25-football-history-clubs-design.md.
//
// 리그마다 최근 seasons 시즌(leagues.ts, 프리미어리그 15·나머지 10)을 받는다. --seasons는 모든 리그를 같은 수로 바꾼다(시험용).
// manual/legends.csv의 선수(범위 밖 레전드)를 더한다. 설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §3·§4.
//
// 위키데이터 공식 질의 서비스(query.wikidata.org)만 쓴다. 한 번에 한 요청, 요청 사이 1초 간격.
// 응답은 .cache/wikidata/에 보관해 중간에 멈춰도 다시 돌리면 이어서 진행한다. --no-cache는 새로 받아 그 캐시를 갱신한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HISTORY_FROM, LEAGUES, type League } from './leagues.ts'
import { checkDataset, FILE_NAMES, FILES, sortRows, type Dataset, type FileName } from './schema.ts'
import {
  applyLeagueNations, applyNamesKo, buildAliases, buildAwards, buildCaps, buildNations, buildPlayers, buildSeasons, buildSpells, buildTeams,
  competitionEras, competitionList, competitionWindows, coverage, currentSeason, historyStarts, leaguesFor, seasonChunks, mergeLegends, mergeTeamComps, parseCsv, qAliases, qAwards, qLeagueClubs, qNations, qOccupation, qPlayerDetails,
  qPlayersAtTeams, qSeasons, qSpells, qTeams, teamStarts, toCsv, type Row, type Team, type TeamCompetition, type Window,
} from './wikidata.ts'
import { batched, log, query } from './wdqs.ts'
import { combineTeamComps, completeSeasons, type SeasonInfo } from './openfootball.ts'
import { applyManualSpells } from './manualSpells.ts'

// ---------------------------------------------------------------- 인자

function args() {
  const a = process.argv.slice(2)
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined }
  if (a.includes('--from')) throw new Error('--from은 없어졌습니다. 리그별 시즌 수는 leagues.ts, 모든 리그를 같은 수로 바꾸려면 --seasons N')
  const to = Number(get('to') ?? currentSeason(new Date()))
  const seasons = get('seasons')
  const override = seasons === undefined ? undefined : Number(seasons)
  if (override !== undefined && !(Number.isInteger(override) && override >= 1)) throw new Error(`--seasons는 1 이상의 정수: ${seasons}`)
  const only = get('leagues')?.split(',')
  const picked = only ? LEAGUES.filter((l) => only.includes(l.id)) : LEAGUES
  if (only && picked.length !== only.length) throw new Error(`모르는 리그: ${only.filter((q) => !LEAGUES.some((l) => l.id === q)).join(', ')} (scripts/football/leagues.ts)`)
  // --seasons N(시험용)만 주면 이전처럼 최근 N시즌만 받는다
  const hf = get('history-from') ?? (override !== undefined ? 'off' : String(HISTORY_FROM))
  const historyFrom = hf === 'off' ? null : Number(hf)
  const leagues = leaguesFor(picked, historyFrom)
  if (historyFrom !== null && !(Number.isInteger(historyFrom) && historyFrom >= 1950 && historyFrom <= to)) throw new Error(`--history-from는 1950~${to}의 연도 또는 off: ${hf}`)
  const limit = get('limit-teams')
  // 일부만 받는 시험 실행(--leagues·--limit-teams·--seasons)은 본 데이터를 덮어쓰지 않게 따로 쓴다(--out으로 바꿀 수 있음)
  // --history-from를 직접 주는 것도 비교용 시험 실행으로 본다
  const trial = only !== undefined || limit !== undefined || override !== undefined || get('history-from') !== undefined
  return {
    windows: competitionWindows(leagues, to, { override, historyFrom }), leagues, historyFrom,
    limitTeams: limit ? Number(limit) : Infinity,
    out: get('out') ?? (trial ? '.cache/football-trial' : 'data/football'),
    /** 직접 입력(manual/)·openfootball 결과를 읽는 곳. 출력 폴더와 달라도 본 데이터의 것을 쓴다 */
    input: 'data/football', trial,
    // --no-cache: 캐시를 읽지 않고 새로 받아 캐시를 갱신한다
    cache: { dir: get('cache') ?? '.cache/wikidata', refresh: a.includes('--no-cache') },
  }
}

// ---------------------------------------------------------------- 실행

function readManual(dir: string, name: string): Row[] {
  const f = join(dir, 'manual', name)
  return existsSync(f) ? parseCsv(readFileSync(f, 'utf8')) : []
}

function printCoverage(tc: ReturnType<typeof mergeTeamComps>, leagues: readonly League[], windows: ReadonlyMap<string, Window>) {
  log(`\n시즌별 참가팀 수 (openfootball 포함. 빈칸 --·정원 미만 !는 data/football/manual/team_competitions.csv로 채운다)`)
  for (const { id, name_ko, from, counts, warn } of coverage(tc, leagues, windows)) {
    const cells = counts.map((n, i) => (n === 0 ? ' --' : String(n).padStart(3)) + (n > 0 && warn[i] ? '!' : ' ')).join('')
    log(`  ${name_ko.padEnd(10)} ${id.padEnd(9)} ${from}~${from + counts.length - 1} ${cells}`)
  }
}

async function main() {
  const o = args()
  mkdirSync(o.cache.dir, { recursive: true })
  mkdirSync(o.out, { recursive: true })
  if (o.trial && o.out !== 'data/football') log(`시험 실행: 결과를 ${o.out}/에 쓴다 (본 데이터 data/football/은 그대로)`)
  const to = Math.max(...[...o.windows.values()].map((w) => w.to))
  log(`리그 ${o.leagues.length}개, 시즌 ${o.leagues.map((l) => `${l.name_ko} ${o.windows.get(l.id)!.from}~`).join(', ')} ~${to}`)

  // 1. 시즌별 참가팀·우승 (리그마다 자기 창)
  // 대회별·10년 단위로 나눠 질의한다(창이 넓어 한 번에 보내면 시간 초과)
  const seasonRows = []
  for (const w of seasonChunks(o.windows, 10)) seasonRows.push(...await query(qSeasons(w), o.cache))
  const seasons = buildSeasons(seasonRows)
  const leagueIds = new Set(competitionList(o.leagues).map((c) => c.id))
  // 위키데이터 + openfootball 경기 일정(npm run football:openfootball, 설계 §3.5) + 직접 입력.
  // openfootball 명단이 다 이어진 시즌은 openfootball이 기준, 우승 기록의 옛 ID는 remap.csv로 옮긴다
  const of = (name: string) => { const f = join(o.input, 'openfootball', name); return existsSync(f) ? parseCsv(readFileSync(f, 'utf8')) : [] }
  const combined = combineTeamComps(seasons.teamComps, of('team_competitions.csv') as unknown as TeamCompetition[], completeSeasons(of('seasons.csv') as unknown as SeasonInfo[]))
  const remap = new Map(of('remap.csv').map((r) => [r.from_id, r.to_id]))
  for (const h of seasons.honours) h.team_id = remap.get(h.team_id) ?? h.team_id
  const teamComps = mergeTeamComps(combined.rows, readManual(o.input, 'team_competitions.csv')).filter((r) => leagueIds.has(r.competition_id))
  if (combined.dropped.length) log(`openfootball 기준으로 뺀 위키데이터 참가팀 ${combined.dropped.length}개`)
  printCoverage(teamComps, o.leagues, o.windows)

  // 2. 선수를 찾을 팀과 팀별 시작 연도: 창 안 시즌 참가팀 + 지금 리그 소속 클럽
  const clubs = await query(qLeagueClubs(o.leagues), o.cache)
  let starts = teamStarts(teamComps, clubs.map((r) => ({ league: r.league, team: r.team })), o.windows)
  const hist = historyStarts(starts, readManual(o.input, 'history_clubs.csv'), o.historyFrom)
  starts = hist.starts
  if (o.historyFrom !== null) log(`옛 선수: 모든 대상 팀을 ${o.historyFrom}년부터, history_clubs.csv에서 새 클럽 ${hist.added.length}개`)
  for (const id of hist.invalid) log(`  history_clubs.csv: QID가 아님, 건너뜀: ${id || '(빈 값)'}`)
  if (starts.size > o.limitTeams) starts = new Map([...starts].slice(0, o.limitTeams))
  const seedTeams = [...starts.keys()]
  log(`\n대상 팀 ${seedTeams.length}개`)

  // 3. 팀별 시작 연도부터 지금까지 그 팀에 있었던 선수 (시작 연도가 같은 팀끼리 묶어 질의)
  const byStart = new Map<number, string[]>()
  for (const [team, from] of starts) byStart.set(from, [...(byStart.get(from) ?? []), team])
  const found = new Set<string>()
  for (const [from, teams] of [...byStart].sort((a, b) => a[0] - b[0])) {
    const before = found.size
    for (const r of await batched(`선수 찾기 (${from}~)`, teams, 20, (c) => qPlayersAtTeams(c, from, to), o.cache)) found.add(r.p)
    log(`  ${from}~ 팀 ${teams.length}개: 새 선수 ${found.size - before}명`)
  }
  log(`선수 ${found.size}명`)

  // 3-1. 레전드 수동 명단: 축구 선수인지 확인하고 더한다
  const legends = mergeLegends([...found], readManual(o.input, 'legends.csv'))
  for (const id of legends.invalid) log(`  레전드 명단: QID가 아님, 건너뜀: ${id}`)
  let legendOk = new Set<string>()
  if (legends.added.length) {
    legendOk = new Set((await batched('레전드 확인', legends.added, 200, qOccupation, o.cache)).map((r) => r.p))
    for (const id of legends.added.filter((x) => !legendOk.has(x))) log(`  레전드 명단: 축구 선수가 아님, 뺌: ${id}`)
  }
  const playerIds = [...found, ...legends.added.filter((x) => legendOk.has(x))].sort()
  log(`레전드 ${legendOk.size}명 추가 (제외 ${legends.added.length - legendOk.size + legends.invalid.length}명), 합계 ${playerIds.length}명`)

  // 4. 선수의 전체 경력과 그 경력에 나오는 팀
  const spellRows = await batched('경력', playerIds, 100, qSpells, o.cache)
  const teamIds = [...new Set([...spellRows.map((r) => r.team), ...seedTeams, ...seasons.honours.map((h) => h.team_id)])]
  const teams = buildTeams(await batched('팀', teamIds, 150, qTeams, o.cache))
  applyLeagueNations(teams, teamComps, o.leagues)
  const teamMap = new Map<string, Team>(teams.map((t) => [t.id, t]))
  const { spells: wdSpells, national, dropped } = buildSpells(spellRows, teamMap)
  const caps = buildCaps(national)
  log(`경력 ${wdSpells.length}개, 국가대표 ${caps.length}개 (유스·2군·이름 없는 팀·날짜 없음·날짜 역전으로 뺀 구간 ${dropped}개)`)
  // 4-1. 직접 입력 경력(manual/spells.csv, 설계 §5.3). 선수·팀 존재는 9번 CSV 검사가 본다
  const manualSpells = applyManualSpells(wdSpells, readManual(o.input, 'spells.csv'))
  const spells = manualSpells.spells
  log(`직접 입력 경력: 추가 ${manualSpells.added}, 수정 ${manualSpells.fixed}, 삭제 ${manualSpells.deleted}`)
  for (const m of manualSpells.problems) log(`  ${m}`)
  if (manualSpells.problems.length) process.exitCode = 1

  // 5. 선수 정보·수상
  const built = buildPlayers(await batched('선수 정보', playerIds, 100, qPlayerDetails, o.cache), caps, teamMap)
  // 어느 언어로도 이름이 없는 선수는 화면에 보일 이름이 없어 뺀다(경력·국가대표·수상·별칭·외부 ID도 함께)
  const players = built.players.filter((p) => p.name_en)
  const nameless = built.players.filter((p) => !p.name_en).map((p) => p.id)
  const keptPlayers = new Set(players.map((p) => p.id))
  if (nameless.length) log(`이름 라벨이 없는 선수 ${nameless.length}명 뺌: ${nameless.slice(0, 10).join(' ')}${nameless.length > 10 ? ' …' : ''}`)
  const transfermarkt = [...built.transfermarkt].filter(([id]) => keptPlayers.has(id))
  const awards = buildAwards(await batched('수상', playerIds, 200, qAwards, o.cache)).filter((h) => keptPlayers.has(h.player_id))

  // 6. 국가
  const keptTeams = teams.filter((t) => t.kind !== 'other')
  const nationIds = [...new Set([...players.map((p) => p.nation_id), ...keptTeams.map((t) => t.nation_id), ...o.leagues.map((l) => l.nation_id)].filter(Boolean))]
  const nations = buildNations(await batched('국가', nationIds, 200, qNations, o.cache))

  // 7. 직접 입력한 한글 이름, 검색용 별칭
  const namesKo = readManual(o.input, 'names_ko.csv')
  const fixed = applyNamesKo(players, namesKo) + applyNamesKo(keptTeams, namesKo) + applyNamesKo(nations, namesKo)
  // 질의는 처음 목록 그대로(캐시 재사용), 뺀 선수의 별칭은 결과에서 거른다
  const keptIds0 = new Set(keptTeams.map((t) => t.id))
  const aliases = buildAliases([...players, ...keptTeams], await batched('별칭', [...playerIds, ...keptTeams.map((t) => t.id)], 200, qAliases, o.cache)).filter((x) => keptPlayers.has(x.entity_id) || keptIds0.has(x.entity_id))

  // 8. 쓰기 (팀은 유스·2군 제외, 경력·시즌 참가팀은 남은 팀만). 열과 행 순서는 schema.ts가 정한다
  const keptIds = new Set(keptTeams.map((t) => t.id))
  const honours = [...seasons.honours.filter((h) => keptIds.has(h.team_id)), ...awards]
  const out: Record<FileName, object[]> = {
    competitions: competitionList(o.leagues),
    competition_eras: competitionEras(o.leagues, o.windows),
    nations,
    teams: keptTeams,
    team_competitions: teamComps.filter((t) => keptIds.has(t.team_id)),
    players,
    aliases,
    external_ids: transfermarkt.map(([entity_id, external_id]) => ({ entity_id, source: 'transfermarkt', external_id })),
    spells: spells.filter((x) => keptPlayers.has(x.player_id)),
    caps: caps.filter((x) => keptPlayers.has(x.player_id)),
    honours,
  }
  for (const f of FILE_NAMES) writeFileSync(join(o.out, `${f}.csv`), toCsv(FILES[f].columns, sortRows(f, out[f]) as Record<string, unknown>[]))

  // 9. 쓴 결과를 CSV 규칙으로 검사 (npm test의 data.test.ts와 같은 규칙)
  const written = {} as Dataset['files'], headers = {} as Dataset['headers']
  for (const f of FILE_NAMES) {
    const text = readFileSync(join(o.out, `${f}.csv`), 'utf8')
    written[f] = parseCsv(text)
    headers[f] = text.split(/\r?\n/, 1)[0].split(',')
  }
  const problems = checkDataset({ files: written, headers }, readManual(o.input, 'legends.csv'))

  const noKo = players.filter((p) => !p.name_ko).length
  const noPos = players.filter((p) => !p.position).length
  log(`\n완료: ${o.out}/`)
  log(`  선수 ${players.length}명 (한글 이름 없음 ${noKo}, 포지션 없음 ${noPos}), 팀 ${keptTeams.length}개, 국가 ${nations.length}개`)
  log(`  경력 ${spells.length}, 국가대표 ${caps.length}, 수상·우승 ${honours.length}, 별칭 ${aliases.length}, 직접 입력 한글 이름 적용 ${fixed}`)
  if (problems.length) {
    log(`\nCSV 검사 오류 ${problems.length}개 (앞 30개). 수집기 버그는 scripts/football/, 데이터 문제는 manual/로 고친다:`)
    for (const m of problems.slice(0, 30)) log(`  ${m}`)
    process.exitCode = 1
  } else log('  CSV 검사 통과')
}

main().catch((e) => { console.error(e); process.exit(1) })
