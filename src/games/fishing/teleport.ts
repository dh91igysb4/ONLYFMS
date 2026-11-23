// 순간이동기 세계 좌표와 요금. 순수 모듈(서버 logic.ts와 화면이 같은 값을 쓴다).
// 세계 좌표 = 맵 world 원점 + 이동기 칸 사각형 중심(칸 단위).
import { TP_BASE, TP_PER_10, type AreaId } from './data.ts'
import { mapFor } from './maps/index.ts'

/** 지역 이동기의 세계 좌표(칸). 맵이나 이동기가 없으면 null */
export function teleporterWorld(area: AreaId): { x: number; y: number } | null {
  const map = mapFor(area)
  const tp = map?.teleporter
  if (!map || !tp) return null
  return { x: map.world.tx + tp.tiles.tx + tp.tiles.w / 2, y: map.world.ty + tp.tiles.ty + tp.tiles.h / 2 }
}

/** 두 이동기 사이 요금: TP_BASE + ceil(직선 거리 / 10) * TP_PER_10. 이동기가 없는 지역이면 TP_BASE만 */
export function teleportFee(from: AreaId, to: AreaId): number {
  const a = teleporterWorld(from)
  const b = teleporterWorld(to)
  if (!a || !b) return TP_BASE
  return TP_BASE + Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 10) * TP_PER_10
}
