import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { BALLON_MARK, legendNote, mergeLegendRows, parseNominees, qResolveNames, resolveNominees, type Nominee } from './legends.ts'
import { parseCsv, type Row } from './wikidata.ts'

const nominee = (name: string, years: number[], best: number | null = 1, player_id = ''): Nominee => ({ name, nation_ko: '', years, best_rank: best, player_id })

test('parseNominees', () => {
  expect(parseNominees([
    { name: ' Ronaldo ', nation_ko: '브라질', years: '2002 1996  1997', best_rank: '1', player_id: '' },
    { name: 'Nobody', nation_ko: '', years: '2004', best_rank: '', player_id: 'Q5' },
    { name: '', nation_ko: '', years: '', best_rank: '', player_id: '' },
  ])).toEqual([
    { name: 'Ronaldo', nation_ko: '브라질', years: [1996, 1997, 2002], best_rank: 1, player_id: '' },
    { name: 'Nobody', nation_ko: '', years: [2004], best_rank: null, player_id: 'Q5' },
  ])
})

test('nominees_file_follows_selection_rule', () => {
  const rows = parseCsv(readFileSync(join(import.meta.dirname, '..', '..', 'data', 'football', 'manual', 'ballon_dor_nominees.csv'), 'utf8'))
  const ns = parseNominees(rows)
  expect(ns).toHaveLength(381)
  expect(new Set(ns.map((n) => n.name)).size).toBe(381)
  for (const n of ns) {
    expect(n.years.length, n.name).toBeGreaterThan(0)
    // 1990~1999년만 나온 선수는 그해 상위 5위 안
    if (n.years.every((y) => y < 2000)) expect(n.best_rank, n.name).toBeLessThanOrEqual(5)
    for (const y of n.years) expect(y >= 1990 && y <= 2025 && y !== 2020, `${n.name} ${y}`).toBe(true)
  }
  expect(ns.find((n) => n.name === 'Lothar Matthäus')?.years).toEqual([1990, 1991])
})

test('qResolveNames_escapes_and_tags', () => {
  const q = qResolveNames(['Kaká', 'A "B" C\\D'])
  expect(q).toContain('"Kaká"@en "Kaká"@mul')
  expect(q).toContain('"A \\"B\\" C\\\\D"@en')
  expect(q).toContain('rdfs:label|skos:altLabel ?lit')
  expect(q).toContain('wd:Q937857')
})

test('resolve_picks_most_linked_plausible_candidate', () => {
  const rows: Row[] = [
    { lit: 'Ronaldo', p: 'Q529207', links: '150', birth: '1976-09-18T00:00:00Z' },
    { lit: 'Ronaldo', p: 'Q100', links: '10', birth: '1990-01-01T00:00:00Z' }, // 1996년 후보로는 6세 → 제외
    { lit: 'Ronaldo', p: 'Q101', links: '20', birth: '1970-01-01T00:00:00Z' },
    { lit: 'Twin', p: 'Q1', links: '30', birth: '1980-01-01T00:00:00Z' },
    { lit: 'Twin', p: 'Q2', links: '20', birth: '1981-01-01T00:00:00Z' },
    { lit: 'Solo', p: 'Q3', links: '5' },
    { lit: 'Solo', p: 'Q3', links: '5', birth: '1975-05-05T00:00:00Z' }, // 같은 후보가 여러 줄
  ]
  const r = resolveNominees([
    nominee('Ronaldo', [1996, 2002]), nominee('Twin', [2005]), nominee('Solo', [2000]), nominee('Ghost', [2010]),
    nominee('Fixed', [2010], 3, 'Q42'), nominee('Typo', [2010], 3, 'q42'),
  ], rows)
  expect(r[0]).toMatchObject({ status: 'ok', player_id: 'Q529207', birth_year: '1976', sitelinks: '150', others: 'Q101(20, 1970)' })
  expect(r[1]).toMatchObject({ status: 'ambiguous', player_id: 'Q1', others: 'Q2(20, 1981)' })
  expect(r[2]).toMatchObject({ status: 'ok', player_id: 'Q3', birth_year: '1975' })
  expect(r[3]).toMatchObject({ status: 'none', player_id: '' })
  expect(r[4]).toMatchObject({ status: 'manual', player_id: 'Q42' })
  expect(r[5]).toMatchObject({ status: 'none', player_id: '' })
})

test('legendNote_format', () => {
  expect(legendNote(nominee('Lionel Messi', [2006, 2007, 2022], 1))).toBe(`${BALLON_MARK} Lionel Messi · 후보 2006~2022 3회 · 최고 1위`)
  expect(legendNote(nominee('Yuri Zhirkov', [2008], null))).toBe(`${BALLON_MARK} Yuri Zhirkov · 후보 2008 · 무득표`)
})

test('mergeLegendRows_keeps_manual_rows_and_regenerates_ballon_rows', () => {
  const ns = [nominee('A', [2001]), nominee('B', [2002]), nominee('C', [2003]), nominee('D', [2004])]
  const resolved = [
    { name: 'A', status: 'ok' as const, player_id: 'Q30', birth_year: '', sitelinks: '', others: '' },
    { name: 'B', status: 'ambiguous' as const, player_id: 'Q31', birth_year: '', sitelinks: '', others: '' },
    { name: 'C', status: 'manual' as const, player_id: 'Q4', birth_year: '', sitelinks: '', others: '' },
    { name: 'D', status: 'ok' as const, player_id: 'Q9', birth_year: '', sitelinks: '', others: '' }, // 손으로 넣은 줄과 같은 QID
  ]
  const out = mergeLegendRows([
    { player_id: 'Q9', note: '박지성' },
    { player_id: 'Q77', note: `${BALLON_MARK} 옛 결과` }, // 다시 만들면 사라진다
  ], ns, resolved)
  expect(out).toEqual([
    { player_id: 'Q30', note: `${BALLON_MARK} A · 후보 2001 · 최고 1위` },
    { player_id: 'Q4', note: `${BALLON_MARK} C · 후보 2003 · 최고 1위` },
    { player_id: 'Q9', note: '박지성' },
  ])
})
