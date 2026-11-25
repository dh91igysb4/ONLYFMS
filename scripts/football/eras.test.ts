import { expect, test } from 'vitest'
import { qLineage, qSeasonYears, summarizeSeasons } from './eras.ts'

test('qLineage_asks_previous_and_next_competitions', () => {
  const q = qLineage(['Q9448'])
  expect(q).toContain('VALUES ?c { wd:Q9448 }')
  for (const p of ['P155', 'P156', 'P1365', 'P1366']) expect(q).toContain(p)
})

test('qSeasonYears_counts_participants_per_season', () => {
  const q = qSeasonYears(['Q9448'])
  expect(q).toContain('wdt:P3450')
  expect(q).toContain('P1923')
  expect(q).toContain('COUNT(')
})

test('summarizeSeasons_range_count_and_seasons_with_teams', () => {
  const s = summarizeSeasons([{ c: 'Q1', year: '1990', teams: '20' }, { c: 'Q1', year: '1992', teams: '0' }])
  expect(s.get('Q1')).toEqual({ first: 1990, last: 1992, count: 2, withTeams: 1 })
})
