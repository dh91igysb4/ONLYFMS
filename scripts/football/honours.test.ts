// 선수 우승·대표팀 우승·감독 시즌 계산 (설계 2026-11-25-football-honours-design.md §3.1·§3.5)
import { expect, test } from 'vitest'
import { managerSeasons, nationalTitles, playerTitles } from './honours.ts'

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
