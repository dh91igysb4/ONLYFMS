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
}

export type YAction = { type: 'roll'; keep: number[] } | { type: 'score'; category: Category }

const filled = (s: Sheet) => CATEGORIES.filter((c) => s[c] !== undefined).length
const isOver = (s: YState) => filled(s.sheets[0]) === CATEGORIES.length && filled(s.sheets[1]) === CATEGORIES.length

function apply(state: YState, seat: Seat, action: YAction, rng: () => number): { state: YState } | { error: string } {
  if (isOver(state)) return { error: 'game_over' }
  if (seat !== state.seat) return { error: 'not_your_turn' }
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
    return { state: { ...state, dice, rolls: state.rolls + 1 } }
  }
  if (action.type === 'score') {
    if (state.rolls === 0) return { error: 'roll_first' }
    const sheet = state.sheets[seat]
    if (!CATEGORIES.includes(action.category)) return { error: 'invalid_category' }
    if (sheet[action.category] !== undefined) return { error: 'category_filled' }
    if (!allowed(state.dice, sheet).includes(action.category)) return { error: 'category_not_allowed' }
    const points = scoreFor(state.dice, action.category, sheet)
    const add = yachtBonus(state.dice, sheet)
    const sheets: [Sheet, Sheet] = [state.sheets[0], state.sheets[1]]
    sheets[seat] = { ...sheet, [action.category]: points }
    const bonus: [number, number] = [state.bonus[0], state.bonus[1]]
    bonus[seat] += add
    return { state: { sheets, bonus, seat: seat === 0 ? 1 : 0, dice: [], rolls: 0 } }
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
  init: () => ({ sheets: [{}, {}], bonus: [0, 0], seat: 0, dice: [], rolls: 0 }),
  toMove: (state) => state.seat,
  apply,
  /**
   * 굴리기 전이면 [굴리기, 최고점 칸]. 굴리기 전 주사위는 rng로 미리 굴려 보므로,
   * 서버는 이 행동열을 timeoutActions에 준 것과 같은 난수열로 apply해야 한다.
   */
  timeoutActions(state, rng) {
    if (isOver(state)) return []
    const acts: YAction[] = []
    let dice = state.dice
    if (state.rolls === 0) {
      const r = apply(state, state.seat, { type: 'roll', keep: [] }, rng)
      if ('error' in r) return []
      acts.push({ type: 'roll', keep: [] })
      dice = r.state.dice
    }
    acts.push({ type: 'score', category: bestCategory(dice, state.sheets[state.seat]) })
    return acts
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
