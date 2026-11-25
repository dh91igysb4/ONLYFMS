// 티키타카토 규칙 (설계 docs/superpowers/specs/2026-11-26-tiki-taka-toe-design.md §3, §6). 순수 함수, 외부 의존 없음.
import type { DuelLogic, DuelResult, Seat } from '../types.ts'

export type Header = { id: string; kind: string; label: string }
/** 칸 순서는 행 우선 0..8. theme은 판 고르기 RPC가 고른 문제의 테마(옛 RPC 결과에는 없을 수 있다) */
export type Prepared = {
  puzzle_id: string
  rows: Header[]
  cols: Header[]
  answers: string[][]
  examples: string[][]
  theme?: string | null
}

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
  /** 문제 테마(eng·esp·ita·ger·eur). 모르면 null */
  theme: string | null
}

export type State = {
  puzzleId: string
  theme: string | null
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

/** 거절 이유는 화면에 그대로 보이는 한국어 문장이다(플랫폼이 invalid_action의 message로 띄운다) */
export const ERR = {
  gameOver: '이미 끝난 대국이에요',
  notYourTurn: '상대 차례예요',
  invalid: '할 수 없는 행동이에요',
  noDrawOffer: '받을 무승부 제안이 없어요',
  offerCooldown: '이번 차례엔 무승부를 다시 제안할 수 없어요',
  badCell: '이 칸은 고를 수 없어요',
  badPlayer: '선수를 목록에서 골라 주세요',
  ownCell: '이미 내 칸이에요',
  noSteals: '스틸을 다 썼어요',
  used: '이미 쓴 선수예요',
} as const

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
    !isGrid(p.examples) ||
    (p.theme != null && typeof p.theme !== 'string')
  ) {
    throw new Error('invalid_prepared')
  }
  return {
    puzzleId: p.puzzle_id,
    theme: p.theme ?? null,
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
  if (result(state).over) return { error: ERR.gameOver }
  if (seat !== state.seat) return { error: ERR.notYourTurn }
  if (typeof action !== 'object' || action === null) return { error: ERR.invalid }
  const other = (1 - seat) as Seat

  if (action.type === 'acceptDraw') {
    if (state.drawOffer !== other) return { error: ERR.noDrawOffer }
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
  if (action.type !== 'guess' && action.type !== 'pass') return { error: ERR.invalid }

  const offer = action.offerDraw === true
  if (offer && state.noOffer === seat) return { error: ERR.offerCooldown }

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
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { error: ERR.badCell }
  if (typeof playerId !== 'string' || playerId === '') return { error: ERR.badPlayer }
  const owner = state.owners[cell]
  if (owner === seat) return { error: ERR.ownCell }
  const steal = owner !== null
  if (steal && state.steals[seat] <= 0) return { error: ERR.noSteals }
  if (state.used.includes(playerId)) return { error: ERR.used }

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

/** ended: 플랫폼이 대국을 끝냈다(기권·시간 초과 패·무효 포함). 그때도 예시 답을 보인다 */
function view(s: State, _viewer: Seat | null, ended?: boolean): View {
  const over = result(s).over || ended === true
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
    theme: s.theme ?? null,
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
