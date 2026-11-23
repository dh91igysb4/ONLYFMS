// 낚시 마을의 마지막 위치를 브라우저(localStorage)에 사용자별로 저장·복원한다.
// 저장소가 막혀 있거나 값이 깨졌거나 맵이 바뀌어 못 쓰는 자리면 null(시작 위치에서 시작).
import type { Facing, MapDef, Vec } from './map.ts'
import { feetBlocked } from './walk.ts'

export type SavedPosition = { pos: Vec; facing: Facing }

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right']

const keyFor = (userId: string) => `fishing-pos:${userId}`

function parse(map: MapDef, raw: string | null): SavedPosition | null {
  if (raw === null) return null
  const v: unknown = JSON.parse(raw)
  if (typeof v !== 'object' || v === null) return null
  const { pos, facing } = v as { pos?: unknown; facing?: unknown }
  if (typeof pos !== 'object' || pos === null) return null
  const { x, y } = pos as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  if (!FACINGS.includes(facing as Facing)) return null
  // 발이 걸을 수 없는 타일에 걸친 채로 시작하면 영영 움직일 수 없다
  return feetBlocked(map, x, y) ? null : { pos: { x, y }, facing: facing as Facing }
}

export function loadPosition(userId: string, map: MapDef): SavedPosition | null {
  try {
    return parse(map, localStorage.getItem(keyFor(userId)))
  } catch {
    return null
  }
}

export function savePosition(userId: string, p: SavedPosition): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify({ pos: { x: p.pos.x, y: p.pos.y }, facing: p.facing }))
  } catch {
    /* 저장소가 막혀 있으면 다음에 시작 위치에서 시작한다 */
  }
}
