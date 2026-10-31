// 테스트 전용 게임(운영 등록부에 없음). 플랫폼 테스트가 게임 하나를 끝까지 돌려 보는 데 쓴다.
import type { Ctx, GameLogic, PlatformAction } from '../../games/types.ts'

export type Puzzle = { range: 100 | 1000; answer: number }
export type Action = { type: 'guess'; value: number } | { type: 'hint' }
export type State = {
  guesses: number[]
  feedback: ('up' | 'down' | 'hit')[]
  hintUsed: boolean
  parity: 'even' | 'odd' | null
  gaveUp: boolean
}
export type PublicState = State

export const MAX_GUESSES = 8

function solved(s: State): boolean {
  return s.feedback.at(-1) === 'hit'
}

function finished(s: State): boolean {
  return s.gaveUp || solved(s) || s.guesses.length >= MAX_GUESSES
}

export const logic: GameLogic<Puzzle, Action, State, PublicState> = {
  version: 1,

  pickPuzzle(rng, options) {
    const range = options.range === '1000' ? 1000 : 100
    return { range, answer: 1 + Math.floor(rng() * range) }
  },

  puzzleKey(p) {
    return `${p.range}:${p.answer}`
  },

  initState() {
    return { guesses: [], feedback: [], hintUsed: false, parity: null, gaveUp: false }
  },

  apply(puzzle, state, action: Action | PlatformAction, _ctx: Ctx) {
    if (finished(state)) return { error: '이미 끝난 게임이에요' }
    switch (action.type) {
      case 'give_up':
        return { state: { ...state, gaveUp: true } }
      case 'hint':
        if (state.hintUsed) return { error: '힌트는 한 번만 쓸 수 있어요' }
        return {
          state: { ...state, hintUsed: true, parity: puzzle.answer % 2 === 0 ? 'even' : 'odd' },
        }
      case 'guess': {
        const v = action.value
        if (typeof v !== 'number' || !Number.isInteger(v)) return { error: '정수를 입력해 주세요' }
        if (v < 1 || v > puzzle.range) return { error: `1~${puzzle.range} 사이로 입력해 주세요` }
        if (state.guesses.includes(v)) return { error: '이미 낸 숫자예요' }
        const fb = v === puzzle.answer ? 'hit' : v < puzzle.answer ? 'up' : 'down'
        return {
          state: { ...state, guesses: [...state.guesses, v], feedback: [...state.feedback, fb] },
        }
      }
      default:
        return { error: '알 수 없는 행동이에요' }
    }
  },

  isFinished(state) {
    return finished(state)
  },

  score(state) {
    if (!solved(state)) return 0
    const base = Math.max(0, 11 - state.guesses.length)
    return Math.max(0, base - (state.hintUsed ? 1 : 0))
  },

  actionCount(state) {
    return state.guesses.length
  },

  publicState(state) {
    return state
  },

  reveal(puzzle) {
    return { answer: puzzle.answer }
  },
}
