import { describe, expect, it } from 'vitest'
import { ISLE_LAYOUTS } from './data.ts'
import { ALL_AREAS_OPEN, TILE, interactionAt, reachableTiles, tileAt, type Facing, type MapDef } from './map.ts'
import { isleArrival, isleMap, isleNodes, isleZoneTiles, ownerOfPlaceKey, placeKey, placeName } from './isle.ts'
import { ISLE_ZONES } from './isleEcon.ts'
import { mapFor } from './maps/index.ts'
import { placeMarkers } from './atlas.ts'
import { SPRITES } from './sprites.ts'

const center = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
const FACINGS: Facing[] = ['up', 'down', 'left', 'right']
const allTiles = (m: MapDef) => Array.from({ length: m.h }, (_, ty) => Array.from({ length: m.w }, (_, tx) => ({ tx, ty }))).flat()

describe('내 섬 맵(내 섬 설계 §5.2)', () => {
  for (const { id } of ISLE_LAYOUTS) {
    describe(id, () => {
      const m = isleMap(id)
      it('48×36 바깥 맵, 세계 지도 밖, 낚시 자리·순간이동기 없음, 텐트 그림', () => {
        expect([m.id, m.w, m.h, m.indoor, m.onWorldMap, m.teleporter]).toEqual(['isle', 48, 36, false, false, null])
        expect(m.spots).toEqual({})
        expect(m.buildingSprite).toBe('tent')
        expect(SPRITES.tent).toBeTruthy()
      })
      it('선착장 하나: 마을행, 낚시 섬의 마을 도착 칸과 같은 곳에 내린다', () => {
        expect(m.docks).toHaveLength(1)
        const d = m.docks[0]
        expect(d.target).toBe('village')
        expect(d.entry).toEqual({ tx: 42, ty: 28, facing: 'up' })
        expect(interactionAt(m, center(d.front.tx, d.front.ty), d.front.facing, ALL_AREAS_OPEN)).toEqual({ kind: 'dock', target: 'village' })
      })
      it('배에서 내리는 칸에서 텐트 문 앞(안내판)까지 걸어서 닿고, 선착장 front와 바닷가도 닿는다', () => {
        const a = isleArrival(id)
        const reach = reachableTiles(m, [a], ALL_AREAS_OPEN)
        expect(reach.has(`${a.tx},${a.ty}`)).toBe(true)
        expect(m.fixtures).toHaveLength(2)
        const f = m.fixtures[0]
        expect(f.act).toEqual({ kind: 'notice', text: '텐트 안은 아직 들어갈 수 없어요' })
        expect(reach.has(`${f.front.tx},${f.front.ty}`)).toBe(true)
        expect(interactionAt(m, center(f.front.tx, f.front.ty), f.front.facing, ALL_AREAS_OPEN)).toEqual(f.act)
        expect(f.front.tx).toBe(m.building!.doorTx)
        expect(f.front.ty).toBe(m.building!.ty + m.building!.h)
        expect(reach.has(`${m.docks[0].front.tx},${m.docks[0].front.ty}`)).toBe(true)
        const sand = [...reach].filter((k) => { const [x, y] = k.split(',').map(Number); return tileAt(m, x, y) === 'sand' })
        expect(sand.length).toBeGreaterThan(30)
      })
      it('섬 안쪽 일부는 나무·바위로 막혀 있다(개간 자리)', () => {
        const blocked = allTiles(m).filter(({ tx, ty }) => tileAt(m, tx, ty) === 'tree' || tileAt(m, tx, ty) === 'rock')
        expect(blocked.length).toBeGreaterThan(40)
      })
      it('어디서도 낚시 상호작용이 없다', () => {
        for (const { tx, ty } of allTiles(m)) for (const f of FACINGS) {
          expect(interactionAt(m, center(tx, ty), f, ALL_AREAS_OPEN)?.kind === 'fish').toBe(false)
        }
      })
    })
  }
  it('텐트는 들어가는 건물이 아니라 길 표시에 상점(회관)이 없고, 마을은 그대로 있다', () => {
    for (const { id } of ISLE_LAYOUTS) expect(placeMarkers(isleMap(id), ALL_AREAS_OPEN).map((m) => m.kind)).not.toContain('shop')
    expect(placeMarkers(mapFor('village')!, ALL_AREAS_OPEN).map((m) => m.kind)).toContain('shop')
  })
  it('두 섬은 모양이 다르다', () => {
    expect(isleMap('crescent').rows).not.toEqual(isleMap('twin').rows)
  })
  it('mapFor: isle은 모양이 있을 때만, 다른 지역은 모양을 무시한다', () => {
    expect(mapFor('isle')).toBeNull()
    expect(mapFor('isle', null)).toBeNull()
    expect(mapFor('isle', 'twin')).toBe(isleMap('twin'))
    expect(mapFor('village', 'twin')).toBe(mapFor('village'))
    expect(mapFor('isle', 'twin', 4)).toBe(isleMap('twin', 4))
  })
})

describe('장소 키(내 섬 설계 §5.6)', () => {
  const ID = 'ABCDEF01-2345-6789-ABCD-EF0123456789'
  it('주인 있는 섬은 isle-<소문자, 하이픈 없는 32자>, 48자 이하', () => {
    const k = placeKey('isle', ID)
    expect(k).toBe('isle-abcdef0123456789abcdef0123456789')
    expect(k.length).toBe(37)
    expect(k.length).toBeLessThanOrEqual(48)
  })
  it('주인 없으면 지역 id', () => {
    expect(placeKey('village', null)).toBe('village')
    expect(placeKey('isle', null)).toBe('isle')
  })
  it('ownerOfPlaceKey 왕복, 지역 키·이상한 값은 null', () => {
    expect(ownerOfPlaceKey(placeKey('isle', ID))).toBe('abcdef0123456789abcdef0123456789')
    expect(ownerOfPlaceKey('village')).toBeNull()
    expect(ownerOfPlaceKey('isle-xyz')).toBeNull()
  })
  it('placeName: 지역 이름·내 섬·아이디의 섬·누군가의 섬·모르면 null', () => {
    const players = [{ id: '11111111-2222-3333-4444-555555555555', handle: 'mj' }]
    const opts = { selfId: ID, players }
    expect(placeName('river', opts)).toBe('마을 강')
    expect(placeName(placeKey('isle', ID), opts)).toBe('내 섬')
    expect(placeName(placeKey('isle', players[0].id), opts)).toBe('mj의 섬')
    expect(placeName(placeKey('isle', '99999999-2222-3333-4444-555555555555'), opts)).toBe('누군가의 섬')
    expect(placeName('nowhere', opts)).toBeNull()
  })
})

describe('내 섬 B: 자원 칸·구역·작업대 (설계 2026-11-26-my-isle-b §5.2)', () => {
  for (const { id } of ISLE_LAYOUTS) {
    describe(id, () => {
      const nodes = isleNodes(id)
      const zones = isleZoneTiles(id)
      it('처음 닿는 자원 칸은 나무 4·바위 3, 철광은 구역 1 이후에만', () => {
        const start = nodes.filter((n) => n.zone === 0)
        expect(start.filter((n) => n.kind === 'tree')).toHaveLength(4)
        expect(start.filter((n) => n.kind === 'rock')).toHaveLength(3)
        expect(start.filter((n) => n.kind === 'iron')).toHaveLength(0)
        expect(nodes.filter((n) => n.kind === 'iron').length).toBeGreaterThanOrEqual(3)
        expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
      })
      it('구역은 1..8, 구역마다 칸이 있고 자원 칸은 구역에 들지 않는다', () => {
        const counts = new Map<number, number>()
        for (const z of zones.values()) counts.set(z, (counts.get(z) ?? 0) + 1)
        expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        for (const n of nodes) expect(zones.has(`${n.tx},${n.ty}`)).toBe(false)
      })
      it('cleared 0..8마다: 치운 칸은 풀밭, 드러난 자원 칸만 맵에 있고 모두 걸어 닿는다, 작업대·텐트 앞도', () => {
        for (let k = 0; k <= ISLE_ZONES; k++) {
          const m = isleMap(id, k)
          const reach = reachableTiles(m, [isleArrival(id)], ALL_AREAS_OPEN)
          for (const [key, z] of zones) {
            const [x, y] = key.split(',').map(Number)
            if (z <= k) expect(tileAt(m, x, y), `${id} k${k} ${key}`).toBe('grass')
            else expect(['tree', 'rock']).toContain(tileAt(m, x, y))
          }
          expect(m.nodes.map((n) => n.id).sort()).toEqual(nodes.filter((n) => n.zone <= k).map((n) => n.id).sort())
          for (const n of m.nodes) {
            const fronts = FACINGS.map((f) => ({ f, dx: f === 'left' ? 1 : f === 'right' ? -1 : 0, dy: f === 'up' ? 1 : f === 'down' ? -1 : 0 }))
              .filter(({ dx, dy }) => reach.has(`${n.tx + dx},${n.ty + dy}`))
            expect(fronts.length, `${id} k${k} ${n.id}`).toBeGreaterThan(0)
            const { f, dx, dy } = fronts[0]
            expect(interactionAt(m, center(n.tx + dx, n.ty + dy), f, ALL_AREAS_OPEN)).toEqual({ kind: 'node', id: n.id, res: n.kind })
          }
          for (const fx of m.fixtures) expect(reach.has(`${fx.front.tx},${fx.front.ty}`), `${id} k${k} fixture`).toBe(true)
        }
      })
      it('작업대: 고정물 workbench, 그 칸은 bench(못 걷는 칸)', () => {
        const m = isleMap(id)
        const wb = m.fixtures.find((f) => f.act.kind === 'workbench')!
        expect(interactionAt(m, center(wb.front.tx, wb.front.ty), wb.front.facing, ALL_AREAS_OPEN)).toEqual({ kind: 'workbench' })
        expect(tileAt(m, wb.front.tx, wb.front.ty - 1)).toBe('bench')
      })
      it('같은 (모양, cleared)는 같은 맵 객체', () => {
        expect(isleMap(id, 3)).toBe(isleMap(id, 3))
        expect(isleMap(id, 0)).toBe(isleMap(id))
      })
    })
  }
})

describe('내 섬 구역·자원 칸 고정(세이브의 cleared·자원 칸 id가 가리키는 것이 바뀌면 안 된다)', () => {
  it('자원 칸 id·위치·구역과 구역 칸 수가 그대로', () => {
    for (const { id } of ISLE_LAYOUTS) {
      expect(isleNodes(id).map((n) => `${n.id}@${n.tx},${n.ty}:${n.kind}:${n.zone}`)).toMatchSnapshot()
      expect([...isleZoneTiles(id)].map(([k, z]) => `${k}=${z}`).join(' ')).toMatchSnapshot()
    }
  })
})
