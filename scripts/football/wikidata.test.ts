import { expect, test } from 'vitest'
import { LEAGUES } from './leagues.ts'
import {
  applyLeagueNations, applyNamesKo, buildAliases, buildCaps, buildNations, buildPlayers, buildSeasons, buildSpells, buildTeams, coverage, dateOf,
  flat, footOf, isYouthOrReserve, qLeagueClubs, mergeTeamComps, parseCsv, pickNation, popularity, positionOf, qPlayersAtTeams, teamKind, toCsv,
  type Row, type Team,
} from './wikidata.ts'

const PL = LEAGUES[0]

test('flat_strips_entity_and_statement_uris', () => {
  expect(flat({
    p: { type: 'uri', value: 'http://www.wikidata.org/entity/Q439722' },
    st: { type: 'uri', value: 'http://www.wikidata.org/entity/statement/Q439722-ABC' },
    en: { type: 'literal', value: 'Son Heung-min' },
    web: { type: 'uri', value: 'https://example.com/x' },
  })).toEqual({ p: 'Q439722', st: 'Q439722-ABC', en: 'Son Heung-min', web: 'https://example.com/x' })
})

test('dateOf_day_and_year_precision', () => {
  expect(dateOf('1992-07-08T00:00:00Z', '11')).toEqual({ date: '1992-07-08', precision: 'day' })
  expect(dateOf('2015-01-01T00:00:00Z', '9')).toEqual({ date: '2015', precision: 'year' })
  expect(dateOf('2015-08-01T00:00:00Z', '10')).toEqual({ date: '2015', precision: 'year' })
  expect(dateOf('2000-01-01T00:00:00Z', '7')).toBeNull()
  expect(dateOf(undefined, undefined)).toBeNull()
})

test('positionOf_prefers_generic_label_and_matching_detail', () => {
  expect(positionOf(['centre-back', 'defender'])).toEqual({ group: 'DF', detail: 'CB' })
  expect(positionOf(['winger'])).toEqual({ group: 'FW', detail: 'W' })
  expect(positionOf(['midfielder', 'winger'])).toEqual({ group: 'MF', detail: '' })
  expect(positionOf(['goalkeeper'])).toEqual({ group: 'GK', detail: '' })
  expect(positionOf([])).toEqual({ group: null, detail: '' })
})

test('footOf', () => {
  expect(footOf(['left-footedness'])).toBe('left')
  expect(footOf(['ambidexterity'])).toBe('both')
  expect(footOf([])).toBe('')
})

test('youth_reserve_and_team_kind', () => {
  for (const l of ['England national under-21 football team', 'Jong Ajax', 'Real Madrid B', 'FC Bayern Munich II', 'Juventus U23', 'Manchester United Reserves', "England women's national football team", 'Northern Ireland national Junior football team']) {
    expect(isYouthOrReserve(l)).toBe(true)
  }
  for (const l of ['Borussia Mönchengladbach', 'Olympique de Marseille', 'Club Brugge KV', 'Tottenham Hotspur F.C.']) {
    expect(isYouthOrReserve(l)).toBe(false)
  }
  expect(teamKind(['Q6979593'], 'South Korea national football team')).toBe('national')
  expect(teamKind(['Q476028'], 'Tottenham Hotspur F.C.')).toBe('club')
  expect(teamKind(['Q135408445'], "Denmark men's national football team")).toBe('national')
  expect(teamKind(['Q6979593'], 'South Korea national under-23 football team')).toBe('other')
  expect(teamKind(['Q6979593', 'Q21945604'], 'Some national team')).toBe('other')
})

test('popularity_is_percentile_with_ties', () => {
  const p = popularity(new Map([['a', 1], ['b', 10], ['c', 10], ['d', 100]]))
  expect(p.get('a')).toBe(0)
  expect(p.get('b')).toBe(p.get('c'))
  expect(p.get('d')).toBe(100)
  expect(popularity(new Map([['x', 5]])).get('x')).toBe(100)
})

test('players_query_window_and_age_filter', () => {
  const q = qPlayersAtTeams(['Q18656'], 2016, 2025)
  expect(q).toContain('wd:Q18656')
  expect(q).toContain('"2016-07-01T00:00:00Z"')
  expect(q).toContain('"2026-06-30T00:00:00Z"')
  expect(q).toContain('"1976-01-01T00:00:00Z"')
})

test('league_clubs_query_excludes_players', () => {
  expect(qLeagueClubs([PL])).toContain('wdt:P31/wdt:P279* wd:Q476028')
})

const teamRows: Row[] = [
  { t: 'Q18741', en: 'Tottenham Hotspur F.C.', ko: '토트넘 홋스퍼 FC', type: 'Q476028', country: 'Q145', hex: 'ffffff', founded: '1882-09-05T00:00:00Z' },
  { t: 'Q18741', en: 'Tottenham Hotspur F.C.', ko: '토트넘 홋스퍼 FC', type: 'Q476028', country: 'Q145', hex: '132257', founded: '1882-09-05T00:00:00Z' },
  { t: 'Q170043', en: 'South Korea national football team', type: 'Q135408445', country: 'Q884', sport: 'Q884' },
  { t: 'Q9999', en: 'Hamburger SV II', type: 'Q476028', country: 'Q183' },
]

test('buildTeams_kind_nation_colors', () => {
  const [kor, spurs, hsv2] = buildTeams(teamRows)
  expect(spurs).toMatchObject({ id: 'Q18741', kind: 'club', name_ko: '토트넘 홋스퍼 FC', nation_id: 'Q145', founded: '1882' })
  expect(JSON.parse(spurs.colors)).toEqual([{ hex: '#132257', share: 0.5 }, { hex: '#FFFFFF', share: 0.5 }])
  expect(kor).toMatchObject({ kind: 'national', nation_id: 'Q884', colors: '' })
  expect(hsv2.kind).toBe('other')
})

const teamMap = new Map<string, Team>(buildTeams(teamRows).map((t) => [t.id, t]))

const spellRows: Row[] = [
  { p: 'Q1', st: 'S1', team: 'Q18741', s: '2015-08-28T00:00:00Z', sprec: '11', e: '2025-08-02T00:00:00Z', eprec: '11', apps: '333', goals: '127' },
  { p: 'Q1', st: 'S2', team: 'Q9999', s: '2010-01-01T00:00:00Z', sprec: '9' },
  { p: 'Q1', st: 'S3', team: 'Q170043', s: '2010-01-01T00:00:00Z', sprec: '9', apps: '100', goals: '40' },
  { p: 'Q1', st: 'S4', team: 'Q170043', s: '2019-01-01T00:00:00Z', sprec: '9', apps: '30', goals: '10' },
  { p: 'Q1', st: 'S5', team: 'Q18741', e: '2014-01-01T00:00:00Z', eprec: '9' },
  { p: 'Q2', st: 'S6', team: 'Q18741', s: '2020-01-01T00:00:00Z', sprec: '9', loan: '1' },
  { p: 'Q2', st: 'S6', team: 'Q18741', s: '2020-01-01T00:00:00Z', sprec: '9', loan: '1' },
]

test('buildSpells_drops_youth_and_undated_splits_national', () => {
  const { spells, national, dropped } = buildSpells(spellRows, teamMap)
  expect(dropped).toBe(2) // S2 2군, S5 시작일 없음
  expect(spells).toEqual([
    { player_id: 'Q1', team_id: 'Q18741', start_date: '2015-08-28', end_date: '2025-08-02', date_precision: 'day', loan: 'false', apps: '333', goals: '127', source_ref: 'S1' },
    { player_id: 'Q2', team_id: 'Q18741', start_date: '2020', end_date: '', date_precision: 'year', loan: 'true', apps: '', goals: '', source_ref: 'S6' },
  ])
  expect(national.map((s) => s.source_ref)).toEqual(['S3', 'S4'])
})

test('buildCaps_sums_and_spans', () => {
  const { national } = buildSpells(spellRows, teamMap)
  expect(buildCaps(national)).toEqual([{ player_id: 'Q1', team_id: 'Q170043', caps: '130', goals: '50', first_year: '2010', last_year: '' }])
})

test('pickNation_order', () => {
  const caps = [{ player_id: 'Q1', team_id: 'Q170043', caps: '130', goals: '', first_year: '2010', last_year: '' }]
  expect(pickNation(caps, teamMap, ['Q21'], ['Q145'])).toBe('Q884')
  expect(pickNation([], teamMap, ['Q21'], ['Q145'])).toBe('Q21')
  expect(pickNation([], teamMap, [], ['Q145', 'Q16'])).toBe('Q145')
})

test('buildPlayers_merges_rows', () => {
  const rows: Row[] = [
    { p: 'Q1', en: 'Son Heung-min', ko: '손흥민', birth: '1992-07-08T00:00:00Z', bprec: '11', cit: 'Q884', posLabel: 'forward', height: '1.83', links: '90', tm: '91845' },
    { p: 'Q1', en: 'Son Heung-min', ko: '손흥민', birth: '1992-01-01T00:00:00Z', bprec: '9', cit: 'Q884', posLabel: 'winger', height: '1.83', links: '90', tm: '91845' },
    { p: 'Q2', en: 'Some Player', links: '3' },
  ]
  const { national } = buildSpells(spellRows, teamMap)
  const { players, transfermarkt } = buildPlayers(rows, buildCaps(national), teamMap)
  expect(players[0]).toMatchObject({
    id: 'Q1', name_ko: '손흥민', birth_date: '1992-07-08', birth_precision: 'day', nation_id: 'Q884',
    position: 'FW', position_detail: 'W', height_cm: '183', popularity: '100',
  })
  expect(players[1]).toMatchObject({ id: 'Q2', name_ko: '', birth_date: '', position: '', popularity: '0' })
  expect(transfermarkt.get('Q1')).toBe('91845')
})

test('buildNations_iso_fallback', () => {
  expect(buildNations([
    { n: 'Q21', en: 'England', ko: '잉글랜드', iso3166_2: 'GB-ENG' },
    { n: 'Q884', en: 'South Korea', ko: '대한민국', iso2: 'KR' },
  ])).toEqual([
    { id: 'Q21', name_ko: '잉글랜드', name_en: 'England', iso2: 'gb-eng', confederation: '' },
    { id: 'Q884', name_ko: '대한민국', name_en: 'South Korea', iso2: 'kr', confederation: '' },
  ])
})

test('seasons_manual_merge_and_coverage', () => {
  const { teamComps, honours } = buildSeasons([
    { league: PL.id, start: '2016-08-13T00:00:00Z', team: 'Q18741', winner: 'Q9616' },
    { league: PL.id, start: '2016-08-13T00:00:00Z', team: 'Q9616', winner: 'Q9616' },
  ])
  expect(honours).toEqual([{ honour: PL.id, season: '2016', team_id: 'Q9616', player_id: '' }])
  const merged = mergeTeamComps(teamComps, [
    { team_id: 'Q18741', competition_id: PL.id, season: '2016' },
    { team_id: 'Q18741', competition_id: PL.id, season: '2017' },
  ])
  expect(merged).toHaveLength(3)
  expect(coverage(merged, [PL], 2016, 2018)[0].counts).toEqual([2, 1, 0])
})

test('applyNamesKo_overrides_and_counts', () => {
  const items = [{ id: 'Q1', name_ko: '손흥민' }, { id: 'Q2', name_ko: '' }]
  expect(applyNamesKo(items, [{ entity_id: 'Q1', name_ko: '손흥민' }, { entity_id: 'Q2', name_ko: ' 김민재 ' }])).toBe(1)
  expect(items[1].name_ko).toBe('김민재')
})

test('buildAliases_dedupes', () => {
  expect(buildAliases([{ id: 'Q1', name_ko: '손흥민', name_en: 'Son Heung-min' }], [
    { x: 'Q1', alias: 'Sonny', lang: 'en' }, { x: 'Q1', alias: 'Son Heung-min', lang: 'en' },
  ])).toEqual([
    { entity_id: 'Q1', alias: 'Son Heung-min', lang: 'en' },
    { entity_id: 'Q1', alias: 'Sonny', lang: 'en' },
    { entity_id: 'Q1', alias: '손흥민', lang: 'ko' },
  ])
})

test('csv_roundtrip_with_quotes_commas_newlines', () => {
  const rows = [{ a: 'x,y', b: 'say "hi"' }, { a: 'line1\nline2', b: '' }]
  const text = toCsv(['a', 'b'], rows)
  expect(text.split('\n')[0]).toBe('a,b')
  expect(parseCsv(text)).toEqual(rows)
  expect(parseCsv('﻿entity_id,name_ko\r\nQ1,손흥민\r\n')).toEqual([{ entity_id: 'Q1', name_ko: '손흥민' }])
  expect(parseCsv('')).toEqual([])
})

test('applyLeagueNations_sets_club_nation_from_league', () => {
  const teams = buildTeams(teamRows)
  expect(applyLeagueNations(teams, [{ team_id: 'Q18741', competition_id: PL.id, season: '2020' }, { team_id: 'Q170043', competition_id: PL.id, season: '2020' }], [PL])).toBe(1)
  expect(teams.find((t) => t.id === 'Q18741')!.nation_id).toBe('Q21')
  expect(teams.find((t) => t.id === 'Q170043')!.nation_id).toBe('Q884')
})
