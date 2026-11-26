import { describe, expect, it } from 'vitest'
import { ALL_AREAS_OPEN, TILE, exitAt, interactionAt, isWalkable, reachableTiles, tileAt } from './map.ts'
import { FURNITURE, HOME_ROOMS, canPlace, homeArrival, homeMap, type Placed } from './home.ts'
import { isleMap } from './isle.ts'
import { SPRITES } from './sprites.ts'

const center = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })

describe('집 안 맵 (설계 2026-11-26-my-isle-c §4.3)', () => {
  it('단계 1~4 방 바닥 6×4·8×5·10×6·12×7, 0단계는 집 안이 없다', () => {
    expect(HOME_ROOMS).toEqual([[6, 4], [8, 5], [10, 6], [12, 7]])
    expect(homeMap('twin', 0)).toBeNull()
    for (let L = 1; L <= 4; L++) {
      const m = homeMap('twin', L)!
      const [fw, fh] = HOME_ROOMS[L - 1]
      expect([m.id, m.w, m.h, m.onWorldMap, m.indoor]).toEqual(['home', fw + 2, fh + 3, false, true])
      let floor = 0
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (tileAt(m, x, y) === 'floor') floor++
      expect(floor).toBe(fw * fh + 1)
    }
  })
  it('도착 칸(문 위)에서 아래 문으로 나가면 그 섬 집 문 앞', () => {
    for (const layout of ['crescent', 'twin'] as const) {
      const isle = isleMap(layout, 0, 1)
      const door = { tx: isle.building!.doorTx, ty: isle.building!.ty + isle.building!.h }
      const m = homeMap(layout, 2)!
      const a = homeArrival(2)
      expect(isWalkable(m, a.tx, a.ty, ALL_AREAS_OPEN)).toBe(true)
      expect(a.facing).toBe('up')
      const e = exitAt(m, center(a.tx, a.ty + 1))!
      expect(e).toMatchObject({ target: 'isle', entry: { tx: door.tx, ty: door.ty, facing: 'down' } })
    }
  })
  it('가구 칸은 못 걷고 그림(props), 그 칸을 보면 치우기(furn), 빈 바닥을 보면 놓기(furnSpot)', () => {
    const placed: Placed[] = [{ id: 'bed', tx: 1, ty: 2 }]
    const m = homeMap('twin', 1, placed)!
    expect(isWalkable(m, 1, 2, ALL_AREAS_OPEN)).toBe(false)
    expect(m.props).toEqual([{ tx: 1, ty: 2, sprite: 'furn-bed', id: 'bed' }])
    expect(interactionAt(m, center(1, 3), 'up', ALL_AREAS_OPEN)).toEqual({ kind: 'furn', tx: 1, ty: 2, id: 'bed' })
    expect(interactionAt(m, center(2, 3), 'up', ALL_AREAS_OPEN)).toEqual({ kind: 'furnSpot', tx: 2, ty: 2 })
    expect(homeMap('twin', 1, placed)).toBe(homeMap('twin', 1, [{ id: 'bed', tx: 1, ty: 2 }]))
  })
  it('canPlace: 바닥·빈 칸·문과 도착 칸 아님·남은 빈 바닥이 이어져야', () => {
    const a = homeArrival(1)
    expect(canPlace(1, [], 1, 2)).toBe(true)
    expect(canPlace(1, [], 0, 2)).toBe(false) // 벽
    expect(canPlace(1, [], a.tx, a.ty)).toBe(false) // 도착 칸
    expect(canPlace(1, [], a.tx, a.ty + 1)).toBe(false) // 문
    expect(canPlace(1, [{ id: 'bed', tx: 1, ty: 2 }], 1, 2)).toBe(false) // 겹침
    // 방 1(6×4, x 1..6, y 2..5)에서 (2,y)줄을 위에서 막아 왼쪽 칸 (1,2)를 가둔다
    const wall: Placed[] = [{ id: 'chair', tx: 2, ty: 2 }]
    expect(canPlace(1, wall, 1, 3)).toBe(false)
  })
  it('단계를 올려도 이전 방에서 가능했던 배치는 새 방에서도 이어진다', () => {
    const placed: Placed[] = []
    for (let x = 1; x <= 6; x++) if (canPlace(1, placed, x, 2)) placed.push({ id: 'chair', tx: x, ty: 2 })
    for (let L = 2; L <= 4; L++) {
      const m = homeMap('twin', L, placed)!
      const a = homeArrival(L)
      const reach = reachableTiles(m, [a], ALL_AREAS_OPEN)
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        if (tileAt(m, x, y) === 'floor' && !placed.some((p) => p.tx === x && p.ty === y)) expect(reach.has(`${x},${y}`), `${L} ${x},${y}`).toBe(true)
      }
    }
  })
  it('가구 10종: id·이름 고유, 스프라이트 있음', () => {
    expect(FURNITURE).toHaveLength(10)
    expect(new Set(FURNITURE.map((f) => f.id)).size).toBe(10)
    expect(new Set(FURNITURE.map((f) => f.name)).size).toBe(10)
    for (const f of FURNITURE) expect(SPRITES[`furn-${f.id}`], f.id).toBeTruthy()
  })
})

describe('섬 집 단계 (설계 §4.5)', () => {
  it('건물 그림은 단계마다, 0단계 텐트 안내, 1단계부터 문이 집 안으로', () => {
    const names = [0, 1, 2, 3, 4].map((h) => isleMap('crescent', 0, h).buildingSprite)
    expect(names).toEqual(['tent', 'hut', 'cottage', 'house', 'manor'])
    for (const n of names) expect(SPRITES[n], n).toBeTruthy()
    const tent = isleMap('crescent', 0, 0)
    expect(tent.fixtures.some((f) => f.act.kind === 'notice')).toBe(true)
    expect(tent.exits).toHaveLength(0)
    const hut = isleMap('crescent', 0, 1)
    expect(hut.fixtures.some((f) => f.act.kind === 'notice')).toBe(false)
    const b = hut.building!
    expect(exitAt(hut, center(b.doorTx, b.ty + b.h - 1))).toMatchObject({ target: 'home', entry: homeArrival(1) })
    expect(isleMap('crescent', 3, 2)).toBe(isleMap('crescent', 3, 2))
  })
})
