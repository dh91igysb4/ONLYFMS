// 모든 맵: 새 걷기 판정(부드러운 물가·물체 발밑)이 지금 걸을 수 있는 칸을 망가뜨리지 않는지 본다.
import { describe, expect, it } from 'vitest'
import { AREAS } from './data.ts'
import { ALL_AREAS_OPEN, TILE, isWalkable, type MapDef, type MapDynamic } from './map.ts'
import { MAPS, mapFor } from './maps/index.ts'
import { isleArrival, isleMap } from './isle.ts'
import { homeArrival, homeMap } from './home.ts'
import { ISLE_ZONES, HOUSE_MAX } from './isleEcon.ts'
import { shoreClassAt, shoreField } from './shore.ts'
import { feetBlocked, pointBlocked, stepWalk } from './walk.ts'

const LOW: MapDynamic = { tide: 'low', holes: new Set() }
const HIGH: MapDynamic = { tide: 'high', holes: new Set() }

type Case = { name: string; map: MapDef; extra: { tx: number; ty: number }[] }
const cases: Case[] = []
for (const map of Object.values(MAPS)) {
  if (!map) continue
  const extra = [...map.docks.map((d) => d.front), ...map.fixtures.map((f) => f.front)]
  for (const a of AREAS) {
    const from = mapFor(a.id)
    if (!from) continue
    for (const e of [...from.exits, ...from.docks]) if (e.target === map.id) extra.push(e.entry)
  }
  cases.push({ name: map.id, map, extra })
}
for (const layout of ['crescent', 'twin'] as const) {
  for (const c of [0, ISLE_ZONES]) {
    const map = isleMap(layout, c)
    cases.push({ name: `isle-${layout}-${c}`, map, extra: [isleArrival(layout), ...map.docks.map((d) => d.front), ...map.fixtures.map((f) => f.front)] })
  }
  for (let h = 1; h <= HOUSE_MAX; h++) {
    const map = homeMap(layout, h)
    if (map) cases.push({ name: `home-${layout}-${h}`, map, extra: [homeArrival(h)] })
  }
}

const dyns = (m: MapDef) => (m.tidal ? [HIGH, LOW] : [HIGH])
const c = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })

describe('모든 맵 걷기', () => {
  it('걸을 수 있는 칸 가운데마다 설 수 있다', () => {
    const bad: string[] = []
    for (const { name, map } of cases) for (const dyn of dyns(map)) {
      for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
        if (!isWalkable(map, tx, ty, ALL_AREAS_OPEN, dyn)) continue
        const p = c(tx, ty)
        if (feetBlocked(map, p.x, p.y, ALL_AREAS_OPEN, dyn)) bad.push(`${name}/${dyn.tide} (${tx},${ty})`)
      }
    }
    expect(bad).toEqual([])
  })

  it('출구 도착 칸·선착장 앞·고정물 앞·섬·집 도착 칸에 설 수 있다', () => {
    const bad: string[] = []
    for (const { name, map, extra } of cases) for (const t of extra) {
      const p = c(t.tx, t.ty)
      if (feetBlocked(map, p.x, p.y, ALL_AREAS_OPEN)) bad.push(`${name} (${t.tx},${t.ty})`)
    }
    expect(bad).toEqual([])
  })

  it('물가를 따라 걸어도 발 중심이 막힌 곳에 들어가지 않는다', () => {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]]
    const bad: string[] = []
    for (const { name, map } of cases) {
      const f = shoreField(map, 'high')
      let n = 0
      for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
        if (!isWalkable(map, tx, ty, ALL_AREAS_OPEN)) continue
        let shore = false
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (shoreClassAt(f, tx + dx, ty + dy) === 'water') shore = true
        if (!shore || n++ % 2) continue
        for (const [x, y] of dirs) {
          let p = { pos: c(tx, ty), facing: 'down' as const, moving: false, walkMs: 0 }
          for (let i = 0; i < 30; i++) {
            p = stepWalk(map, p, { x, y }, 16, ALL_AREAS_OPEN) as typeof p
            if (pointBlocked(map, p.pos.x, p.pos.y, ALL_AREAS_OPEN)) {
              bad.push(`${name} (${tx},${ty}) dir ${x},${y}`)
              break
            }
          }
        }
      }
    }
    expect(bad).toEqual([])
  })
})
