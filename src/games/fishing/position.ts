// 낚시터의 마지막 지역·위치를 브라우저(localStorage)에 사용자별로 저장·복원한다.
// 저장소가 막혀 있거나 값이 깨졌거나 지역·맵이 바뀌어 못 쓰는 자리면 null(마을 시작 위치에서 시작).
// 1단계 형식({pos, facing}, area 없음)은 마을로 읽는다.
import { AREAS, type AreaId } from './data.ts'
import type { Facing, MapDef, Vec } from './map.ts'
import { mapFor } from './maps/index.ts'
import { feetBlocked } from './walk.ts'

export type SavedPosition = { area: AreaId; pos: Vec; facing: Facing }

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right']

const keyFor = (userId: string) => `fishing-pos:${userId}`

function parse(raw: string | null): SavedPosition | null {
  if (raw === null) return null
  const v: unknown = JSON.parse(raw)
  if (typeof v !== 'object' || v === null) return null
  const { area = 'village', pos, facing } = v as { area?: unknown; pos?: unknown; facing?: unknown }
  const map: MapDef | null = AREAS.some((a) => a.id === area) ? mapFor(area as AreaId) : null
  if (map === null) return null
  if (typeof pos !== 'object' || pos === null) return null
  const { x, y } = pos as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  if (!FACINGS.includes(facing as Facing)) return null
  // 발이 걸을 수 없는 타일에 걸친 채로 시작하면 영영 움직일 수 없다
  return feetBlocked(map, x, y) ? null : { area: map.id, pos: { x, y }, facing: facing as Facing }
}

export function loadPosition(userId: string): SavedPosition | null {
  try {
    return parse(localStorage.getItem(keyFor(userId)))
  } catch {
    return null
  }
}

export function savePosition(userId: string, p: SavedPosition): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify({ area: p.area, pos: { x: p.pos.x, y: p.pos.y }, facing: p.facing }))
  } catch {
    /* 저장소가 막혀 있으면 다음에 시작 위치에서 시작한다 */
  }
}
