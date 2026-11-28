// 지역 → 맵 등록부. 순수 모듈. 모든 지역에 맵이 있다(안 연 지역은 문·선착장이 막는다).
// 내 섬(isle)·집 안(home)은 주인 상태마다 맵이 달라 여기 없고 mapFor가 상태로 고른다.
import type { AreaId } from '../data.ts'
import { isleMap, type IsleShape } from '../isle.ts'
import { homeMap } from '../home.ts'
import type { MapDef } from '../map.ts'
import { CAVE } from './cave.ts'
import { FOREST } from './forest.ts'
import { HALL } from './hall.ts'
import { HALL2 } from './hall2.ts'
import { ISLAND } from './island.ts'
import { LAKE } from './lake.ts'
import { RIVER } from './river.ts'
import { SUMMIT } from './summit.ts'
import { SWAMP } from './swamp.ts'
import { TIDEFLAT } from './tideflat.ts'
import { VILLAGE } from './village.ts'
import { WRECK } from './wreck.ts'

export const MAPS: Readonly<Partial<Record<AreaId, MapDef>>> = {
  village: VILLAGE, river: RIVER, forest: FOREST, lake: LAKE, cave: CAVE, island: ISLAND, tideflat: TIDEFLAT, swamp: SWAMP, summit: SUMMIT, wreck: WRECK, hall: HALL, hall2: HALL2,
}

/** 지역의 맵. 내 섬·집 안은 섬 상태(shape)가 있을 때만 그 맵(집 0단계면 집 안 없음), 다른 지역은 shape를 무시한다. 맵이 없으면 null. */
export function mapFor(area: AreaId, shape?: IsleShape | null): MapDef | null {
  if (area === 'isle') return shape ? isleMap(shape.layout, shape.cleared, shape.house, shape.deco) : null
  if (area === 'home') return shape ? homeMap(shape.layout, shape.house ?? 0, shape.placed) : null
  return MAPS[area] ?? null
}
