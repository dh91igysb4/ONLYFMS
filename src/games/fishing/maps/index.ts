// 지역 → 맵 등록부. 순수 모듈. 맵이 없는 지역(아직 열지 않은 단계)은 빠져 있다.
import type { AreaId } from '../data.ts'
import type { MapDef } from '../map.ts'
import { FOREST } from './forest.ts'
import { RIVER } from './river.ts'
import { VILLAGE } from './village.ts'

export const MAPS: Readonly<Partial<Record<AreaId, MapDef>>> = { village: VILLAGE, river: RIVER, forest: FOREST }

/** 지역의 맵. 맵이 없는 지역이면 null. */
export function mapFor(area: AreaId): MapDef | null {
  return MAPS[area] ?? null
}
