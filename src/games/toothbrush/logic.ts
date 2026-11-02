// 양치 시뮬레이터 규칙 (설계 §3). 순수 함수만, 외부 의존 없음 (Deno 호환).
// 판정·채점은 정수 연산만 쓴다 — 시드와 행동 열이 같으면 어느 엔진에서든 결과가 같다.
import type { Ctx, GameLogic, PlatformAction } from '../types.ts'
import {
  CELL, DEC_FAST, DEC_OPT, DEC_SLOW, FAST_D2, H, LH, LW, R, SLOW_D2, SWITCH_TICKS, TOTAL_TICKS, W, ZONE_COUNT,
  ZONE_TOTAL,
} from './constants.ts'
import { generatePuzzle, puzzleKey, type Puzzle } from './generate.ts'

export type BrushAction = { type: 'b'; s: number[] }
export type ZoneAction = { type: 'z'; zone: number }
export type Action = BrushAction | ZoneAction
export type State = {
  zones: number[][]
  zone: number
  ticks: number
  cooldown: number
  prev: [number, number] | null
  gumTicks: number
  switches: number
  removed: number
}
export type PublicState = {
  zones: number[][]
  zone: number
  ticksLeft: number
  cooldown: number
  gumTicks: number
  started: boolean
  cleanByZone: number[]
}

/** 문지르기 행동 하나에 담을 수 있는 최대 샘플 수 */
export const MAX_SAMPLES = 30

const TOTAL = ZONE_TOTAL.reduce((a, b) => a + b, 0)

const ERR_INPUT = '잘못된 입력이에요'
const ERR_ZONE = '옮길 수 없는 구역이에요'
const ERR_DONE = '이미 끝났어요'
const ERR_NOT_STARTED = '먼저 닦기 시작하세요'

/** 칫솔 범위: dx² + dy² ≤ R²인 칸 오프셋 (R = 3이면 29개) */
const BRUSH: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = []
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) out.push([dx, dy])
  return out
})()

function validSamples(s: unknown): s is number[] {
  if (!Array.isArray(s) || s.length === 0 || s.length % 2 !== 0 || s.length > 2 * MAX_SAMPLES) return false
  for (let k = 0; k < s.length; k += 2) {
    const x = s[k], y = s[k + 1]
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false
    if (x === -1 && y === -1) continue
    if (x < 0 || x >= LW || y < 0 || y >= LH) return false
  }
  return true
}

function brush(state: State, s: number[]): State {
  const zones = state.zones.slice()
  const a = zones[state.zone].slice()
  zones[state.zone] = a
  let { ticks, cooldown, prev, gumTicks, removed } = state
  const n = Math.min(s.length / 2, TOTAL_TICKS - ticks)
  for (let k = 0; k < n; k++) {
    const x = s[2 * k], y = s[2 * k + 1]
    ticks += 1
    // 1. 접촉 없음
    if (x === -1 && y === -1) { prev = null; continue }
    // 2. 이동량
    const d2 = prev === null ? 0 : (x - prev[0]) * (x - prev[0]) + (y - prev[1]) * (y - prev[1])
    prev = [x, y]
    // 3. 전환 대기
    if (cooldown > 0) { cooldown -= 1; continue }
    // 4. 속도 구간
    let dec: number
    if (d2 < SLOW_D2) dec = DEC_SLOW
    else if (d2 < FAST_D2) dec = DEC_OPT
    else { dec = DEC_FAST; gumTicks += 1 }
    // 5. 칫솔 범위 닦기
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL)
    for (const [dx, dy] of BRUSH) {
      const c = cx + dx, r = cy + dy
      if (c < 0 || c >= W || r < 0 || r >= H) continue
      const i = r * W + c
      const t = Math.min(dec, a[i])
      if (t > 0) { a[i] -= t; removed += t }
    }
  }
  return { ...state, zones, ticks, cooldown, prev, gumTicks, removed }
}

export const logic: GameLogic<Puzzle, Action, State, PublicState> = {
  version: 2,

  pickPuzzle(rng, _options) {
    return generatePuzzle(rng)
  },

  puzzleKey,

  initState(puzzle) {
    return {
      zones: puzzle.zones.map((z) => z.slice()),
      zone: 0, ticks: 0, cooldown: 0, prev: null, gumTicks: 0, switches: 0, removed: 0,
    }
  },

  apply(_puzzle, state, action: Action | PlatformAction, _ctx: Ctx) {
    if (state.ticks >= TOTAL_TICKS) return { error: ERR_DONE }
    switch (action?.type) {
      case 'give_up':
        return { state: { ...state, ticks: TOTAL_TICKS } }
      case 'z': {
        if (state.ticks === 0) return { error: ERR_NOT_STARTED }
        const k = (action as ZoneAction).zone
        if (!Number.isInteger(k) || k < 0 || k >= ZONE_COUNT || k === state.zone) return { error: ERR_ZONE }
        return { state: { ...state, zone: k, switches: state.switches + 1, cooldown: SWITCH_TICKS, prev: null } }
      }
      case 'b': {
        const s = (action as BrushAction).s
        if (!validSamples(s)) return { error: ERR_INPUT }
        return { state: brush(state, s) }
      }
      default:
        return { error: ERR_INPUT }
    }
  },

  isFinished(state) {
    return state.ticks >= TOTAL_TICKS
  },

  score(state) {
    const tenths = Math.floor((100 * state.removed + Math.floor(TOTAL / 2)) / TOTAL) - Math.floor(state.gumTicks / 60)
    return Math.min(100, Math.max(0, tenths)) / 10
  },

  actionCount(state) {
    return state.switches
  },

  publicState(state) {
    const cleanByZone = state.zones.map((z, k) => {
      let left = 0
      for (const v of z) left += v
      return Math.floor((100 * (ZONE_TOTAL[k] - left)) / ZONE_TOTAL[k])
    })
    return {
      zones: state.zones,
      zone: state.zone,
      ticksLeft: TOTAL_TICKS - state.ticks,
      cooldown: state.cooldown,
      gumTicks: state.gumTicks,
      started: state.ticks > 0,
      cleanByZone,
    }
  },

  reveal() {
    return null
  },
}
