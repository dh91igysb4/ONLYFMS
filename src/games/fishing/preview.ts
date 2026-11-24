// 메인 화면 밸리 미리보기의 상태 계산(메인 미리보기 설계 §5.2, §5.3). 순수 모듈: React·DOM 없음.
// 위치는 브라우저 저장값, 옷차림·열린 지역은 user_records의 기록 행(avatar, areas)에서 읽는다. 서버 world 함수는 부르지 않는다.
import { AVATAR_RECORD_KEY } from '../types.ts'
import type { Conditions } from './clock.ts'
import { AREAS, DEFAULT_AREAS, type AreaId } from './data.ts'
import { PREVIEW_AREAS_KEY } from './logic.ts'
import type { Opened } from './map.ts'
import { decodeOutfit } from './outfit.ts'
import { startPosition, type SavedPosition } from './position.ts'
import { SCENE_W } from './scene.ts'
import type { Player } from './walk.ts'
import type { Outfit } from './wardrobe.ts'
import type { OnlinePeer } from '../../platform/world/presence.ts'

export type PreviewRecord = { key: string; detail: string | null }
export type PreviewState = { area: AreaId; player: Player; opened: Opened; outfit: Outfit }

/** 비·눈이 오는 동안 다시 그리는 간격(ms) */
export const PREVIEW_RAIN_FRAME_MS = 100
/** 맑은 날 다시 그리는 간격: 게임 10분 = 실제 10초 */
const CLOCK_STEP_MS = 10_000
const MAX_SCALE = 4

const KNOWN_AREAS = new Set<string>(AREAS.map((a) => a.id))

function openedFrom(detail: string | null | undefined): Opened {
  const extra = (detail ?? '').split(',').filter((id): id is AreaId => KNOWN_AREAS.has(id))
  return new Set<AreaId>([...DEFAULT_AREAS, ...extra])
}

export function previewState(saved: SavedPosition | null, records: PreviewRecord[]): PreviewState {
  const detailOf = (key: string) => records.find((r) => r.key === key)?.detail
  const opened = openedFrom(detailOf(PREVIEW_AREAS_KEY))
  const outfit = decodeOutfit(detailOf(AVATAR_RECORD_KEY) ?? '')
  const start = startPosition(saved, opened)
  return { area: start.area, player: { pos: start.pos, facing: start.facing, moving: false, walkMs: 0 }, opened, outfit }
}

/** 정사각형 한 변(CSS px)에 맞는 정수 배율 1~4. 논리 장면 한 변은 floor(size / scale) */
export function previewScale(size: number): number {
  const fit = Math.floor((Number.isFinite(size) ? size : 0) / SCENE_W)
  return Math.max(1, Math.min(MAX_SCALE, fit))
}

/** 다음 그리기까지(ms). 비·눈이면 효과용 짧은 간격, 아니면 다음 게임 10분 경계까지 */
export function redrawDelayMs(cond: Conditions, nowMs: number): number {
  if (cond.weather === 'rain') return PREVIEW_RAIN_FRAME_MS
  return CLOCK_STEP_MS - (((nowMs % CLOCK_STEP_MS) + CLOCK_STEP_MS) % CLOCK_STEP_MS)
}

/** 메인 미리보기 모서리 요약(온라인 2단계-1). 최대 2명, 넘으면 '외 n명'. 0명이면 null */
export function onlineSummary(peers: readonly OnlinePeer[]): string | null {
  if (peers.length === 0) return null
  const one = (p: OnlinePeer) => {
    const area = AREAS.find((a) => a.id === p.area)?.name
    if (!area) return p.handle
    return p.act === 'fish' ? `${p.handle} ${area}에서 낚시 중` : `${p.handle} ${area}`
  }
  const shown = peers.slice(0, 2).map(one).join(', ')
  const more = peers.length > 2 ? ` 외 ${peers.length - 2}명` : ''
  return `접속 중 ${peers.length}명 · ${shown}${more}`
}
