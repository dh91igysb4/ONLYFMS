// 게임 약속 타입 (설계 §4.1, §4.2). 외부 의존 없음 (Deno 호환).
import type { FreeGold } from './economy.ts'

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
  /**
   * 행동 하나를 적용한다. 잘못된 행동이면 error를 돌려주고 상태는 바뀌지 않는다.
   * error가 영문 소문자 코드(`^[a-z0-9_]+$`)가 아니면 화면에 그대로 보인다(한국어 문장으로 쓴다). 코드면 일반 문구가 뜬다.
   */
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
  /** 상점 품목을 고르는 옵션. 경쟁 모드(데일리·대회·대전)는 값을 default로 고정한다(`pinShopOptions`) */
  shop?: true
}

/** 게임 목록 구역 주제. 새 주제는 여기와 `src/platform/games/sections.ts`의 TOPIC_TITLES에 함께 더한다 */
export type GameTopic = 'football'

export type Manifest = {
  id: string
  name: string
  /** 좁은 자리(머리글 밸리 버튼 등)에 쓰는 짧은 이름. 없으면 name */
  shortName?: string
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
  /** 상점에서 파는 품목. option은 `shop: true` 옵션의 key, items는 그 choices와 같은 id 집합 */
  shop?: { option: string; items: { id: string; price: number }[] }
  /** 생략하면 'solo'. 대전 게임은 'duel' (대전 설계 §3), 저장이 이어지는 지속형 게임은 'world' */
  category?: 'solo' | 'duel' | 'world'
  /** 게임 목록에서 묶는 주제(`src/platform/games/sections.ts`). 생략하면 "다른 게임" */
  topic?: GameTopic
  /** 지속형(world) 게임이 남기는 기록 종류. key는 `WorldRecord.key`와 맞고 게임 안에서 유일하다 */
  records?: { key: string; label: string; unit?: string }[]
  /** 지속형 게임이 프로필 요약 탭에 캐릭터를 보여 준다(`WorldLogic.avatar`·`getAvatarComponent`와 함께). label은 제목 */
  avatar?: { label: string }
  /** 지속형 게임이 메인 화면 미리보기를 그린다(`getWorldPreview`와 함께). 메인 미리보기 설계 §5.1 */
  preview?: true
  /**
   * 대전 게임 설정: 턴 시간 선택지(초)와 한 화면 대전 지원 여부.
   * prepare: 판 준비 RPC 이름(`^[a-z_]+$`). 있으면 대국을 시작할 때 `public.<prepare>(options jsonb)`를 불러
   * 결과를 `DuelLogic.init`의 세 번째 인자로 넘긴다(서버는 join 트랜잭션 안에서, 한 화면 대전은 브라우저에서 `p_options`로).
   * realtime: 있으면 실시간 대전(레이싱 설계 §7). 턴 흐름 대신 브라우저가 실시간으로 진행하고 `turnSeconds`는 쓰지 않는다.
   * 화면은 `getRealtimeComponent`, 연습은 `/duel/practice/:game`. 2단계 전까지 duel 함수가 대국 만들기를 막는다.
   */
  duel?: {
    turnSeconds: { choices: number[]; default: number }
    sameScreen: boolean
    prepare?: string
    realtime?: { raceSeconds: number }
  }
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
  /**
   * 자유 플레이 골드(지갑 설계 §7). 판당 floor(점수 × perPoint)를 playCap까지, 하루 dailyCap(= FREE_DAILY_CAP)까지.
   * DB game_modes.gold_*와 같아야 한다(registry.test.ts). 없으면 지급 없음. 수치는 게임별 gold.test.ts가 REF ±20%로 지킨다
   */
  gold?: FreeGold
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameModule = { manifest: Manifest; logic: GameLogic<any, any, any, any> }

// ---- 대전(1v1) 게임 계약 (대전 설계 §3) ----

export type Seat = 0 | 1

export type DuelResult = { over: false } | { over: true; winner: Seat | null; scores?: [number, number] }

export interface DuelLogic<State, Action, View> {
  /** 규칙을 바꿀 때마다 1씩 올린다 */
  version: number
  /** prepared: manifest `duel.prepare` RPC의 결과(없으면 undefined). 쓰지 않는 게임은 무시한다 */
  init(rng: () => number, options: Record<string, string>, prepared?: unknown): State
  /** 지금 행동할 좌석 */
  toMove(state: State): Seat
  /**
   * 행동 하나를 적용한다. 잘못된 행동이면 error를 돌려주고 상태는 바뀌지 않는다.
   * error가 영문 소문자 코드(`^[a-z0-9_]+$`)가 아니면 화면에 그대로 보인다(한국어 문장으로 쓴다). 코드면 일반 문구가 뜬다.
   */
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
  /**
   * 브라우저에 보낼 상태. viewer가 null이면 관전자(또는 끝난 대국).
   * ended: 플랫폼이 대국을 끝냈다(대국 status가 active가 아님 — 기권·시간 초과 패·무효 포함, 같은 화면은 result.over).
   * result가 아직 진행 중이어도 끝난 화면을 보여 줄 수 있다. 쓰지 않는 게임은 무시한다.
   */
  view(state: State, viewer: Seat | null, ended?: boolean): View
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
export type WorldCtx = { now: number; rng: () => number; gold: number }

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
  view(state: State, ctx: { now: number; gold: number }): View
  records(state: State): WorldRecord[]
  /**
   * 프로필에 그릴 캐릭터 문자열(manifest `avatar`가 있는 게임만). world 함수가 행동 뒤
   * `game_records`의 키 `AVATAR_RECORD_KEY`(값 0, detail = 이 문자열)에 쓰고, 화면 `getAvatarComponent`가 읽는다.
   */
  avatar?(state: State): string
  /**
   * 메인 미리보기에 쓸 짧은 값들(메인 미리보기 설계 §6). world 함수가 요청마다 계산해 키마다 `game_records` 한 행
   * (값 0, detail = 문자열)으로, 저장된 값과 다를 때만 쓴다. 키는 manifest records·`AVATAR_RECORD_KEY`·`FREE_BONUS_RECORD_KEY`와 겹치면 안 된다.
   */
  previewData?(state: State): Record<string, string>
  /** 옛 세이브 안에 들어 있던 골드(0 이상 정수). 세이브 버전이 바뀔 때 핸들러가 한 번 지갑으로 옮긴다 */
  legacyGold?(raw: unknown, fromVersion: number): number
  /**
   * 이 세이브가 사이트 자유 플레이 골드에 주는 영구 보너스(%, 0 이상 정수. 지갑 설계 §7.5).
   * world 함수가 요청마다 계산해 바뀌었으면 `game_records`의 키 `FREE_BONUS_RECORD_KEY`(값 = %)에 쓰고,
   * DB `_free_bonus_pct`가 그 행들을 합쳐(상한 `FREE_BONUS_MAX_PCT`) 자유 플레이 지급 트리거가 판당 골드와 게임별 하루 상한에 곱한다.
   */
  freeBonus?(state: State): number
  /**
   * 남에게 보여도 되는 값만(내 섬 설계 §5.4). 있으면 world 함수의 `visit` 요청이 다른 사용자의 세이브를 읽어
   * migrate만 하고(쓰지 않는다) 이 값을 돌려준다. 가방·지갑 같은 개인 값은 넣지 않는다.
   */
  publicView?(state: State): unknown
}

/** 자유 플레이 골드 보너스가 저장되는 game_records 키. manifest `records`의 key로 쓰지 않는다 */
export const FREE_BONUS_RECORD_KEY = 'free_bonus'

/** 프로필 캐릭터가 저장되는 game_records 키. manifest `records`의 key로 쓰지 않는다 */
export const AVATAR_RECORD_KEY = 'avatar'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorldModule = { manifest: Manifest; logic: WorldLogic<any, any, any> }
