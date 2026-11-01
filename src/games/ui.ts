// 브라우저 전용 게임 화면 등록부.
// games/index.ts는 Edge Function(Deno)도 가져오므로 React 컴포넌트를 거기에 넣지 않고 여기서 따로 잇는다 (§4.7).
import type { ComponentType, ReactNode } from 'react'
import { Game as WhoAreYaGame } from './who-are-ya/Game.tsx'
import { Game as YachtGame } from './yacht/Game.tsx'

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
}

export function getDuelComponent(id: string): ComponentType<DuelGameProps> | undefined {
  return duelComponents[id]
}
