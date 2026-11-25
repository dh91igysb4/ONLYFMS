import { describe, expect, it } from 'vitest'
import { ALL_AREAS_OPEN, TILE, interactionAt, isWalkable, reachableTiles, tileAt } from './map.ts'
import { DECOS, DECO_MAX, decoWalkable } from './deco.ts'
import { canDecorate, isleArrival, isleMap, isleNodes, type IsleShape } from './isle.ts'
import { ISLE_LAYOUTS } from './data.ts'
import { SPRITES } from './sprites.ts'

const center = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })

describe('꾸미기 목록 (설계 2026-11-26-my-isle-d §4.2)', () => {
  it('10종, 길·꽃밭만 지나간다, 막는 것은 스프라이트가 있다, 상한 150', () => {
    expect(DECOS.map((d) => d.id)).toEqual(['path', 'flowers', 'fence', 'bench', 'lamp', 'mailbox', 'pot', 'flag', 'statue', 'fountain'])
    expect(DECOS.filter((d) => decoWalkable(d.id)).map((d) => d.id)).toEqual(['path', 'flowers'])
    for (const d of DECOS) if (!decoWalkable(d.id)) expect(SPRITES[`deco-${d.id}`], d.id).toBeTruthy()
    expect(DECO_MAX).toBe(150)
  })
})

describe('섬 꾸미기 맵·규칙 (설계 §4.3)', () => {
  for (const { id: layout } of ISLE_LAYOUTS) {
    describe(layout, () => {
      const a = isleArrival(layout)
      it('길은 길 칸, 꽃밭은 꽃 칸, 막는 것은 못 걷고 그림, 상호작용은 만들지 않는다', () => {
        const spot = { tx: a.tx - 2, ty: a.ty - 1 }
        expect(isWalkable(isleMap(layout), spot.tx, spot.ty, ALL_AREAS_OPEN)).toBe(true)
        const m1 = isleMap(layout, 0, 0, [{ id: 'path', ...spot }])
        expect(tileAt(m1, spot.tx, spot.ty)).toBe('path')
        const m2 = isleMap(layout, 0, 0, [{ id: 'flowers', ...spot }])
        expect(tileAt(m2, spot.tx, spot.ty)).toBe('flower')
        const m3 = isleMap(layout, 0, 0, [{ id: 'bench', ...spot }])
        expect(isWalkable(m3, spot.tx, spot.ty, ALL_AREAS_OPEN)).toBe(false)
        expect(m3.props).toEqual([{ tx: spot.tx, ty: spot.ty, sprite: 'deco-bench' }])
        expect(interactionAt(m3, center(spot.tx, spot.ty + 1), 'up', ALL_AREAS_OPEN)).toBeNull()
        expect(isleMap(layout, 0, 0, [{ id: 'bench', ...spot }])).toBe(m3)
      })
      it('못 놓는 곳: 내리는 칸·부두·바다·건물·문 앞·작업대 앞·겹침', () => {
        const sh: IsleShape = { layout }
        const m = isleMap(layout)
        const door = { tx: m.building!.doorTx, ty: m.building!.ty + m.building!.h }
        const wb = m.fixtures.find((f) => f.act.kind === 'workbench')!.front
        expect(canDecorate(sh, a.tx, a.ty, 'path')).toBe(false)
        expect(canDecorate(sh, 24, 32, 'path')).toBe(false) // 부두
        expect(canDecorate(sh, 0, 0, 'path')).toBe(false) // 바다
        expect(canDecorate(sh, m.building!.tx, m.building!.ty, 'path')).toBe(false)
        expect(canDecorate(sh, door.tx, door.ty, 'fence')).toBe(false)
        expect(canDecorate(sh, wb.tx, wb.ty, 'fence')).toBe(false)
        expect(canDecorate({ layout, deco: [{ id: 'pot', tx: a.tx - 2, ty: a.ty - 1 }] }, a.tx - 2, a.ty - 1, 'path')).toBe(false)
        expect(canDecorate(sh, a.tx - 2, a.ty - 1, 'fence')).toBe(true)
      })
      it('울타리를 마구 놓아도(규칙대로) 모든 땅·자원 칸·작업대·문이 내리는 칸에서 닿는다', () => {
        for (const cleared of [0, 4, 8]) {
          const deco: { id: 'fence'; tx: number; ty: number }[] = []
          const base = isleMap(layout, cleared, 1)
          for (let y = 0; y < base.h; y++) for (let x = 0; x < base.w; x++) {
            if ((x + 2 * y) % 3 !== 0) continue
            if (canDecorate({ layout, cleared, house: 1, deco }, x, y, 'fence')) deco.push({ id: 'fence', tx: x, ty: y })
          }
          expect(deco.length).toBeGreaterThan(40)
          const m = isleMap(layout, cleared, 1, deco)
          const reach = reachableTiles(m, [a], ALL_AREAS_OPEN)
          for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
            if (isWalkable(m, x, y, ALL_AREAS_OPEN)) expect(reach.has(`${x},${y}`), `${layout} c${cleared} ${x},${y}`).toBe(true)
          }
          for (const n of isleNodes(layout).filter((n) => n.zone <= cleared)) {
            expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach.has(`${n.tx + dx},${n.ty + dy}`)), n.id).toBe(true)
          }
          for (const f of m.fixtures) expect(reach.has(`${f.front.tx},${f.front.ty}`)).toBe(true)
        }
      })
    })
  }
})
