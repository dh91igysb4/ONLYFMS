// 볼 런 게임 로직. 시뮬(sim.ts)을 플랫폼 GameLogic 약속으로 감싼다. 시간은 ctx가 아니라 틱으로 센다.
// 순수 함수만, 외부 의존 없음 (Deno 호환).
import type { Ctx, GameLogic, PlatformAction } from '../types.ts'
import { SCORE_MAX, SCORE_TICKS } from './constants.ts'
import { getCourse } from './course.ts'
import { decodeInputs } from './input.ts'
import { initSim, step } from './sim.ts'
import type { SimState } from './sim.ts'

export type Puzzle = { seed: string }
export type State = { seed: string; sim: SimState }
export type Action = { type: 'i'; d: number[] }
export type PublicState = State

const ERR_INPUT = 'invalid_input'
const ERR_DONE = 'finished'

const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, '0')

export const logic: GameLogic<Puzzle, Action, State, PublicState> = {
  // v2: 코스(단계 주기)·물리(관성·기운 판·단차·터널 가속)·점수(시간) 규칙이 모두 바뀌었다.
  version: 2,

  pickPuzzle(rng, _options) {
    let seed = ''
    for (let k = 0; k < 4; k++) seed += hex8(Math.floor(rng() * 4294967296))
    return { seed }
  },

  puzzleKey(puzzle) {
    return puzzle.seed
  },

  initState(puzzle, _ctx: Ctx) {
    return { seed: puzzle.seed, sim: initSim() }
  },

  apply(_puzzle, state, action: Action | PlatformAction, _ctx: Ctx) {
    if (state.sim.dead !== null) return { error: ERR_DONE }
    switch (action?.type) {
      case 'give_up':
        return { state: { seed: state.seed, sim: { ...state.sim, dead: 'give_up' } } }
      case 'i': {
        const targets = decodeInputs((action as Action).d)
        if (targets === null) return { error: ERR_INPUT }
        const course = getCourse(state.seed)
        let sim = state.sim
        for (const t of targets) {
          sim = step(sim, t, course)
          if (sim.dead !== null) break
        }
        return { state: { seed: state.seed, sim } }
      }
      default:
        return { error: ERR_INPUT }
    }
  },

  isFinished(state) {
    return state.sim.dead !== null
  },

  // 살아 있던 시간으로 센다(0.5초에 1점). 거리는 속도 단계에 따라 달라 쓰지 않는다.
  score(state) {
    return Math.min(SCORE_MAX, Math.floor(state.sim.tick / SCORE_TICKS))
  },

  actionCount(state) {
    return state.sim.tick
  },

  publicState(state) {
    return state
  },

  reveal() {
    return null
  },
}
