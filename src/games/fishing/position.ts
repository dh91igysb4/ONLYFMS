// 낚시터의 마지막 지역·위치를 브라우저(localStorage)에 사용자별로 저장·복원한다.
// 저장소가 막혀 있거나 값이 깨졌거나 지역·맵이 바뀌어 못 쓰는 자리면 null(마을 시작 위치에서 시작).
// 1단계 형식({pos, facing}, area 없음)은 마을로 읽는다.
// 열린 지역으로 거르는 일은 첫 서버 상태를 받은 뒤 startPosition이 한다.
import { AREAS, type AreaId, type IsleLayoutId } from './data.ts'
import { isleArrival } from './isle.ts'
import { ALL_AREAS_OPEN, nearestDryTile, reachableTiles, TILE, tileOf, type Facing, type MapDef, type MapDynamic, type Opened, type Vec } from './map.ts'
import { mapFor } from './maps/index.ts'
import { VILLAGE } from './maps/village.ts'
import { feetBlocked } from './walk.ts'

export type SavedPosition = { area: AreaId; pos: Vec; facing: Facing }

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right']

const keyFor = (userId: string) => `fishing-pos:${userId}`
const LOW_TIDE: MapDynamic = { tide: 'low', holes: new Set<string>() }

function parse(raw: string | null): SavedPosition | null {
  if (raw === null) return null
  const v: unknown = JSON.parse(raw)
  if (typeof v !== 'object' || v === null) return null
  const { area = 'village', pos, facing } = v as { area?: unknown; pos?: unknown; facing?: unknown }
  if (typeof pos !== 'object' || pos === null) return null
  const { x, y } = pos as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  if (!FACINGS.includes(facing as Facing)) return null
  // 내 섬은 섬 모양을 알아야 맵이 정해진다: 여기서는 값만 보고, 맵 판정은 startPosition이 한다
  if (area === 'isle') return { area: 'isle', pos: { x, y }, facing: facing as Facing }
  const map: MapDef | null = AREAS.some((a) => a.id === area) ? mapFor(area as AreaId) : null
  if (map === null) return null
  // 발이 걸을 수 없는 타일에 걸친 채로 시작하면 영영 움직일 수 없다.
  // 여기서는 맵만 본다(모든 지역이 열린 것으로). 아직 안 연 지역·문 칸인지는 화면이 열린 지역으로 다시 본다
  if (!feetBlocked(map, x, y, ALL_AREAS_OPEN)) return { area: map.id, pos: { x, y }, facing: facing as Facing }
  // 물때 맵의 진흙 위(썰물에 저장): 지금 물때를 모르니 늘 가장 가까운 늘 걷는 칸에 세운다(썰물이면 다시 걸어 들어가면 된다)
  if (map.tidal && !feetBlocked(map, x, y, ALL_AREAS_OPEN, LOW_TIDE)) {
    const dry = nearestDryTile(map, tileOf({ x, y }), ALL_AREAS_OPEN)
    if (dry) return { area: map.id, pos: { x: dry.tx * TILE + TILE / 2, y: dry.ty * TILE + TILE / 2 }, facing: facing as Facing }
  }
  return null
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

/**
 * 열린 지역 기준으로 이 맵에 실제로 들어올 수 있는 도착 칸들:
 * 열린 다른 맵의 출구·선착장 중 이 맵으로 오는 것의 entry, 마을이면 시작 위치(상점 문 앞)도.
 */
function arrivalTiles(map: MapDef, opened: Opened): { tx: number; ty: number }[] {
  const out = AREAS.flatMap((a) => {
    const from = opened.has(a.id) ? mapFor(a.id) : null
    if (!from) return []
    return [...from.exits, ...from.docks].filter((e) => e.target === map.id).map(({ entry: { tx, ty } }) => ({ tx, ty }))
  })
  if (map.id === VILLAGE.id) out.push(tileOf(VILLAGE.spawn.pos))
  return out
}

/**
 * 첫 서버 상태(열린 지역)를 받은 뒤 시작할 자리.
 * 저장 위치가 없거나, 그 지역이 아직 안 열렸거나, 발이 열린 지역 기준으로 못 걷는 칸(아직 잠긴 문 등)에 걸치거나,
 * 열린 지역 기준으로 그 맵의 도착 칸들에서 걸어 닿지 못하는 칸(잠긴 문 너머 등)이면 마을 시작 위치.
 * 내 섬(area 'isle')은 섬 모양(isleLayout)이 있어야 그 맵으로 보고, 없으면 마을 시작 위치.
 */
export function startPosition(saved: SavedPosition | null, opened: Opened, isleLayout: IsleLayoutId | null = null): SavedPosition {
  const map = saved && opened.has(saved.area) ? mapFor(saved.area, isleLayout) : null
  if (saved && map && !feetBlocked(map, saved.pos.x, saved.pos.y, opened)) {
    const { tx, ty } = tileOf(saved.pos)
    // 내 섬은 배로만 온다: 배에서 내리는 칸이 도착 칸
    const arrivals = saved.area === 'isle' && isleLayout ? [isleArrival(isleLayout)] : arrivalTiles(map, opened)
    if (reachableTiles(map, arrivals, opened).has(`${tx},${ty}`)) return saved
  }
  return { area: VILLAGE.id, pos: { ...VILLAGE.spawn.pos }, facing: VILLAGE.spawn.facing }
}
