// 빠진 경력 찾기 (gaps.ts)
import { describe, expect, test } from 'vitest'
import { findGaps, wikiUrl } from './gaps.ts'

const POOL = new Set(['Q18741', 'Q495299', 'Q81888'])
const base = {
  player: 'Q20737387', name: 'Davinson Sánchez', title: 'Davinson Sánchez', pool: POOL, from: 1987, now: 2026,
  stints: [
    { team: 'Q81888', from: 2016, to: 2017, loan: false },
    { team: 'Q18741', from: 2017, to: 2023, loan: false },
    { team: 'Q495299', from: 2023, to: null, loan: false },
    { team: 'Q999', from: 2013, to: 2016, loan: false },
  ],
}

describe('findGaps', () => {
  test('no_spells_gives_add_rows_for_pool_clubs_only', () => {
    const r = findGaps({ ...base, spells: [] })
    expect(r.map((x) => [x.team_id, x.start_date, x.end_date])).toEqual([['Q81888', '2016', '2017'], ['Q18741', '2017', '2023'], ['Q495299', '2023', '']])
    expect(r[0]).toEqual({
      action: 'add', player_id: 'Q20737387', team_id: 'Q81888', source_ref: '', start_date: '2016', end_date: '2017', loan: 'false',
      source_url: 'https://en.wikipedia.org/wiki/Davinson_S%C3%A1nchez', note: 'Davinson Sánchez · 위키백과 정보상자',
    })
  })
  test('overlapping_existing_spell_is_not_a_gap', () => {
    const r = findGaps({ ...base, spells: [{ team_id: 'Q18741', start_date: '2017-08-23', end_date: '' }, { team_id: 'Q81888', start_date: '2016', end_date: '2017' }] })
    expect(r.map((x) => x.team_id)).toEqual(['Q495299'])
  })
  test('second_stint_at_same_club_is_a_gap', () => {
    const r = findGaps({ ...base, stints: [{ team: 'Q18741', from: 2008, to: 2010, loan: false }, { team: 'Q18741', from: 2015, to: 2016, loan: true }], spells: [{ team_id: 'Q18741', start_date: '2008', end_date: '2010' }] })
    expect(r.map((x) => [x.start_date, x.loan])).toEqual([['2015', 'true']])
  })
  test('stint_before_from_year_is_ignored', () => {
    expect(findGaps({ ...base, stints: [{ team: 'Q18741', from: 1980, to: 1986, loan: false }], spells: [] })).toEqual([])
  })
  test('wiki_url', () => {
    expect(wikiUrl("N'Golo Kanté")).toBe('https://en.wikipedia.org/wiki/N%27Golo_Kant%C3%A9')
  })
})
