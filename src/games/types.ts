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
  options: ManifestOption[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameModule = { manifest: Manifest; logic: GameLogic<any, any, any, any> }
