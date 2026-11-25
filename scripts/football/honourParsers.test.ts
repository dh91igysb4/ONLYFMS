// 위키백과 문서 종류별 추출 (설계 2026-11-25-football-honours-design.md §3.3).
// 픽스처는 2026-11-25에 받은 실제 문서를 잘라 둔 것이다:
//   ballon_dor = "Ballon d'Or" Winners 절, pl_golden_boot = "Premier League Golden Boot" Winners 절,
//   coppa_italia_finals = "List of Coppa Italia finals" 결승 절, wc2014_squads = "2014 FIFA World Cup squads" 독일·아르헨티나 절,
//   wenger = "Arsène Wenger" 정보상자.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseAwardList, parseFinals, parseManagerInfobox, parseSquads } from './honourParsers.ts'
import { sectionText, stripComments, tables, templates, wikiLinks } from './wikitext.ts'

const fx = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'wikitext', `${name}.txt`), 'utf8')

describe('wikitext', () => {
  test('links_normalized', () => {
    expect(wikiLinks('[[AC Milan|Milan]] and [[arsenal_F.C.#History]] [[File:x.jpg|thumb|[[Nope]]]]')).toEqual(['AC Milan', 'Arsenal F.C.'])
  })
  test('section_text', () => {
    const t = '== A ==\na\n=== Golden Ball ===\nball\n==== sub ====\nsub\n=== Golden Boot ===\nboot'
    expect(sectionText(t, 'Golden Ball')).toBe('ball')
    expect(sectionText(t, 'sub')).toBe('sub')
    expect(sectionText(t, 'Nope')).toBeNull()
  })
  test('comments_stripped', () => {
    expect(stripComments('a<!-- [[X]] -->b')).toBe('ab')
  })
  test('templates_brace_matched', () => {
    expect(templates('x {{A|{{b}}|c}} {{a|d}} {{Other}}', /^a$/i)).toEqual(['{{A|{{b}}|c}}', '{{a|d}}'])
  })
  test('tables_rowspan_copied', () => {
    const t = '{|\n|-\n| rowspan="2" | 1999 || [[A]]\n|-\n| [[B]]\n|}'
    expect(tables(t)).toEqual([[['1999', '[[A]]'], ['1999', '[[B]]']]])
  })
  test('tables_multiline_template_not_a_cell', () => {
    const t = '{|\n|-\n| 2001 || {{cite web|url=x\n|publisher=y}} [[A]]\n|}'
    expect(tables(t)[0]).toHaveLength(1)
    expect(tables(t)[0][0][0]).toBe('2001')
  })
})

describe('awards', () => {
  test('award_list_ballon_dor', () => {
    const h = parseAwardList(fx('ballon_dor'), { from: 1987, seasonCol: 'year' })
    expect(h.find((x) => x.season === 1995)?.link).toBe('George Weah')
    expect(h.find((x) => x.season === 1997)?.link).toBe('Ronaldo (Brazilian footballer)')
    expect(h.filter((x) => x.season >= 1987 && x.season <= 2025)).toHaveLength(38)
    expect(h.every((x) => x.season >= 1987)).toBe(true)
  })
  test('award_skip_not_awarded', () => {
    expect(parseAwardList(fx('ballon_dor'), { from: 1987, seasonCol: 'year' }).some((x) => x.season === 2020)).toBe(false)
  })
  test('award_club_before_player', () => {
    // 쉬페르리그 득점왕 표는 클럽 칸이 선수 칸보다 앞이다: {{Sortname}} 선수 칸을 고른다
    const t = '{|\n|-\n| [[1995–96 Süper Lig|1995–96]] || [[Galatasaray S.K. (football)|Galatasaray]] || {{flagicon|Turkey}} {{Sortname|Metin|Oktay}} (1) || 23\n|}'
    expect(parseAwardList(t, { from: 1987, seasonCol: 'start' })).toEqual([{ season: 1995, link: 'Metin Oktay' }])
  })
  test('award_nested_sortname', () => {
    // PL 골든부트 2003–04: {{sort|Henry 2|{{sortname|Thierry|Henry}}}}
    const t = '{|\n|-\n| [[2003–04 FA Premier League|2003–04]] || {{sort|Henry 2|{{sortname|Thierry|Henry}}}} {{small|(2)}} || [[Arsenal F.C.|Arsenal]]\n|}'
    expect(parseAwardList(t, { from: 1992, seasonCol: 'start' })).toEqual([{ season: 2003, link: 'Thierry Henry' }])
  })
  test('award_season_in_nowrap', () => {
    const t = '{|\n|-\n| {{nowrap|[[1999–2000 La Liga|1999–2000]]}} || {{flagicon|Spain}} {{sortname||Salva|Salva Ballesta}} || [[Racing de Santander|Racing]]\n|}'
    expect(parseAwardList(t, { from: 1987, seasonCol: 'start' })).toEqual([{ season: 1999, link: 'Salva Ballesta' }])
  })
  test('award_ties', () => {
    const h = parseAwardList(fx('pl_golden_boot'), { from: 1992, seasonCol: 'start' }).filter((x) => x.season === 2018)
    expect(h.map((x) => x.link).sort()).toEqual(['Mohamed Salah', 'Pierre-Emerick Aubameyang', 'Sadio Mané'])
  })
})

describe('finals', () => {
  test('finals_coppa_italia', () => {
    const h = parseFinals(fx('coppa_italia_finals'), { from: 1987, seasonCol: 'start' })
    expect(h.find((x) => x.season === 2005)?.link).toBe('Inter Milan')
    expect(h.find((x) => x.season === 2006)?.link).toBe('AS Roma')
    expect(new Set(h.map((x) => x.season)).size).toBe(h.length)
    expect(h.length).toBeGreaterThanOrEqual(38)
  })
})

describe('finals_more', () => {
  test('finals_season_in_sort', () => {
    // List of Belgian Cup finals: 회차 칸 다음 {{sort|키|[[시즌]]}}
    const t = '{|\n|-\n| 68th || {{sort|2022–23 Belgian Cup (68)|[[2022–23 Belgian Cup|2022–23]]}} || [[Royal Antwerp FC|Antwerp]] || [[2023 Belgian Cup final|2–0]] || [[KV Mechelen|Mechelen]]\n|}'
    expect(parseFinals(t, { from: 1987, seasonCol: 'start' })).toEqual([{ season: 2022, link: 'Royal Antwerp FC' }])
  })
})

describe('squads', () => {
  test('squads_wc2014', () => {
    const s = parseSquads(fx('wc2014_squads'))
    const g = s.find((x) => x.team === 'Germany')!
    expect(g.players).toHaveLength(23)
    expect(g.players).toContain('Manuel Neuer')
    expect(g.players).not.toContain('Joachim Löw')
    expect(s.find((x) => x.team === 'Argentina')?.players).toContain('Lionel Messi')
  })
})

describe('managers', () => {
  test('infobox_wenger', () => {
    const r = parseManagerInfobox(fx('wenger'))
    expect(r).toContainEqual({ club: 'Arsenal F.C.', from: 1996, to: 2018, caretaker: false })
    expect(r).toHaveLength(4)
  })
  test('infobox_present_and_caretaker', () => {
    const t = '{{Infobox football biography\n| manageryears1 = 2019-\n| managerclubs1 = [[Arsenal F.C.|Arsenal]]\n| manageryears2 = 2019\n| managerclubs2 = [[Arsenal F.C.]] (caretaker)\n}}'
    expect(parseManagerInfobox(t)).toEqual([
      { club: 'Arsenal F.C.', from: 2019, to: null, caretaker: false },
      { club: 'Arsenal F.C.', from: 2019, to: 2019, caretaker: true },
    ])
  })
})
