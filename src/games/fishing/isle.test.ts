import { describe, expect, it } from 'vitest'
import { ISLE_LAYOUTS } from './data.ts'
import { ALL_AREAS_OPEN, TILE, interactionAt, reachableTiles, tileAt, type Facing, type MapDef } from './map.ts'
import { isleArrival, isleMap, ownerOfPlaceKey, placeKey, placeName } from './isle.ts'
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
        expect(m.fixtures).toHaveLength(1)
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
