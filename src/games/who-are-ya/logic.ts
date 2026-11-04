// 후알야 규칙 (원본 단독판과 같다). 순수 함수만, 외부 의존 없음 (Deno 호환).
// 정답은 Puzzle에 스냅샷으로 저장하고, 판정은 항상 스냅샷과 비교한다 — 데이터가 갱신돼도
// 이전 버전이 출제한 문제를 그대로 풀 수 있다 (CLAUDE.md 로직 버전 규칙, 설계 §4.2·§4.5).
import type { Ctx, GameLogic, PlatformAction } from '../types.ts'
import { LEAGUES, PLAYERS, TEAMS, type PlayerRow } from './data.ts'

export const MAX_GUESSES = 8
/** 힌트는 이만큼 틀린 뒤부터 */
export const HINT_AFTER = 3
export const HINT_PENALTY = 3

export type Tier = 'easy' | 'normal' | 'hard'
const TIER_MAX: Record<Tier, number> = { easy: 1, normal: 2, hard: 3 }

/** 선수 한 명의 판정용 정보. 출제·추측 시점 데이터의 사본이다 */
export type Snapshot = {
  id: number
  name: string
  /** 팀 이름 */
  team: string
  teamCode: string
  /** 리그 번호(데이터 순서) */
  league: number
  /** 원본 리그 이름 (같은 리그 판정 기준) */
  leagueName: string
  leagueKo: string
  cc: string
  cn: string
  /** 세부 포지션 (ST, CB …) */
  pos: string
  /** 포지션 그룹 GK/DF/MF/FW */
  grp: string
  age: number | null
  shirt: number | null
}

export type Tile = 'c' | 'p' | 'a'
export type Arrow = '▲' | '▼' | ''
export type Feedback = {
  team: Tile
  nat: Tile
  pos: Tile
  age: Tile
  ageArrow: Arrow
  shirt: Tile
  shirtArrow: Arrow
}
export type GuessRow = Snapshot & { fb: Feedback }

export type Puzzle = { answer: Snapshot; tier: Tier; league: string }
export type Action = { type: 'guess'; id: number } | { type: 'hint' }
export type State = {
  guesses: GuessRow[]
  won: boolean
  gaveUp: boolean
  /** 힌트를 쓰면 정답 이니셜 */
  initials: string | null
}
export type PublicState = State

const BY_ID = new Map<number, PlayerRow>(PLAYERS.map((p) => [p[0], p]))

/** 지금 데이터에서 선수 스냅샷을 만든다. 없으면 undefined */
export function snapshotOf(id: number): Snapshot | undefined {
  const p = BY_ID.get(id)
  if (!p) return undefined
  const [name, code, li] = TEAMS[p[2]]
  const lg = LEAGUES[li]
  return {
    id: p[0], name: p[1], team: name, teamCode: code, league: li, leagueName: lg[1], leagueKo: lg[2],
    cc: p[3], cn: p[4], pos: p[5], grp: p[6], age: p[7], shirt: p[8],
  }
}

function num(g: number | null, a: number | null): [Tile, Arrow] {
  if (g == null || a == null) return ['a', '']
  if (g === a) return ['c', '']
  return ['a', a > g ? '▲' : '▼']
}

/** 추측 g를 정답 a와 비교한다 */
export function compare(g: Snapshot, a: Snapshot): Feedback {
  const [age, ageArrow] = num(g.age, a.age)
  const [shirt, shirtArrow] = num(g.shirt, a.shirt)
  return {
    team: g.team === a.team ? 'c' : g.leagueName === a.leagueName ? 'p' : 'a',
    nat: g.cc === a.cc ? 'c' : 'a',
    pos: g.grp === a.grp ? 'c' : 'a',
    age, ageArrow, shirt, shirtArrow,
  }
}

/** 이름 단어마다 첫 글자 + '.' */
export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).map((w) => [...w][0] + '.').join(' ')
}

function finished(s: State): boolean {
  return s.won || s.gaveUp || s.guesses.length >= MAX_GUESSES
}

function asTier(v: string | undefined): Tier {
  return v === 'normal' || v === 'hard' ? v : 'easy'
}

export const logic: GameLogic<Puzzle, Action, State, PublicState> = {
  version: 3,

  pickPuzzle(rng, options) {
    const tier = asTier(options.tier)
    const li = LEAGUES.findIndex((l) => l[0] === options.league)
    const league = li >= 0 ? LEAGUES[li][0] : 'all'
    const max = TIER_MAX[tier]
    let pool = PLAYERS.filter((p) => p[9] <= max && (li < 0 || TEAMS[p[2]][2] === li))
    if (pool.length === 0) pool = PLAYERS
    const row = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
    return { answer: snapshotOf(row[0])!, tier, league }
  },

  puzzleKey(p) {
    return String(p.answer.id)
  },

  initState() {
    return { guesses: [], won: false, gaveUp: false, initials: null }
  },

  apply(puzzle, state, action: Action | PlatformAction, _ctx: Ctx) {
    if (finished(state)) return { error: '이미 끝난 게임이에요' }
    switch (action.type) {
      case 'give_up':
        return { state: { ...state, gaveUp: true } }
      case 'hint':
        if (state.initials !== null) return { error: '힌트는 한 번만 쓸 수 있어요' }
        if (state.guesses.length < HINT_AFTER) return { error: `힌트는 ${HINT_AFTER}번 틀린 뒤에 쓸 수 있어요` }
        return { state: { ...state, initials: initialsOf(puzzle.answer.name) } }
      case 'guess': {
        const id = action.id
        if (typeof id !== 'number' || !Number.isInteger(id)) return { error: '선수를 목록에서 골라 주세요' }
        if (state.guesses.some((g) => g.id === id)) return { error: '이미 고른 선수예요' }
        // 정답 선수는 출제 당시 스냅숏으로 비교한다 (그사이 이적·생일로 정답 줄이 회색이 되지 않게).
        const g = id === puzzle.answer.id ? puzzle.answer : snapshotOf(id)
        if (!g) return { error: '없는 선수예요' }
        const row: GuessRow = { ...g, fb: compare(g, puzzle.answer) }
        return { state: { ...state, guesses: [...state.guesses, row], won: id === puzzle.answer.id } }
      }
      default:
        return { error: '알 수 없는 행동이에요' }
    }
  },

  isFinished(state) {
    return finished(state)
  },

  score(state) {
    if (!state.won) return 0
    const base = state.guesses.length <= 4 ? 10 : 8
    return Math.max(0, base - (state.initials !== null ? HINT_PENALTY : 0))
  },

  actionCount(state) {
    return state.guesses.length
  },

  publicState(state) {
    return state
  },

  reveal(puzzle) {
    return puzzle.answer
  },
}
