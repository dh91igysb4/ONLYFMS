// 선수 우승·대표팀 우승·감독 시즌 계산 (설계 2026-11-25-football-honours-design.md §3.1·§3.5)
import { expect, test } from 'vitest'
import { applyWinnerFixes, managerSeasons, nationalTeamFinder, nationalTitles, playerTitles } from './honours.ts'

const m = (player_id: string, season: string, team_id: string) => ({ player_id, season, team_id, primary: 'true', days: '300', estimated: 'true' })
const win = (honour: string, season: string, team_id: string) => ({ honour, season, team_id, player_id: '' })
const clubs = new Set(['Tche', 'Tars', 'Tmu'])

test('title_single_club', () => {
  expect(playerTitles([win('Q9448', '2004', 'Tche')], [m('P1', '2004', 'Tche')], clubs))
    .toEqual([{ honour: 'Q9448', season: '2004', team_id: 'Tche', player_id: 'P1' }])
})
test('title_two_clubs_same_season_excluded', () => {
  expect(playerTitles([win('Q9448', '2004', 'Tche')], [m('P1', '2004', 'Tche'), m('P1', '2004', 'Tars')], clubs)).toEqual([])
})
test('title_national_row_not_counted', () => {
  expect(playerTitles([win('Q9448', '2004', 'Tche')], [m('P1', '2004', 'Tche'), m('P1', '2004', 'Tnat')], clubs)).toHaveLength(1)
})
test('title_no_win_no_row', () => {
  expect(playerTitles([win('Q9448', '2004', 'Tars')], [m('P1', '2004', 'Tche')], clubs)).toEqual([])
})
test('title_ignores_player_rows_in_input', () => {
  expect(playerTitles([{ honour: 'award:Q1', season: '2004', team_id: 'Tche', player_id: 'P9' }], [m('P1', '2004', 'Tche')], clubs)).toEqual([])
})
test('national_titles_from_winner_squad', () => {
  const sq = [{ honour: 'squad:Q19317', season: '2014', team_id: 'Tger', player_id: 'P1' }, { honour: 'squad:Q19317', season: '2014', team_id: 'Targ', player_id: 'P2' }]
  expect(nationalTitles(sq, [win('Q19317', '2014', 'Tger')])).toEqual([{ honour: 'Q19317', season: '2014', team_id: 'Tger', player_id: 'P1' }])
})
test('manager_seasons', () => {
  expect(managerSeasons(1996, 2018, 'split', 2026)).toEqual({ from_season: 1996, to_season: 2017 })
  expect(managerSeasons(1986, 2013, 'split', 2026)).toEqual({ from_season: 1986, to_season: 2012 })
  expect(managerSeasons(2005, 2010, 'year', 2026)).toEqual({ from_season: 2005, to_season: 2010 })
  expect(managerSeasons(2019, 2019, 'split', 2026)).toEqual({ from_season: 2019, to_season: 2019 })
  expect(managerSeasons(2019, null, 'split', 2026)).toEqual({ from_season: 2019, to_season: 2026 })
})

test('winner_fix_replaces_and_adds', () => {
  const wins = [win('Q260858', '2008', 'Tesp')]
  const fixes = [{ honour: 'Q260858', season: '2004', team_id: 'Tgre' }, { honour: 'Q260858', season: '2008', team_id: 'Tesp2' }]
  expect(applyWinnerFixes(wins, fixes, 'Q260858')).toEqual([win('Q260858', '2004', 'Tgre'), win('Q260858', '2008', 'Tesp2')])
})
test('winner_fix_other_competition_untouched', () => {
  expect(applyWinnerFixes([win('Q1', '2004', 'A')], [{ honour: 'Q2', season: '2004', team_id: 'B' }], 'Q1')).toEqual([win('Q1', '2004', 'A')])
})

test('national_team_by_heading', () => {
  const find = nationalTeamFinder([
    { id: 'Qswe', kind: 'national', name_en: "Sweden men's national football team" },
    { id: 'Qusa', kind: 'national', name_en: "United States men's national soccer team" },
    { id: 'Qger', kind: 'national', name_en: "Germany men's national association football team" },
    { id: 'Qirl', kind: 'national', name_en: 'Republic of Ireland national football team' },
    { id: 'Qclub', kind: 'club', name_en: 'Sweden FC' },
  ])
  expect(find('Sweden')).toBe('Qswe')
  expect(find('United States')).toBe('Qusa')
  expect(find('Germany')).toBe('Qger')
  expect(find('Republic of Ireland')).toBe('Qirl')
  expect(find('Narnia')).toBeUndefined()
})
