// 지역 → 맵 등록부. 순수 모듈. 모든 지역에 맵이 있다(안 연 지역은 문·선착장이 막는다).
import type { AreaId } from '../data.ts'
import type { MapDef } from '../map.ts'
import { CAVE } from './cave.ts'
import { FOREST } from './forest.ts'
import { HALL } from './hall.ts'
import { ISLAND } from './island.ts'
import { LAKE } from './lake.ts'
import { RIVER } from './river.ts'
import { SUMMIT } from './summit.ts'
import { SWAMP } from './swamp.ts'
import { TIDEFLAT } from './tideflat.ts'
import { VILLAGE } from './village.ts'
import { WRECK } from './wreck.ts'

export const MAPS: Readonly<Partial<Record<AreaId, MapDef>>> = {
  village: VILLAGE, river: RIVER, forest: FOREST, lake: LAKE, cave: CAVE, island: ISLAND, tideflat: TIDEFLAT, swamp: SWAMP, summit: SUMMIT, wreck: WRECK, hall: HALL,
}

/** 지역의 맵. 맵이 없는 지역이면 null. */
export function mapFor(area: AreaId): MapDef | null {
  return MAPS[area] ?? null
}
