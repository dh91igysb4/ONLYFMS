// 낚시 마을의 마지막 위치를 브라우저(localStorage)에 사용자별로 저장·복원한다.
// 저장소가 막혀 있거나 값이 깨졌거나 맵이 바뀌어 못 쓰는 자리면 null(시작 위치에서 시작).
import { isWalkable, TILE, type Facing, type Vec } from './map.ts'
import { FEET } from './walk.ts'

export type SavedPosition = { pos: Vec; facing: Facing }

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right']
// walk.ts와 같은 경계 규칙: 발 사각형 변이 타일 경계에 딱 닿으면 안쪽 타일만 센다.
const EDGE_EPS = 1e-6

const keyFor = (userId: string) => `fishing-pos:${userId}`

/** 발 사각형이 걸을 수 있는 타일에만 놓이는가. 겹친 채로 시작하면 영영 움직일 수 없다. */
function feetFree(pos: Vec): boolean {
  const tx0 = Math.floor((pos.x - FEET.w / 2 + EDGE_EPS) / TILE)
  const tx1 = Math.floor((pos.x + FEET.w / 2 - EDGE_EPS) / TILE)
  const ty0 = Math.floor((pos.y - FEET.h / 2 + EDGE_EPS) / TILE)
  const ty1 = Math.floor((pos.y + FEET.h / 2 - EDGE_EPS) / TILE)
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!isWalkable(tx, ty)) return false
  return true
}

function parse(raw: string | null): SavedPosition | null {
  if (raw === null) return null
  const v: unknown = JSON.parse(raw)
  if (typeof v !== 'object' || v === null) return null
  const { pos, facing } = v as { pos?: unknown; facing?: unknown }
  if (typeof pos !== 'object' || pos === null) return null
  const { x, y } = pos as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  if (!FACINGS.includes(facing as Facing)) return null
  const p = { x, y }
  return feetFree(p) ? { pos: p, facing: facing as Facing } : null
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
    localStorage.setItem(keyFor(userId), JSON.stringify({ pos: { x: p.pos.x, y: p.pos.y }, facing: p.facing }))
  } catch {
    /* 저장소가 막혀 있으면 다음에 시작 위치에서 시작한다 */
  }
}
