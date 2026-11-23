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
  /** 0~scoreMax(기본 10)점. 끝나지 않은 상태에서는 "지금 포기했다면 받을 점수"를 돌려준다 */
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
  /** 생략하면 'solo'. 대전 게임은 'duel' (대전 설계 §3), 저장이 이어지는 지속형 게임은 'world' */
  category?: 'solo' | 'duel' | 'world'
  /** 지속형(world) 게임이 남기는 기록 종류. key는 `WorldRecord.key`와 맞고 게임 안에서 유일하다 */
  records?: { key: string; label: string; unit?: string }[]
  /** 대전 게임 설정: 턴 시간 선택지(초)와 한 화면 대전 지원 여부 */
  duel?: { turnSeconds: { choices: number[]; default: number }; sameScreen: boolean }
  /**
   * 자유 플레이 기록을 보여 주는 방식. 생략하면 'solve'(정답·정답률·연속).
   * 'score'는 점수 게임: 리더보드는 플레이·평균·최고만, 최고 점수 순으로 고정한다.
   */
  freeStats?: 'solve' | 'score'
  /** 점수 게임 리더보드에서 플레이·평균을 빼고 최고 점수만 보여 준다 (`freeStats: 'score'`일 때만 뜻이 있다) */
  freeBestOnly?: boolean
  /**
   * 자유 플레이 점수의 상한(기본 10). 10이 아니면 자유 플레이 전용 점수 게임(`freeStats: 'score'`,
   * 데일리·대회 끔)이어야 한다. DB `game_modes.score_max`와 같아야 하며 트리거가 상한을 지킨다.
   */
  scoreMax?: number
  /** 자유 플레이 점수를 화면에 보일 소수 자릿수(기본 2). 거리처럼 정수 점수면 0 */
  scoreDecimals?: 0 | 1 | 2
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

// ---- 지속형(world) 게임 계약: 저장이 이어지는 게임 ----
//
// 지속형 게임 공통 규칙(설계 docs/superpowers/specs/2026-11-23-wallet-design.md §6):
// 골드는 세이브에 두지 않는다. 플랫폼 지갑이 원본이고 게임은 ctx.gold를 읽고 증감만 돌려준다.
// 지갑을 쓰는 게임은 `wallet: true`를 둔다. 없으면 world 핸들러는 지갑을 잠그지도 읽지도 않고,
// ctx.gold는 0, 응답에 최상위 gold가 없다(지갑 이전 전의 게임이 그대로 동작하게).

/** 서버가 넘기는 시각(밀리초), 난수 함수, 지갑 잔액(잠근 뒤 읽은 값. `wallet`이 없는 게임은 0) */
// gold는 지갑 1단계 동안 선택값이다(낚시가 지갑으로 옮기기 전 테스트·호출이 그대로 컴파일되게).
// 핸들러는 언제나 채운다. 낚시 지갑 이전(계획 Task 4) 때 필수로 바꾼다.
export type WorldCtx = { now: number; rng: () => number; gold?: number }

/** 게임이 남기는 기록 하나. key는 manifest.records의 key와 맞는다 */
export type WorldRecord = { key: string; value: number; detail?: string }

export interface WorldLogic<State, Action, View> {
  /** 규칙·저장 형식을 바꿀 때마다 1씩 올린다 */
  version: number
  /** 플랫폼 지갑을 쓴다. true면 핸들러가 지갑을 잠그고 ctx.gold를 채우며 apply의 gold를 장부에 반영한다 */
  wallet?: boolean
  init(): State
  /** 옛 버전 state를 현재 형식으로. 모르는 값은 기본값으로 채우고 던지지 않는다 */
  migrate(state: unknown, fromVersion: number): State
  /**
   * 행동 하나를 적용한다. 잘못된 행동이면 error를 돌려주고 상태는 바뀌지 않는다.
   * gold: 이 행동의 골드 증감(정수). 생략하면 0. 지출은 ctx.gold로 먼저 검사해 not_enough_gold를 돌려준다.
   */
  apply(state: State, action: Action, ctx: WorldCtx): { state: State; result?: unknown; gold?: number } | { error: string }
  /** 브라우저에 보낼 상태. gold: 이 응답 시점의 지갑 잔액(`wallet`이 없는 게임은 0) */
  view(state: State, ctx: { now: number; gold?: number }): View
  records(state: State): WorldRecord[]
  /** 옛 세이브 안에 들어 있던 골드(0 이상 정수). 세이브 버전이 바뀔 때 핸들러가 한 번 지갑으로 옮긴다 */
  legacyGold?(raw: unknown, fromVersion: number): number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorldModule = { manifest: Manifest; logic: WorldLogic<any, any, any> }
