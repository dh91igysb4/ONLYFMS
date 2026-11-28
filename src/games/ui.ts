// 브라우저 전용 게임 화면 등록부.
// games/index.ts는 Edge Function(Deno)도 가져오므로 React 컴포넌트를 거기에 넣지 않고 여기서 따로 잇는다 (§4.7).
import type { ComponentType, ReactNode } from 'react'
import { Game as WhoAreYaGame } from './who-are-ya/Game.tsx'
import { Game as ToothbrushGame } from './toothbrush/Game.tsx'
import { Game as YachtGame } from './yacht/Game.tsx'
import { Game as TikiTakaToeGame } from './tiki-taka-toe/Game.tsx'
import { Game as BallRunGame } from './ball-run/Game.tsx'
import { Game as SneakExamGame } from './sneak-exam/Game.tsx'
import { Game as FishingGame } from './fishing/Game.tsx'
import { Avatar as FishingAvatar } from './fishing/Avatar.tsx'
import { Preview as FishingPreview } from './fishing/Preview.tsx'
import type { OnlinePeer } from '../platform/world/presence.ts'
import { Game as NeonRiderGame } from './neon-rider/Game.tsx'
import { CarPreview } from './neon-rider/CarPreview.tsx'
import { Game as CareerQuizGame } from './career-quiz/Game.tsx'

/** 게임 화면이 받는 props. 플랫폼(PlayRunner)이 상태를 쥐고, 화면은 그리기와 입력만 맡는다 (§4.2). */
export type GameProps = {
  publicState: unknown
  finished: boolean
  score: number | null
  reveal?: unknown
  busy: boolean
  error: string | null
  onAction(action: unknown): void
  remainingMs: number | null
}

/** 새 게임은 manifest·logic을 index.ts에, 화면을 여기에 한 줄씩 등록한다. */
const components: Record<string, ComponentType<GameProps>> = {
  'who-are-ya': WhoAreYaGame,
  toothbrush: ToothbrushGame,
  'ball-run': BallRunGame,
  'sneak-exam': SneakExamGame,
  'neon-rider': NeonRiderGame,
  'career-quiz': CareerQuizGame,
}

export function getGameComponent(id: string): ComponentType<GameProps> | undefined {
  return components[id]
}

/** 대전 게임 화면이 받는 props (대전 설계 §9). 플랫폼(DuelMatchPage)이 서버 상태·차례·요청을 쥔다. */
export type DuelGameProps = {
  /** 서버 logic.view 결과 */
  view: unknown
  mySeat: 0 | 1 | null
  toMove: 0 | 1 | null
  finished: boolean
  busy: boolean
  error: string | null
  /** 내 차례가 아니면 플랫폼이 요청을 보내지 않는다 */
  onAction(action: unknown): void
  /** 좌석 순서의 아이디 */
  names: [string, string]
  /** 플랫폼 내용(선수·시간·결과). 화면은 맨 앞(넓은 화면에서는 조작 열 맨 위)에 그대로 그린다 */
  header?: ReactNode
  /** 플랫폼 내용(차례 안내·기권). 화면은 맨 뒤(넓은 화면에서는 조작 열 맨 아래)에 그대로 그린다 */
  footer?: ReactNode
}

/** 대전 게임 화면 등록부. 새 대전 게임 화면을 여기에 한 줄씩 등록한다. */
const duelComponents: Record<string, ComponentType<DuelGameProps>> = {
  yacht: YachtGame,
  'tiki-taka-toe': TikiTakaToeGame,
}

export function getDuelComponent(id: string): ComponentType<DuelGameProps> | undefined {
  return duelComponents[id]
}

/**
 * 지속형(world) 게임 화면이 받는 props. 저장·행동 요청은 화면이 플랫폼 데이터 계층으로 직접 한다.
 * onOpenGames: 플랫폼의 게임 목록 화면으로 간다(게임 안의 출구, 예: 낚시 마을회관 노트북).
 */
export type WorldGameProps = { gameId: string; onOpenGames?: () => void }

/** 지속형 게임 화면 등록부. 새 지속형 게임 화면을 여기에 한 줄씩 등록한다. */
const worldComponents: Record<string, ComponentType<WorldGameProps>> = {
  fishing: FishingGame,
}

export function getWorldComponent(id: string): ComponentType<WorldGameProps> | undefined {
  return worldComponents[id]
}

/** 프로필 캐릭터 화면이 받는 props. data는 서버 `WorldLogic.avatar` 문자열(game_records 키 avatar의 detail) */
export type AvatarProps = { data: string; scale: number; /** 'head'면 얼굴 부분만(머리글 동그라미용) */ crop?: 'head' }

/** 프로필 캐릭터 등록부(manifest `avatar`가 있는 지속형 게임). 새 게임은 여기에 한 줄씩 등록한다. */
const avatarComponents: Record<string, ComponentType<AvatarProps>> = {
  fishing: FishingAvatar,
}

export function getAvatarComponent(id: string): ComponentType<AvatarProps> | undefined {
  return avatarComponents[id]
}

/** 메인 화면 밸리 미리보기가 받는 props(메인 미리보기 설계 §5.1). records는 user_records 중 이 게임의 행 */
export type WorldPreviewProps = {
  userId: string
  records: { key: string; detail: string | null }[]
  /** 정사각형 한 변(CSS px) */
  size: number
  /** 그리기를 못 하면 한 번 부른다(부모가 대체 버튼을 그린다) */
  onFail: () => void
  /** 접속 중 친구(나 제외, 온라인 2단계-1). 요약 문구는 게임이 만든다 */
  online: OnlinePeer[]
}

/** 메인 미리보기 등록부(manifest `preview`가 있는 지속형 게임). 새 게임은 여기에 한 줄씩 등록한다. */
const previewComponents: Record<string, ComponentType<WorldPreviewProps>> = {
  fishing: FishingPreview,
}

export function getWorldPreview(id: string): ComponentType<WorldPreviewProps> | undefined {
  return previewComponents[id]
}

/** 상점 품목 미리보기가 받는 props. itemId는 그 게임 상점의 품목 id, size는 가로 px. */
export type ShopPreviewProps = { itemId: string; size: number }

/** 상점 미리보기 등록부. 상점에 그림이 필요한 게임을 여기에 한 줄씩 등록한다. */
const shopPreviews: Record<string, ComponentType<ShopPreviewProps>> = {
  'neon-rider': CarPreview,
}

export function getShopPreview(gameId: string): ComponentType<ShopPreviewProps> | undefined {
  return shopPreviews[gameId]
}
