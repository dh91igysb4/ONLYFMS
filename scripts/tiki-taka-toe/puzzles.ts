// 티키타카토 판 고르기 (설계 docs/superpowers/specs/2026-11-26-tiki-taka-toe-design.md §5.1).
// 조건(conditions.ts)과 조건별 선수 집합으로 3×3 판을 만든다. 생성 명령은 generate.ts.
//
// 판 규칙(DEFAULT_RULES, 테스트로 고정):
// - 9칸 모두 정답 수 minAnswers~maxAnswers, 인지도 knownPopularity 이상 정답 minKnown명 이상.
// - 머리칸 6개 중 클럽이 clubs[0]~clubs[1]개. 한 축에 같은 종류 셋은 없다. 같은 조건 두 번 없음.
// - 겹치는 조건은 한 판에 두지 않는다(family): 같은 대회의 리그·우승·출전·결승 득점(예: PL 우승과 PL 3회 이상 우승),
//   PL과 잉글랜드 1부(eng-top, PL을 포함), PL 득점왕과 잉글랜드 1부 득점왕.
// 생성(generatePuzzles): 시드 고정 난수로 클럽 3~4개 모양을 고르고, 첫 행 클럽 → 그와 맞는 열 셋 → 열 셋 모두와 맞는
// 나머지 행 둘 순으로 뽑는다. 칸이 맞는지는 테마 조건 쌍마다 한 번 미리 센다. 많이 쓴 조건일수록 덜 뽑아 고르게 쓴다.
import type { Condition, Theme } from './conditions.ts'

export type Puzzle = { id: string; theme: Theme; rows: [string, string, string]; cols: [string, string, string] }
export type PuzzleRules = { minAnswers: number; maxAnswers: number; minKnown: number; knownPopularity: number; clubs: [number, number] }
export const DEFAULT_RULES: PuzzleRules = { minAnswers: 3, maxAnswers: 150, minKnown: 2, knownPopularity: 50, clubs: [3, 4] }

/** 클럽이 아닌 머리칸의 종류 가중치(설계 §10, 구현자 결정). 종류를 먼저 고르고 그 안에서 조건을 고른다 */
export const KIND_WEIGHTS: Record<string, number> = {
  nation: 3, teammate: 3, manager: 2, title: 2, award: 1.5, league: 1, continent: 1, squad: 1, final_goal: 0.5,
}

const COMPETITION_KINDS = new Set(['league', 'title', 'squad', 'final_goal'])
const PL_TOP_SCORER = new Set(['award:Q794775', 'award:x-england-top-flight-top-scorer'])

/** 한 판에 함께 둘 수 없는 조건 묶음 키. 없으면 null */
export function family(id: string): string | null {
  const [kind, ref] = id.split(':')
  if (COMPETITION_KINDS.has(kind)) return `comp:${ref === 'eng-top' ? 'Q9448' : ref}`
  if (PL_TOP_SCORER.has(id)) return 'award:pl-top-scorer'
  return null
}

/** 칸 정답 수와 아는 선수 수. 정답이 max를 넘으면 거기서 멈춘다(n = max + 1) */
export function cellStats(a: ReadonlySet<string>, b: ReadonlySet<string>, popularity: ReadonlyMap<string, number>, rules: PuzzleRules = DEFAULT_RULES): { n: number; known: number } {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  let n = 0, known = 0
  for (const p of small) {
    if (!big.has(p)) continue
    n++
    if ((popularity.get(p) ?? 0) >= rules.knownPopularity) known++
    if (n > rules.maxAnswers) break
  }
  return { n, known }
}

const cellOk = (s: { n: number; known: number }, rules: PuzzleRules) =>
  s.n >= rules.minAnswers && s.n <= rules.maxAnswers && s.known >= rules.minKnown

export function validPuzzle(
  p: Puzzle, sets: ReadonlyMap<string, ReadonlySet<string>>, kinds: ReadonlyMap<string, string>,
  popularity: ReadonlyMap<string, number>, rules: PuzzleRules = DEFAULT_RULES,
): boolean {
  const all = [...p.rows, ...p.cols]
  if (p.rows.length !== 3 || p.cols.length !== 3 || new Set(all).size !== 6) return false
  if (!all.every((id) => sets.has(id) && kinds.has(id))) return false
  const clubs = all.filter((id) => kinds.get(id) === 'club').length
  if (clubs < rules.clubs[0] || clubs > rules.clubs[1]) return false
  for (const axis of [p.rows, p.cols]) if (new Set(axis.map((id) => kinds.get(id))).size === 1) return false
  const fams = all.map(family).filter((f) => f !== null)
  if (new Set(fams).size !== fams.length) return false
  for (const r of p.rows) for (const c of p.cols) if (!cellOk(cellStats(sets.get(r)!, sets.get(c)!, popularity, rules), rules)) return false
  return true
}

/** 행·열 순서와 행/열 뒤바꿈을 무시한 판 키 */
export function puzzleKey(p: Puzzle): string {
  return [[...p.rows].sort().join(','), [...p.cols].sort().join(',')].sort().join('/')
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickWeighted<T>(items: readonly T[], weight: (x: T) => number, rng: () => number): T | undefined {
  let total = 0
  for (const x of items) total += weight(x)
  if (!(total > 0)) return undefined
  let r = rng() * total
  for (const x of items) {
    r -= weight(x)
    if (r < 0) return x
  }
  return items[items.length - 1]
}

/** 시도 상한: 판 하나에 이만큼, 최소 MIN_ATTEMPTS번 */
export const ATTEMPTS_PER_PUZZLE = 300
const MIN_ATTEMPTS = 2000

export function generatePuzzles(
  theme: Theme, n: number, conditions: readonly Condition[], sets: ReadonlyMap<string, ReadonlySet<string>>,
  popularity: ReadonlyMap<string, number>, seed: number, rules: PuzzleRules = DEFAULT_RULES,
): Puzzle[] {
  const pool = conditions
    .filter((c) => c.themes.includes(theme) && (sets.get(c.id)?.size ?? 0) >= rules.minAnswers)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const N = pool.length
  const kindOf = pool.map((c) => c.kind as string)
  const fam = pool.map((c) => family(c.id))
  const kinds = new Map(pool.map((c) => [c.id, c.kind as string]))

  // 칸이 되는 쌍: ok[i * N + j]. 같은 묶음끼리는 칸을 세지 않는다(한 판에 못 둔다)
  const ok = new Uint8Array(N * N)
  const neighbors: number[][] = pool.map(() => [])
  for (let i = 0; i < N; i++) {
    const si = sets.get(pool[i].id)!
    for (let j = i + 1; j < N; j++) {
      if (fam[i] !== null && fam[i] === fam[j]) continue
      if (!cellOk(cellStats(si, sets.get(pool[j].id)!, popularity, rules), rules)) continue
      ok[i * N + j] = ok[j * N + i] = 1
      neighbors[i].push(j)
      neighbors[j].push(i)
    }
  }

  const rng = mulberry32(seed)
  const uses = new Int32Array(N)
  const useWeight = (i: number) => 1 / (1 + uses[i])
  const clubs = pool.map((_, i) => i).filter((i) => kindOf[i] === 'club')

  /** 고른 것들과 겹치지 않는 후보 중 slot 종류('club' 또는 다른 종류)를 하나 */
  const pick = (cands: readonly number[], slot: 'club' | 'other', chosen: readonly number[]): number | undefined => {
    const free = cands.filter((i) => (slot === 'club') === (kindOf[i] === 'club') &&
      !chosen.includes(i) && (fam[i] === null || !chosen.some((c) => fam[c] === fam[i])))
    if (slot === 'club') return pickWeighted(free, useWeight, rng)
    const byKind = new Map<string, number[]>()
    for (const i of free) (byKind.get(kindOf[i]) ?? byKind.set(kindOf[i], []).get(kindOf[i])!).push(i)
    const kind = pickWeighted([...byKind.keys()], (k) => KIND_WEIGHTS[k] ?? 1, rng)
    return kind === undefined ? undefined : pickWeighted(byKind.get(kind)!, useWeight, rng)
  }

  const shuffle = <T>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]]
    }
    return xs
  }

  const tryBuild = (): [number[], number[]] | null => {
    // 클럽 4개: 행 2·열 2. 클럽 3개: 행 2·열 1(열의 나머지 둘은 다른 종류라 축 규칙은 저절로 지켜진다)
    const four = rng() < 0.5
    const colSlots: ('club' | 'other')[] = four ? ['club', 'club', 'other'] : ['club', 'other', 'other']
    const r0 = pickWeighted(clubs, useWeight, rng)
    if (r0 === undefined) return null
    const chosen = [r0]
    const cols: number[] = []
    for (const slot of colSlots) {
      const c = pick(neighbors[r0], slot, chosen)
      if (c === undefined) return null
      cols.push(c)
      chosen.push(c)
    }
    const common = neighbors[cols[0]].filter((i) => ok[i * N + cols[1]] && ok[i * N + cols[2]])
    const rows = [r0]
    for (const slot of ['club', 'other'] as const) {
      const r = pick(common, slot, chosen)
      if (r === undefined) return null
      rows.push(r)
      chosen.push(r)
    }
    shuffle(rows)
    shuffle(cols)
    return rng() < 0.5 ? [rows, cols] : [cols, rows]
  }

  const out: Puzzle[] = []
  const seen = new Set<string>()
  const cap = Math.max(MIN_ATTEMPTS, n * ATTEMPTS_PER_PUZZLE)
  for (let attempt = 0; attempt < cap && out.length < n; attempt++) {
    const built = tryBuild()
    if (!built) continue
    const [r, c] = built
    const p: Puzzle = {
      id: `${theme}-${String(out.length + 1).padStart(4, '0')}`, theme,
      rows: r.map((i) => pool[i].id) as Puzzle['rows'], cols: c.map((i) => pool[i].id) as Puzzle['cols'],
    }
    const key = puzzleKey(p)
    if (seen.has(key) || !validPuzzle(p, sets, kinds, popularity, rules)) continue
    seen.add(key)
    out.push(p)
    for (const i of [...r, ...c]) uses[i]++
  }
  return out
}
