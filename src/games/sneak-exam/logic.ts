// 몰래 수능 게임 로직. 시뮬(sim.ts)을 플랫폼 GameLogic 약속으로 감싼다. 시간은 ctx가 아니라 틱으로 센다.
// 순수 함수만, 외부 의존 없음 (Deno 호환).
import type { Ctx, GameLogic, PlatformAction } from '../types.ts'
import { BONUS_MAX, MAX_ACTION_TICKS, PROG_MAX, SCORE_BASE, TOTAL_TICKS } from './constants.ts'
import { getExam } from './exam.ts'
import type { Exam } from './exam.ts'
import { applyCmd, canApply, initSim, parseCmd, step } from './sim.ts'
import type { Cmd, SimState } from './sim.ts'

export type Puzzle = { seed: string }
export type State = { seed: string; sim: SimState }
export type Action = { type: 's'; n: number; c?: Cmd }
/** known[i]는 문제 i를 다 풀었으면 정답, 아니면 −1 */
export type PublicState = { seed: string; sim: SimState; known: number[] }
export type Reveal = { answers: number[]; proctorType: 0 | 1 | 2 }

const ERR_INPUT = 'invalid_input'
const ERR_DONE = 'finished'

const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, '0')

export function correctCount(sim: SimState, exam: Exam): number {
  let n = 0
  for (let i = 0; i < exam.answers.length; i++) if (sim.marks[i] === exam.answers[i]) n++
  return n
}

export function scoreOf(sim: SimState, exam: Exam): number {
  if (sim.end === 'caught') return 0
  const bonus = sim.end === 'submit' ? Math.floor(((TOTAL_TICKS - sim.tick) * BONUS_MAX) / TOTAL_TICKS) : 0
  return correctCount(sim, exam) * (SCORE_BASE + bonus)
}

export const logic: GameLogic<Puzzle, Action, State, PublicState> = {
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
    return { seed: puzzle.seed, sim: initSim(getExam(puzzle.seed)) }
  },

  apply(_puzzle, state, action: Action | PlatformAction, _ctx: Ctx) {
    if (state.sim.end !== null) return { error: ERR_DONE }
    switch (action?.type) {
      case 'give_up':
        return { state: { seed: state.seed, sim: { ...state.sim, end: 'give_up' } } }
      case 's': {
        const { n, c } = action as Action
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_ACTION_TICKS) return { error: ERR_INPUT }
        const cmd = c === undefined ? null : parseCmd(c)
        if (c !== undefined && cmd === null) return { error: ERR_INPUT }
        const exam = getExam(state.seed)
        let sim = state.sim
        for (let k = 0; k < n && sim.end === null; k++) sim = step(sim, exam)
        if (cmd !== null && sim.end === null) {
          if (!canApply(sim, cmd)) return { error: ERR_INPUT }
          sim = applyCmd(sim, cmd)
        }
        return { state: { seed: state.seed, sim } }
      }
      default:
        return { error: ERR_INPUT }
    }
  },

  isFinished(state) {
    return state.sim.end !== null
  },

  score(state) {
    return scoreOf(state.sim, getExam(state.seed))
  },

  actionCount(state) {
    return state.sim.tick
  },

  publicState(state) {
    const exam = getExam(state.seed)
    const known = state.sim.prog.map((p, i) => (p === PROG_MAX ? exam.answers[i] : -1))
    return { seed: state.seed, sim: state.sim, known }
  },

  reveal(puzzle): Reveal {
    const exam = getExam(puzzle.seed)
    return { answers: exam.answers.slice(), proctorType: exam.proctorType }
  },
}
