import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadPosition, savePosition, startPosition } from './position.ts'
import { TILE, pierEnd, type Opened } from './map.ts'
import { DEFAULT_AREAS, type AreaId } from './data.ts'
import { VILLAGE } from './maps/village.ts'
import { RIVER } from './maps/river.ts'
import { LAKE } from './maps/lake.ts'
import { FOREST } from './maps/forest.ts'
import { ISLAND } from './maps/island.ts'

const SPAWN = VILLAGE.spawn
const PIER_END = pierEnd(VILLAGE)!

const KEY = 'fishing-pos:u1'
const center = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('position', () => {
  test('save then load round-trips, keyed by user', () => {
    const p = { area: 'village' as const, pos: center(PIER_END.tx, PIER_END.ty), facing: 'left' as const }
    savePosition('u1', p)
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(p)
    expect(loadPosition('u1')).toEqual(p)
    expect(loadPosition('u2')).toBeNull()
  })

  test('the spawn position itself is valid', () => {
    savePosition('u1', { area: 'village', ...SPAWN })
    expect(loadPosition('u1')).toEqual({ area: 'village', ...SPAWN })
  })

  test('a phase-1 save ({pos, facing}, no area) restores in the village', () => {
    const pos = center(PIER_END.tx, PIER_END.ty)
    localStorage.setItem(KEY, JSON.stringify({ pos, facing: 'left' }))
    expect(loadPosition('u1')).toEqual({ area: 'village', pos, facing: 'left' })
  })

  test('a river position restores; an unknown area, a blocked river tile or broken JSON gives null', () => {
    const south = RIVER.exits[0]
    if (!('edge' in south)) throw new Error('river exit 0 should be an edge exit')
    const walkable = center(south.from, RIVER.h - 2) // 남쪽 출구 바로 안쪽 길
    const saved = { area: 'river' as const, pos: walkable, facing: 'up' as const }
    savePosition('u1', saved)
    expect(loadPosition('u1')).toEqual(saved)
    localStorage.setItem(KEY, JSON.stringify({ ...saved, area: 'moon' }))
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ ...saved, area: 'constructor' }))
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ ...saved, pos: center(0, 0) })) // 강 맵 모서리 나무
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, '{broken')
    expect(loadPosition('u1')).toBeNull()
  })

  test('a spot on a locked gate tile (river broken bridge) is accepted: loadPosition checks the map with every area open', () => {
    // 열린 지역으로 다시 거르는 일은 화면(서버 view의 areas)이 한다
    const { tiles } = RIVER.gates[0]
    const saved = { area: 'river' as const, pos: center(tiles.tx, tiles.ty), facing: 'up' as const }
    savePosition('u1', saved)
    expect(loadPosition('u1')).toEqual(saved)
  })

  test('nothing saved, broken JSON or a wrong shape gives null', () => {
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, '{not json')
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, 'null')
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ pos: { x: '200', y: 104 }, facing: 'down' }))
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ pos: { x: 200, y: 104 }, facing: 'north' }))
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ pos: { x: 200, y: 104 } }))
    expect(loadPosition('u1')).toBeNull()
  })

  test('non-finite coordinates give null', () => {
    // JSON에는 NaN·Infinity가 없어 null이 되지만, 아주 큰 수는 Infinity로 읽힌다
    localStorage.setItem(KEY, '{"pos":{"x":1e999,"y":104},"facing":"down"}')
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ pos: { x: NaN, y: 104 }, facing: 'down' }))
    expect(loadPosition('u1')).toBeNull()
  })

  test('a position on an unwalkable tile or off the map gives null', () => {
    savePosition('u1', { area: 'village', pos: center(10, 30), facing: 'down' }) // 바다
    expect(loadPosition('u1')).toBeNull()
    savePosition('u1', { area: 'village', pos: center(0, 0), facing: 'down' }) // 나무
    expect(loadPosition('u1')).toBeNull()
    savePosition('u1', { area: 'village', pos: { x: -40, y: 104 }, facing: 'down' })
    expect(loadPosition('u1')).toBeNull()
  })

  test('a position whose feet overlap an unwalkable tile gives null even if its centre tile is walkable', () => {
    // 부두 끝 타일 가운데에서 왼쪽으로 7px: 중심은 부두지만 발(폭 10) 왼쪽이 물에 걸친다
    const end = center(PIER_END.tx, PIER_END.ty)
    savePosition('u1', { area: 'village', pos: { x: end.x - 7, y: end.y }, facing: 'down' })
    expect(loadPosition('u1')).toBeNull()
    // 발이 타일 안에 딱 맞으면(왼쪽 변이 경계) 괜찮다
    savePosition('u1', { area: 'village', pos: { x: end.x - 3, y: end.y }, facing: 'down' })
    expect(loadPosition('u1')).not.toBeNull()
  })

  test('a throwing localStorage gives null and never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(loadPosition('u1')).toBeNull()
    expect(() => savePosition('u1', { area: 'village', ...SPAWN })).not.toThrow()
  })
})

describe('startPosition (첫 서버 상태를 받은 뒤 시작 자리)', () => {
  const opened = (...extra: AreaId[]): Opened => new Set<AreaId>([...DEFAULT_AREAS, ...extra])
  const AT_SPAWN = { area: 'village', pos: SPAWN.pos, facing: SPAWN.facing }
  const at = (area: AreaId, tx: number, ty: number) => ({ area, pos: center(tx, ty), facing: 'up' as const })

  test('nothing saved starts at the village spawn', () => {
    expect(startPosition(null, opened())).toEqual(AT_SPAWN)
  })

  test('a saved area that is not open (lake) starts at the village spawn', () => {
    const lake = LAKE.exits[0]
    if (!('edge' in lake)) throw new Error('lake exit 0 should be an edge exit')
    const saved = at('lake', lake.from, LAKE.h - 2)
    expect(startPosition(saved, opened())).toEqual(AT_SPAWN)
    expect(startPosition(saved, opened('lake'))).toEqual(saved)
  })

  test('a saved spot on a still-locked gate tile (river broken bridge) starts at the spawn; once lake is open it is kept', () => {
    const { tiles } = RIVER.gates[0]
    const saved = at('river', tiles.tx, tiles.ty)
    expect(startPosition(saved, opened())).toEqual(AT_SPAWN)
    expect(startPosition(saved, opened('lake'))).toEqual(saved)
  })

  test('a saved spot beyond a locked gate (river north of the broken bridge) is unreachable while lake is closed → spawn; kept once lake is open', () => {
    // (24,1)은 산 호수에서 강으로 내려온 도착 칸. 산 호수가 닫혀 있으면 어느 도착점에서도 걸어 닿지 못한다
    const saved = at('river', 24, 1)
    expect(startPosition(saved, opened())).toEqual(AT_SPAWN)
    expect(startPosition(saved, opened('lake'))).toEqual(saved)
  })

  test('reachable positions in base areas are still restored (river south field, forest)', () => {
    const river = at('river', 24, 4)
    expect(startPosition(river, opened())).toEqual(river)
    const into = RIVER.exits.find((e) => e.target === 'forest')!.entry
    const forest = { area: 'forest' as const, pos: center(into.tx, into.ty), facing: into.facing }
    expect(startPosition(forest, opened())).toEqual(forest)
  })

  test('a cave or island position restores there when that area is open', () => {
    const into = FOREST.exits.find((e) => e.target === 'cave')!.entry // 숲에서 들어온 자리
    const cave = { area: 'cave' as const, pos: center(into.tx, into.ty), facing: into.facing }
    expect(startPosition(cave, opened('cave'))).toEqual(cave)
    const { entry } = VILLAGE.docks[0]
    const island = { area: 'island' as const, pos: center(entry.tx, entry.ty), facing: entry.facing }
    expect(startPosition(island, opened('island'))).toEqual(island)
    expect(startPosition(island, opened('cave'))).toEqual(AT_SPAWN)
  })

  test('the island dock-front spot (where the boat back to the village is) is a valid start too', () => {
    const { front } = ISLAND.docks[0]
    const saved = { area: 'island' as const, pos: center(front.tx, front.ty), facing: front.facing }
    expect(startPosition(saved, opened('island'))).toEqual(saved)
  })

  test('the returned spawn is a copy (changing it does not move VILLAGE.spawn)', () => {
    const before = { ...VILLAGE.spawn.pos }
    const p = startPosition(null, opened())
    p.pos.x += 100
    expect(VILLAGE.spawn.pos).toEqual(before)
    expect(startPosition(null, opened()).pos).toEqual(VILLAGE.spawn.pos)
  })
})

describe('position: 갯벌·늪지 (낚시 5부 M2)', () => {
  test('저장 위치가 갯벌인데 아직 안 열었으면 마을 시작 위치', () => {
    savePosition('u1', { area: 'tideflat', pos: center(45, 16), facing: 'left' })
    const saved = loadPosition('u1')
    expect(saved).toEqual({ area: 'tideflat', pos: center(45, 16), facing: 'left' })
    expect(startPosition(saved, new Set<AreaId>(DEFAULT_AREAS))).toEqual({ area: 'village', pos: SPAWN.pos, facing: SPAWN.facing })
    expect(startPosition(saved, new Set<AreaId>([...DEFAULT_AREAS, 'tideflat']))).toEqual(saved)
  })

  test('진흙 위 저장 위치는 가장 가까운 늘 걷는 칸(nearestDryTile)으로 복원한다', () => {
    // (39,14)는 진흙, 오른쪽 (41,14)가 모래사장
    savePosition('u1', { area: 'tideflat', pos: center(39, 14), facing: 'down' })
    const saved = loadPosition('u1')
    expect(saved).toEqual({ area: 'tideflat', pos: center(41, 14), facing: 'down' })
    expect(startPosition(saved, new Set<AreaId>([...DEFAULT_AREAS, 'tideflat']))).toEqual(saved)
  })

  test('늪지 데크 위 위치는 그대로, 늪물 위는 null', () => {
    savePosition('u1', { area: 'swamp', pos: center(20, 11), facing: 'up' })
    expect(loadPosition('u1')).toEqual({ area: 'swamp', pos: center(20, 11), facing: 'up' })
    savePosition('u1', { area: 'swamp', pos: center(20, 5), facing: 'up' })
    expect(loadPosition('u1')).toBeNull()
  })
})
