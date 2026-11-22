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
  // v3: 공 속도 ×1.7(DROP_TOL 함께), 길 폭 최대 3칸으로 모든 조각을 다시 짰다.
  // v4: 기믹 — 점프대('J')·좌우 왕복 블록('M')과 새 장애물 조각 7개(코스 추첨 결과가 달라진다).
  // v5: 기믹 등장 빈도 — tier 1 기믹 조각, 추첨 가중치(GIMMICK_WEIGHT), 첫 장애물은 늘 왕복 블록(코스 추첨 결과가 달라진다).
  // v6: 템포 — 조각마다 속도 묶음(단계 1~3·4~8·9~16)을 두고 묶음 최고 속도 기준 간격으로 모든 조각을 다시 짰다(코스가 달라진다).
  // v7: 템포를 v5와 v6의 가운데로(결정 사이 간격 +REST_TOP, 단계마다 장애물 1개, 묶음 a는 1칸 길 없음), 내리막 뒤 카메라.
  // v8: 기운 판 등가속(driftV, BANK_ACC 171), 기운 판 묶음을 묶음 최저 속도 50틱 길이로 늘리고 반대로 미는 판 사이에 평지 한 행.
  version: 8,

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
