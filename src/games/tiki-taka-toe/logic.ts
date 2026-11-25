// 티키타카토 규칙 (설계 docs/superpowers/specs/2026-11-26-tiki-taka-toe-design.md §3, §6). 순수 함수, 외부 의존 없음.
import type { DuelLogic, DuelResult, Seat } from '../types.ts'

export type Header = { id: string; kind: string; label: string }
/** 칸 순서는 행 우선 0..8 */
export type Prepared = { puzzle_id: string; rows: Header[]; cols: Header[]; answers: string[][]; examples: string[][] }

export type Action =
  | { type: 'guess'; cell: number; playerId: string; name: string; offerDraw?: true }
  | { type: 'pass'; offerDraw?: true }
  | { type: 'acceptDraw' }

export type Last = {
  seat: Seat
  type: 'guess' | 'pass' | 'acceptDraw'
  cell?: number
  name?: string
  correct?: boolean
  steal?: boolean
  offeredDraw?: boolean
}

export type View = {
  rows: Header[]
  cols: Header[]
  cells: { owner: Seat | null; name: string | null }[]
  steals: [number, number]
  toMove: Seat
  drawOffer: Seat | null
  canOffer: [boolean, boolean]
  last: Last | null
  quiet: number
  examples: string[][] | null
}

export type State = {
  puzzleId: string
  rows: Header[]
  cols: Header[]
  answers: string[][]
  examples: string[][]
  owners: (Seat | null)[]
  names: (string | null)[]
  /** 맞게 놓인 적 있는 선수 id */
  used: string[]
  /** [좌석 0, 좌석 1] 남은 스틸 */
  steals: [number, number]
  seat: Seat
  /** 칸 주인이 그대로인 연속 행동 수 */
  quiet: number
  turnNo: number
  drawOffer: Seat | null
  /** 이 좌석은 자기 다음 행동에 무승부를 제안할 수 없다(거절당한 직후) */
  noOffer: Seat | null
  last: Last | null
  /** 무승부 수락으로 끝났나 */
  drawn: boolean
}

export const QUIET_LIMIT = 6
const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

const isHeaders = (h: unknown): h is Header[] =>
  Array.isArray(h) &&
  h.length === 3 &&
  h.every((x) => x && typeof x.id === 'string' && typeof x.kind === 'string' && typeof x.label === 'string')
const isGrid = (g: unknown): g is string[][] =>
  Array.isArray(g) && g.length === 9 && g.every((c) => Array.isArray(c) && c.every((p) => typeof p === 'string'))

function init(_rng: () => number, _options: Record<string, string>, prepared?: unknown): State {
  const p = prepared as Partial<Prepared> | null | undefined
  if (
    !p ||
    typeof p !== 'object' ||
    typeof p.puzzle_id !== 'string' ||
    !isHeaders(p.rows) ||
    !isHeaders(p.cols) ||
    !isGrid(p.answers) ||
    !isGrid(p.examples)
  ) {
    throw new Error('invalid_prepared')
  }
  return {
    puzzleId: p.puzzle_id,
    rows: p.rows,
    cols: p.cols,
    answers: p.answers,
    examples: p.examples,
    owners: Array(9).fill(null),
    names: Array(9).fill(null),
    used: [],
    steals: [5, 6],
    seat: 0,
    quiet: 0,
    turnNo: 0,
    drawOffer: null,
    noOffer: null,
    last: null,
    drawn: false,
  }
}

function winnerLine(s: State): Seat | null {
  for (const [a, b, c] of LINES) {
    const o = s.owners[a]
    if (o !== null && o === s.owners[b] && o === s.owners[c]) return o
  }
  return null
}

function result(s: State): DuelResult {
  const w = winnerLine(s)
  if (w !== null) return { over: true, winner: w }
  if (s.drawn) return { over: true, winner: null }
  if (s.owners.every((o) => o !== null)) return { over: true, winner: null }
  if (s.quiet >= QUIET_LIMIT) {
    const n0 = s.owners.filter((o) => o === 0).length
    const n1 = s.owners.filter((o) => o === 1).length
    return { over: true, winner: n0 === n1 ? null : n0 > n1 ? 0 : 1 }
  }
  return { over: false }
}

function apply(state: State, seat: Seat, action: Action, _rng: () => number): { state: State } | { error: string } {
  if (result(state).over) return { error: 'game_over' }
  if (seat !== state.seat) return { error: 'not_your_turn' }
  if (typeof action !== 'object' || action === null) return { error: 'invalid_action' }
  const other = (1 - seat) as Seat

  if (action.type === 'acceptDraw') {
    if (state.drawOffer !== other) return { error: 'no_draw_offer' }
    return {
      state: {
        ...state,
        drawn: true,
        drawOffer: null,
        turnNo: state.turnNo + 1,
        last: { seat, type: 'acceptDraw' },
      },
    }
  }
  if (action.type !== 'guess' && action.type !== 'pass') return { error: 'invalid_action' }

  const offer = action.offerDraw === true
  if (offer && state.noOffer === seat) return { error: 'draw_offer_cooldown' }

  const next: State = {
    ...state,
    owners: [...state.owners],
    names: [...state.names],
    used: [...state.used],
    steals: [...state.steals] as [number, number],
    seat: other,
    turnNo: state.turnNo + 1,
    // 상대 제안을 무시하고 행동하면 거절: 제안자는 자기 다음 행동에 다시 제안할 수 없다
    drawOffer: offer ? seat : null,
    noOffer: state.drawOffer === other ? other : state.noOffer === seat ? null : state.noOffer,
  }
  if (offer && next.noOffer === seat) next.noOffer = null

  if (action.type === 'pass') {
    next.quiet = state.quiet + 1
    next.last = { seat, type: 'pass', offeredDraw: offer }
    return { state: next }
  }

  const { cell, playerId } = action
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { error: 'invalid_cell' }
  if (typeof playerId !== 'string' || playerId === '') return { error: 'invalid_player' }
  const owner = state.owners[cell]
  if (owner === seat) return { error: 'own_cell' }
  const steal = owner !== null
  if (steal && state.steals[seat] <= 0) return { error: 'no_steals_left' }
  if (state.used.includes(playerId)) return { error: 'player_used' }

  if (steal) next.steals[seat] -= 1
  const correct = state.answers[cell].includes(playerId)
  const name = typeof action.name === 'string' ? action.name.slice(0, 80) : ''
  if (correct) {
    next.owners[cell] = seat
    next.names[cell] = name
    next.used.push(playerId)
    next.quiet = 0
  } else {
    next.quiet = state.quiet + 1
  }
  next.last = { seat, type: 'guess', cell, name, correct, steal, offeredDraw: offer }
  return { state: next }
}

function view(s: State, _viewer: Seat | null): View {
  const over = result(s).over
  const canOff = (x: Seat) => !over && s.noOffer !== x
  return {
    rows: s.rows,
    cols: s.cols,
    cells: s.owners.map((owner, i) => ({ owner, name: s.names[i] })),
    steals: [s.steals[0], s.steals[1]],
    toMove: s.seat,
    drawOffer: s.drawOffer,
    canOffer: [canOff(0), canOff(1)],
    last: s.last,
    quiet: s.quiet,
    examples: over ? s.examples : null,
  }
}

export const logic: DuelLogic<State, Action, View> = {
  version: 1,
  init,
  toMove: (s) => s.seat,
  apply,
  timeoutAction: () => ({ type: 'pass' }),
  turnNo: (s) => s.turnNo,
  result,
  view,
}
