// 요트 다이스 규칙 (대전 설계 §8). 순수 함수, 외부 의존 없음.
import type { DuelLogic, DuelResult, Seat } from '../types.ts'
import { allowed, CATEGORIES, scoreFor, total, yachtBonus } from './scoring.ts'
import type { Category, Sheet } from './scoring.ts'

export type YState = {
  sheets: [Sheet, Sheet]
  bonus: [number, number]
  seat: Seat
  /** 길이 5, 굴리기 전에는 빈 배열 */
  dice: number[]
  /** 이번 턴에 굴린 횟수 0~3 */
  rolls: number
  /** 이번 턴 가장 최근 굴리기에서 고정(다시 굴리지 않은) 주사위 자리. 첫 굴리기·턴 넘김 후 []. 옛 상태에는 없을 수 있다(없으면 []). */
  kept?: number[]
  /** 가장 최근에 기록된 칸(어느 쪽이든). 다음 기록 때까지 유지. 옛 상태에는 없을 수 있다(없으면 null). */
  last?: { seat: Seat; category: Category } | null
}

export type YAction = { type: 'roll'; keep: number[] } | { type: 'score'; category: Category }

const filled = (s: Sheet) => CATEGORIES.filter((c) => s[c] !== undefined).length
const isOver = (s: YState) => filled(s.sheets[0]) === CATEGORIES.length && filled(s.sheets[1]) === CATEGORIES.length

function apply(state: YState, seat: Seat, action: YAction, rng: () => number): { state: YState } | { error: string } {
  if (isOver(state)) return { error: 'game_over' }
  if (seat !== state.seat) return { error: 'not_your_turn' }
  if (typeof action !== 'object' || action === null) return { error: 'invalid_action' }
  if (action.type === 'roll') {
    if (state.rolls >= 3) return { error: 'no_rolls_left' }
    const keep = action.keep
    if (!Array.isArray(keep)) return { error: 'invalid_keep' }
    if (state.rolls === 0 && keep.length > 0) return { error: 'invalid_keep' }
    const seen = new Set<number>()
    for (const i of keep) {
      if (!Number.isInteger(i) || i < 0 || i > 4 || seen.has(i)) return { error: 'invalid_keep' }
      seen.add(i)
    }
    const dice: number[] = []
    for (let i = 0; i < 5; i++) dice.push(seen.has(i) ? state.dice[i] : Math.floor(rng() * 6) + 1)
    return { state: { ...state, dice, rolls: state.rolls + 1, kept: [...keep].sort((a, b) => a - b) } }
  }
  if (action.type === 'score') {
    if (state.rolls === 0) return { error: 'roll_first' }
    const sheet = state.sheets[seat]
    if (typeof action.category !== 'string' || !CATEGORIES.includes(action.category)) return { error: 'invalid_category' }
    if (sheet[action.category] !== undefined) return { error: 'category_filled' }
    if (!allowed(state.dice, sheet).includes(action.category)) return { error: 'category_not_allowed' }
    const points = scoreFor(state.dice, action.category, sheet)
    const add = yachtBonus(state.dice, sheet)
    const sheets: [Sheet, Sheet] = [state.sheets[0], state.sheets[1]]
    sheets[seat] = { ...sheet, [action.category]: points }
    const bonus: [number, number] = [state.bonus[0], state.bonus[1]]
    bonus[seat] += add
    return { state: { sheets, bonus, seat: seat === 0 ? 1 : 0, dice: [], rolls: 0, kept: [], last: { seat, category: action.category } } }
  }
  return { error: 'invalid_action' }
}

function bestCategory(dice: number[], sheet: Sheet): Category {
  let top: Category | null = null
  let topScore = -1
  for (const c of allowed(dice, sheet)) {
    const v = scoreFor(dice, c, sheet)
    if (v > topScore) {
      top = c
      topScore = v
    }
  }
  return top as Category
}

export const logic: DuelLogic<YState, YAction, YState> = {
  version: 1,
  init: () => ({ sheets: [{}, {}], bonus: [0, 0], seat: 0, dice: [], rolls: 0, kept: [], last: null }),
  toMove: (state) => state.seat,
  apply,
  /** 굴리기 전이면 굴리기, 굴렸으면 허용 칸 중 최고점 칸(동점이면 CATEGORIES 순서상 앞). 주사위를 미리 보지 않는다. */
  timeoutAction(state) {
    if (state.rolls === 0) return { type: 'roll', keep: [] }
    return { type: 'score', category: bestCategory(state.dice, state.sheets[state.seat]) }
  },
  turnNo: (state) => filled(state.sheets[0]) + filled(state.sheets[1]),
  result(state): DuelResult {
    if (!isOver(state)) return { over: false }
    const a = total(state.sheets[0], state.bonus[0])
    const b = total(state.sheets[1], state.bonus[1])
    return { over: true, winner: a > b ? 0 : b > a ? 1 : null, scores: [a, b] }
  },
  view: (state) => state,
}
