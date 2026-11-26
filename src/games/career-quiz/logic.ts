// 커리어 퀴즈 규칙 (설계 docs/superpowers/specs/2026-11-25-career-quiz-design.md). 순수 함수만, 외부 의존 없음 (Deno 호환).
// 정답과 경력은 Puzzle에 스냅샷으로 저장한다 — data.ts가 갱신돼도 이전 버전이 출제한 문제를 그대로 풀 수 있다.
import type { Ctx, GameLogic, PlatformAction } from '../types.ts'
import { QUIZ, type Line, type Tier } from './data.ts'

export type { Line, Tier }
export const MAX_TRIES = 8
/** 이니셜 힌트는 선수를 이만큼 답한 뒤부터 */
export const HINT_AFTER = 3
export const HINT_PENALTY = 3
const NAME_MAX = 80

export type Mode = 'normal' | 'challenge'

export type Puzzle = { id: string; nameKo: string; nameEn: string; tier: Tier; mode: Mode; lines: Line[] }
export type Guess = { id: string; name: string }
export type Action = { type: 'guess'; id: string; name: string } | { type: 'open' } | { type: 'hint' }
export type State = {
  mode: Mode
  lines: Line[]
  /** 열린 줄 수 (일반 모드는 처음부터 전부) */
  opened: number
  guesses: Guess[]
  /** "한 줄 열기"로 쓴 기회 */
  opens: number
  won: boolean
  gaveUp: boolean
  initials: string | null
}
/** 가린 줄은 클럽 대신 null. 연도는 보인다 */
export type PublicLine = [from: number, to: number | null, team: string | null, loan: 0 | 1 | null]
export type PublicState = Omit<State, 'lines'> & { lines: PublicLine[] }
export type Reveal = { id: string; nameKo: string; nameEn: string; lines: Line[] }

/** 이름 단어마다 첫 글자 + '.' (후알야와 같은 규칙) */
export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).map((w) => [...w][0] + '.').join(' ')
}

export function used(s: State): number {
  return s.guesses.length + s.opens
}

function finished(s: State): boolean {
  return s.won || s.gaveUp || used(s) >= MAX_TRIES
}

function asTier(v: string | undefined): Tier {
  return v === 'normal' || v === 'hard' ? v : 'easy'
}

function asMode(v: string | undefined): Mode {
  return v === 'challenge' ? 'challenge' : 'normal'
}

export const logic: GameLogic<Puzzle, Action, State, PublicState> = {
  version: 1,

  pickPuzzle(rng, options) {
    const tier = asTier(options.tier)
    const mode = asMode(options.mode)
    let pool = QUIZ.filter((q) => q[3] === tier)
    if (pool.length === 0) pool = QUIZ
    const [id, nameKo, nameEn, t, lines] = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
    return { id, nameKo, nameEn, tier: t, mode, lines: lines.map((l) => [...l] as Line) }
  },

  puzzleKey(p) {
    return p.id
  },

  initState(p) {
    return {
      mode: p.mode,
      lines: p.lines,
      opened: p.mode === 'challenge' ? Math.min(1, p.lines.length) : p.lines.length,
      guesses: [],
      opens: 0,
      won: false,
      gaveUp: false,
      initials: null,
    }
  },

  apply(puzzle, state, action: Action | PlatformAction, _ctx: Ctx) {
    if (finished(state)) return { error: '이미 끝난 게임이에요' }
    const more = state.opened < state.lines.length
    switch (action.type) {
      case 'give_up':
        return { state: { ...state, gaveUp: true } }
      case 'open':
        if (state.mode !== 'challenge') return { error: '챌린지 모드에서만 열 수 있어요' }
        if (!more) return { error: '이미 모든 줄이 열렸어요' }
        return { state: { ...state, opened: state.opened + 1, opens: state.opens + 1 } }
      case 'hint':
        if (state.initials !== null) return { error: '힌트는 한 번만 쓸 수 있어요' }
        if (state.guesses.length < HINT_AFTER) return { error: `힌트는 선수를 ${HINT_AFTER}번 답한 뒤에 쓸 수 있어요` }
        return { state: { ...state, initials: initialsOf(puzzle.nameEn) } }
      case 'guess': {
        const { id, name } = action
        if (typeof id !== 'string' || !/^Q\d{1,12}$/.test(id)) return { error: '선수를 목록에서 골라 주세요' }
        if (typeof name !== 'string' || name.trim() === '') return { error: '선수를 목록에서 골라 주세요' }
        if (state.guesses.some((g) => g.id === id)) return { error: '이미 고른 선수예요' }
        const won = id === puzzle.id
        // 정답 이름은 출제 스냅샷으로 남긴다. 화면이 보낸 이름은 표시용이고 판정에 쓰지 않는다.
        const guess = { id, name: won ? puzzle.nameEn : [...name.trim()].slice(0, NAME_MAX).join('') }
        const opened = !won && state.mode === 'challenge' && more ? state.opened + 1 : state.opened
        return { state: { ...state, guesses: [...state.guesses, guess], won, opened } }
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
    const base = state.mode === 'challenge' ? 11 - state.opened : 11 - used(state)
    return Math.max(1, base - (state.initials !== null ? HINT_PENALTY : 0))
  },

  actionCount(state) {
    return used(state)
  },

  publicState(state) {
    // 끝나면 화면이 reveal로 전부 그린다. 진행 중에는 가린 줄의 클럽·임대를 보내지 않는다.
    const lines: PublicLine[] = state.lines.map((l, i) => (i < state.opened ? [...l] : [l[0], l[1], null, null]))
    return { ...state, lines }
  },

  reveal(puzzle): Reveal {
    return { id: puzzle.id, nameKo: puzzle.nameKo, nameEn: puzzle.nameEn, lines: puzzle.lines }
  },
}
