// 지역 → 맵 등록부. 순수 모듈. 여섯 지역 모두 맵이 있다(안 연 지역은 문·선착장이 막는다).
import type { AreaId } from '../data.ts'
import type { MapDef } from '../map.ts'
import { CAVE } from './cave.ts'
import { FOREST } from './forest.ts'
import { ISLAND } from './island.ts'
import { LAKE } from './lake.ts'
import { RIVER } from './river.ts'
import { VILLAGE } from './village.ts'

export const MAPS: Readonly<Partial<Record<AreaId, MapDef>>> = {
  village: VILLAGE, river: RIVER, forest: FOREST, lake: LAKE, cave: CAVE, island: ISLAND,
}

/** 지역의 맵. 맵이 없는 지역이면 null. */
export function mapFor(area: AreaId): MapDef | null {
  return MAPS[area] ?? null
}
