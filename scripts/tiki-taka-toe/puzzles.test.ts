// 티키타카토 판 고르기 (설계 2026-11-26-tiki-taka-toe-design.md §5.1)
import { describe, expect, test } from 'vitest'
import type { Condition, ConditionKind } from './conditions.ts'
import { DEFAULT_RULES, generatePuzzles, puzzleKey, validPuzzle, type Puzzle } from './puzzles.ts'

// 머리칸 6개: 행 r1(클럽) r2(클럽) r3(국적), 열 c1(클럽) c2(감독) c3(국적)
const KINDS: Record<string, ConditionKind> = {
  'club:A': 'club', 'club:B': 'club', 'club:C': 'club', 'club:D': 'club', 'club:E': 'club',
  'nation:N1': 'nation', 'nation:N2': 'nation', 'nation:N3': 'nation',
  'manager:M1': 'manager', 'manager:M2': 'manager',
  'league:Q9448': 'league', 'league:eng-top': 'league',
  'title:Q9448:1': 'title', 'title:eng-top:1': 'title', 'title:Q9448:3': 'title',
  'award:Q794775': 'award', 'award:x-england-top-flight-top-scorer': 'award',
}
const kinds = new Map(Object.entries(KINDS))

/** 모든 두 조건 쌍마다 그 둘에만 속한 선수 `per`명(인지도 pop). 칸 정답 수 = per */
function pairSets(ids: string[], per = 4, pop = 60, over: Record<string, { n: number; known: number }> = {}) {
  const sets = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]))
  const popularity = new Map<string, number>()
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = `${ids[i]}|${ids[j]}`
      const o = over[key] ?? over[`${ids[j]}|${ids[i]}`] ?? { n: per, known: per }
      for (let k = 0; k < o.n; k++) {
        const p = `${key}#${k}`
        sets.get(ids[i])!.add(p)
        sets.get(ids[j])!.add(p)
        popularity.set(p, k < o.known ? pop : 10)
      }
    }
  }
  return { sets, popularity }
}

const BASE: Puzzle = { id: 'eng-0001', theme: 'eng', rows: ['club:A', 'club:B', 'nation:N1'], cols: ['club:C', 'manager:M1', 'nation:N2'] }
const ALL = Object.keys(KINDS)

describe('validPuzzle', () => {
  test('rejects_small_and_large_cells', () => {
    const ok = pairSets(ALL)
    expect(validPuzzle(BASE, ok.sets, kinds, ok.popularity)).toBe(true)
    for (const [n, want] of [[2, false], [3, true], [150, true], [151, false]] as const) {
      const { sets, popularity } = pairSets(ALL, 4, 60, { 'club:A|club:C': { n, known: 2 } })
      expect(validPuzzle(BASE, sets, kinds, popularity), `칸 정답 ${n}명`).toBe(want)
    }
  })

  test('rejects_unknown_only', () => {
    const one = pairSets(ALL, 4, 60, { 'nation:N1|manager:M1': { n: 10, known: 1 } })
    expect(validPuzzle(BASE, one.sets, kinds, one.popularity)).toBe(false)
    const two = pairSets(ALL, 4, 60, { 'nation:N1|manager:M1': { n: 10, known: 2 } })
    expect(validPuzzle(BASE, two.sets, kinds, two.popularity)).toBe(true)
    // 인지도 경계: 50은 아는 선수, 49는 아님
    const at50 = pairSets(ALL, 4, 50)
    expect(validPuzzle(BASE, at50.sets, kinds, at50.popularity)).toBe(true)
    const at49 = pairSets(ALL, 4, 49)
    expect(validPuzzle(BASE, at49.sets, kinds, at49.popularity)).toBe(false)
  })

  test('club_count_and_axis_kinds', () => {
    const { sets, popularity } = pairSets(ALL)
    const v = (rows: string[], cols: string[]) => validPuzzle({ ...BASE, rows: rows as Puzzle['rows'], cols: cols as Puzzle['cols'] }, sets, kinds, popularity)
    // 클럽 2개
    expect(v(['club:A', 'manager:M2', 'nation:N1'], ['club:C', 'manager:M1', 'nation:N2'])).toBe(false)
    // 클럽 4개(2·2)는 가능
    expect(v(['club:A', 'club:B', 'nation:N1'], ['club:C', 'club:D', 'nation:N2'])).toBe(true)
    // 클럽 5개
    expect(v(['club:A', 'club:B', 'nation:N1'], ['club:C', 'club:D', 'club:E'])).toBe(false)
    // 한 축이 클럽 셋(클럽 4개)
    expect(v(['club:A', 'club:B', 'club:E'], ['club:C', 'manager:M1', 'nation:N2'])).toBe(false)
    // 한 축이 국적 셋: 클럽 3~4개면 다른 축이 클럽 셋이 되므로, 클럽 수 규칙을 풀고 축 규칙만 본다
    const loose = { ...DEFAULT_RULES, clubs: [2, 4] as [number, number] }
    const w = (cols: string[]) => validPuzzle({ ...BASE, rows: ['club:A', 'club:B', 'manager:M1'], cols: cols as Puzzle['cols'] }, sets, kinds, popularity, loose)
    expect(w(['nation:N1', 'nation:N2', 'manager:M2'])).toBe(true)
    expect(w(['nation:N1', 'nation:N2', 'nation:N3'])).toBe(false)
  })

  test('no_duplicate_condition', () => {
    const { sets, popularity } = pairSets(ALL)
    expect(validPuzzle({ ...BASE, cols: ['club:A', 'manager:M1', 'nation:N2'] }, sets, kinds, popularity)).toBe(false)
    expect(validPuzzle({ ...BASE, rows: ['club:A', 'club:A', 'nation:N1'] }, sets, kinds, popularity)).toBe(false)
    // 없는 조건
    expect(validPuzzle({ ...BASE, rows: ['club:A', 'club:B', 'nation:ZZ'] }, sets, kinds, popularity)).toBe(false)
  })

  test('rejects_overlapping_pairs', () => {
    const { sets, popularity } = pairSets(ALL)
    const v = (r3: string, c3: string) => validPuzzle({ ...BASE, rows: ['club:A', 'club:B', r3], cols: ['club:C', 'manager:M1', c3] }, sets, kinds, popularity)
    expect(v('league:Q9448', 'nation:N2')).toBe(true)
    expect(v('league:Q9448', 'league:eng-top')).toBe(false)
    expect(v('title:Q9448:1', 'title:eng-top:1')).toBe(false)
    expect(v('award:Q794775', 'award:x-england-top-flight-top-scorer')).toBe(false)
    // 같은 대회의 리그·우승(부분집합)도 한 판에 두지 않는다
    expect(v('title:Q9448:1', 'title:Q9448:3')).toBe(false)
    expect(v('league:Q9448', 'title:eng-top:1')).toBe(false)
    // 같은 축이라도
    expect(validPuzzle({ ...BASE, rows: ['club:A', 'league:Q9448', 'league:eng-top'] }, sets, kinds, popularity)).toBe(false)
  })

  test('rules_are_the_spec_values', () => {
    expect(DEFAULT_RULES).toEqual({ minAnswers: 3, maxAnswers: 150, minKnown: 2, knownPopularity: 50, clubs: [3, 4] })
  })
})

describe('generatePuzzles', () => {
  const cond = (id: string, themes: Condition['themes'] = ['eng', 'eur']): Condition =>
    ({ id, kind: KINDS[id] ?? (id.split(':')[0] as ConditionKind), label_ko: id, label_en: id, ref: id.split(':')[1], themes })
  const ids = [...ALL, 'club:X']
  const conditions = [...ALL.map((id) => cond(id)), cond('club:X', ['esp'])]
  const { sets, popularity } = pairSets(ids)
  const allKinds = new Map(conditions.map((c) => [c.id, c.kind as string]))

  test('deterministic_and_unique', () => {
    const a = generatePuzzles('eng', 40, conditions, sets, popularity, 7)
    const b = generatePuzzles('eng', 40, conditions, sets, popularity, 7)
    expect(a).toEqual(b)
    expect(a).toHaveLength(40)
    expect(a.map((p) => p.id).slice(0, 2)).toEqual(['eng-0001', 'eng-0002'])
    expect(new Set(a.map(puzzleKey)).size).toBe(a.length)
    for (const p of a) {
      expect(p.theme).toBe('eng')
      expect(validPuzzle(p, sets, allKinds, popularity)).toBe(true)
      // 테마 밖 조건(club:X는 esp만)은 쓰지 않는다
      expect([...p.rows, ...p.cols]).not.toContain('club:X')
    }
    expect(generatePuzzles('eng', 40, conditions, sets, popularity, 8)).not.toEqual(a)
  })

  test('puzzle_key_ignores_order_and_transpose', () => {
    const t: Puzzle = { ...BASE, rows: BASE.cols, cols: BASE.rows }
    const s: Puzzle = { ...BASE, rows: [BASE.rows[2], BASE.rows[0], BASE.rows[1]] }
    expect(puzzleKey(t)).toBe(puzzleKey(BASE))
    expect(puzzleKey(s)).toBe(puzzleKey(BASE))
  })

  test('stops_when_it_cannot_fill', () => {
    // esp 테마 조건은 club:X 하나뿐이라 판을 만들 수 없다: 무한 반복 없이 빈 결과
    expect(generatePuzzles('esp', 5, conditions, sets, popularity, 1)).toEqual([])
  })
})
