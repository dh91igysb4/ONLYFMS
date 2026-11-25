// 내 섬(내 섬 설계 docs/superpowers/specs/2026-11-25-my-island-design.md §5). 순수 모듈.
// 섬 모양별 맵, 배에서 내리는 칸, 주인 있는 장소 키(접속 방·위치 표시용)와 그 이름.
import { AREAS, type AreaId, type IsleLayoutId } from './data.ts'
import type { MapDef, TileFacing } from './map.ts'
import { ISLE_CRESCENT } from './maps/isle-crescent.ts'
import { ISLE_TWIN } from './maps/isle-twin.ts'

const ISLE_MAPS: Readonly<Record<IsleLayoutId, MapDef>> = { crescent: ISLE_CRESCENT, twin: ISLE_TWIN }

/** 섬 모양의 맵 */
export function isleMap(layout: IsleLayoutId): MapDef {
  return ISLE_MAPS[layout]
}

/** 마을에서 배로 섬에 닿았을 때 서는 칸: 선착장 뿌리의 모래, 섬 쪽을 본다(두 모양 모두 같은 칸) */
export function isleArrival(_layout: IsleLayoutId): TileFacing {
  return { tx: 24, ty: 30, facing: 'up' }
}

const OWNER_RE = /^isle-([0-9a-f]{32})$/
const compactId = (id: string): string => id.toLowerCase().replace(/-/g, '')

/** 접속 방·위치의 장소 키: 주인 있는 섬은 `isle-<주인 id 32자>`, 그 외엔 지역 id */
export function placeKey(area: AreaId, owner: string | null): string {
  return owner ? `isle-${compactId(owner)}` : area
}

/** 장소 키의 섬 주인(하이픈 없는 32자). 섬 키가 아니면 null */
export function ownerOfPlaceKey(key: string): string | null {
  return OWNER_RE.exec(key)?.[1] ?? null
}

/** 장소 키의 화면 이름: 지역 이름, 내 섬, "{아이디}의 섬", 모르는 주인이면 "누군가의 섬". 모르는 키면 null */
export function placeName(key: string, opts: { selfId: string | null; players: readonly { id: string; handle: string }[] }): string | null {
  const owner = ownerOfPlaceKey(key)
  if (owner) {
    if (opts.selfId && compactId(opts.selfId) === owner) return '내 섬'
    const p = opts.players.find((x) => compactId(x.id) === owner)
    return p ? `${p.handle}의 섬` : '누군가의 섬'
  }
  return AREAS.find((a) => a.id === key)?.name ?? null
}
