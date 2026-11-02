// 게임 약속 타입 (설계 §4.1, §4.2). 외부 의존 없음 (Deno 호환).

/** 서버가 넘기는 시각 정보(밀리초). 자유 플레이에서는 브라우저 시각을 쓴다. */
export type Ctx = { now: number; startedAt: number; deadline: number | null }

/** 모든 게임이 반드시 처리해야 하는 플랫폼 행동 */
export type PlatformAction = { type: 'give_up' }

export interface GameLogic<Puzzle, Action, State, PublicState> {
  /** 판정 규칙을 바꿀 때마다 1씩 올린다 (4.5) */
  version: number
  /** 난수 함수와 설정으로 문제 하나를 고른다 */
  pickPuzzle(rng: () => number, options: Record<string, string>): Puzzle
  /** 문제의 고유 키. 같은 문제가 반복 출제되지 않게 하는 데 쓴다 */
  puzzleKey(puzzle: Puzzle): string
  initState(puzzle: Puzzle, ctx: Ctx): State
  /** 행동 하나를 적용한다. 잘못된 행동이면 error를 돌려주고 상태는 바뀌지 않는다 */
  apply(
    puzzle: Puzzle,
    state: State,
    action: Action | PlatformAction,
    ctx: Ctx,
  ): { state: State } | { error: string }
  isFinished(state: State, ctx: Ctx): boolean
  /** 0~10점, 소수 첫째 자리. 끝나지 않은 상태에서는 "지금 포기했다면 받을 점수"를 돌려준다 */
  score(state: State, ctx: Ctx): number
  /** 동점 처리용 행동 수 (보통 추측 횟수) */
  actionCount(state: State): number
  /** 정답을 빼고 브라우저에 보낼 수 있는 상태 */
  publicState(state: State): PublicState
  /** 끝났을 때 공개할 정답 정보 */
  reveal(puzzle: Puzzle): unknown
}

export type ManifestOption = {
  key: string
  label: string
  choices: { value: string; label: string }[]
  default: string
}

export type Manifest = {
  id: string
  name: string
  description: string
  hidden: boolean
  modes: { daily: boolean; contest: boolean; free: boolean }
  puzzleSource: 'generate' | 'bank'
  /**
   * 데일리 제한 시간(초). 처음 연 순간(attempts.started_at)부터 센다. null이면 그날 자정까지.
   * 끝나면 서버가 그 시점 점수("지금 포기했다면 받을 점수")로 확정한다. 대회에는 적용하지 않는다.
   */
  dailyTimeLimitSec: number | null
  options: ManifestOption[]
  /** 생략하면 'solo'. 대전 게임은 'duel' (대전 설계 §3) */
  category?: 'solo' | 'duel'
  /** 대전 게임 설정: 턴 시간 선택지(초)와 한 화면 대전 지원 여부 */
  duel?: { turnSeconds: { choices: number[]; default: number }; sameScreen: boolean }
  /**
   * 자유 플레이 기록을 보여 주는 방식. 생략하면 'solve'(정답·정답률·연속).
   * 'score'는 점수 게임: 리더보드는 플레이·평균·최고만, 최고 점수 순으로 고정한다.
   */
  freeStats?: 'solve' | 'score'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameModule = { manifest: Manifest; logic: GameLogic<any, any, any, any> }

// ---- 대전(1v1) 게임 계약 (대전 설계 §3) ----

export type Seat = 0 | 1

export type DuelResult = { over: false } | { over: true; winner: Seat | null; scores?: [number, number] }

export interface DuelLogic<State, Action, View> {
  /** 규칙을 바꿀 때마다 1씩 올린다 */
  version: number
  init(rng: () => number, options: Record<string, string>): State
  /** 지금 행동할 좌석 */
  toMove(state: State): Seat
  /** 행동 하나를 적용한다. 잘못된 행동이면 error를 돌려주고 상태는 바뀌지 않는다 */
  apply(state: State, seat: Seat, action: Action, rng: () => number): { state: State } | { error: string }
  /**
   * 시간 초과 시 서버가 대신 적용할 "다음 행동" 하나. 아직 보이지 않는 난수(주사위)에 의존하지 않는다.
   * 서버는 이를 apply하고 turnNo가 바뀌거나 게임이 끝날 때까지 다시 부른다(턴당 최대 8번).
   * 행동마다 새 rng를 쓴다.
   */
  timeoutAction(state: State): Action
  /** 진행도(채운 칸 수 등). 턴이 끝났는지와 연속 시간 초과를 판단하는 데 쓴다 (설계 §3.2) */
  turnNo(state: State): number
  result(state: State): DuelResult
  /** 브라우저에 보낼 상태. viewer가 null이면 관전자 */
  view(state: State, viewer: Seat | null): View
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DuelModule = { manifest: Manifest; logic: DuelLogic<any, any, any> }
