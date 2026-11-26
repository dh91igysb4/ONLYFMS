import { describe, expect, it } from 'vitest'
import { defineMap, TILE, type MapDef } from './map.ts'
import { MAPS } from './maps/index.ts'
import { SPRITES } from './sprites.ts'
import { footprintAt, shoreBands, shoreClassAt, shoreField, wetness, SAND_BAND, WET_BAND } from './shore.ts'

const map = (rows: string[], opts: Parameters<typeof defineMap>[2] = {}): MapDef =>
  defineMap('village', rows, { spots: { water: 'shore' }, ...opts })
const center = (m: MapDef, tx: number, ty: number) => wetness(shoreField(m, 'high'), tx * TILE + 8, ty * TILE + 8)

/** 스프라이트 아래 16줄(키 큰 것) 또는 전체(16×16)의 불투명 바깥 사각형 */
function opaqueBox(name: string): { x0: number; x1: number; y0: number; y1: number } {
  const s = SPRITES[name]
  const top = s.h - TILE
  let x0 = 99, x1 = -1, y0 = 99, y1 = -1
  for (let y = top; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (s.rows[y][x] === '.' || s.rows[y][x] === ' ') continue
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y - top); y1 = Math.max(y1, y - top)
  }
  return { x0, x1, y0, y1 }
}

describe('wetness', () => {
  it('넓은 물 가운데 1, 넓은 땅 가운데 0', () => {
    const m = map(['~~~~~,,,,,', '~~~~~,,,,,', '~~~~~,,,,,', '~~~~~,,,,,', '~~~~~,,,,,'])
    expect(center(m, 1, 2)).toBeCloseTo(1)
    expect(center(m, 8, 2)).toBeCloseTo(0)
  })

  it('1칸 물길 가운데 0.6 이상, 1칸 땅 가운데 0.4 이하', () => {
    const ch = map(Array(5).fill(',,~,,'))
    expect(center(ch, 2, 2)).toBeGreaterThanOrEqual(0.6)
    const land = map(Array(5).fill('~~,~~'))
    expect(center(land, 2, 2)).toBeLessThanOrEqual(0.4)
  })

  it('1칸 섬·1칸 연못은 심지를 지킨다', () => {
    const isle = map(['~~~~~', '~~~~~', '~~,~~', '~~~~~', '~~~~~'])
    expect(center(isle, 2, 2)).toBeLessThanOrEqual(0.45)
    const pond = map([',,,,,', ',,,,,', ',,~,,', ',,,,,', ',,,,,'])
    expect(center(pond, 2, 2)).toBeGreaterThanOrEqual(0.55)
  })

  it('곧은 물가: 칸 경계에서 0.5, 물 쪽 > 0.5, 땅 쪽 < 0.5', () => {
    const m = map(Array(5).fill(',,,~~~'))
    const f = shoreField(m, 'high')
    expect(wetness(f, 48, 40)).toBeCloseTo(0.5)
    expect(wetness(f, 50, 40)).toBeGreaterThan(0.5)
    expect(wetness(f, 46, 40)).toBeLessThan(0.5)
  })

  it('부두 옆 물 칸은 물, 부두 뿌리 앞 땅은 땅', () => {
    const m = map(['.....', '.....', '~~#~~', '~~#~~', '~~#~~', '~~~~~'])
    const f = shoreField(m, 'high')
    expect(wetness(f, 1 * TILE + 15.5, 3 * TILE + 8)).toBeGreaterThanOrEqual(0.5)
    expect(wetness(f, 2 * TILE + 8, 1 * TILE + 15.5)).toBeLessThan(0.5)
  })

  it('진흙·얼음 이웃 칸은 고정', () => {
    const m = map(['....', '.mm.', '~~~~'], { tidal: true })
    const f = shoreField(m, 'high')
    expect(shoreClassAt(f, 0, 1)).toBe('fixed')
    expect(shoreClassAt(f, 0, 2)).toBe('fixed')
    expect(shoreBands(f, 0, 2)).toBeNull()
    const ice = map([',,,,', ',ii,', ',,,,', ',,,,', '~~~~'], { snowy: true })
    expect(shoreClassAt(shoreField(ice, 'high'), 0, 0)).toBe('fixed')
  })

  it('가장자리: 맵 밖은 안쪽 칸 값', () => {
    const m = map(Array(5).fill(',,~~~'))
    const f = shoreField(m, 'high')
    expect(wetness(f, 0.5, 40)).toBeCloseTo(0)
    expect(wetness(f, 5 * TILE - 0.5, 40)).toBeCloseTo(1)
  })
})

describe('shoreBands', () => {
  it('물가 칸은 배열, 물가에서 먼 칸은 null', () => {
    const m = map(Array(5).fill(',,,,,,~~~~~~'))
    const f = shoreField(m, 'high')
    const near = shoreBands(f, 5, 2)
    expect(near).not.toBeNull()
    expect(near!.length).toBe(256)
    expect(Math.min(...near!)).toBeLessThan(0.5)
    expect(shoreBands(f, 0, 2)).toBeNull()
    expect(shoreBands(f, 11, 2)).toBeNull()
  })

  it('띠 값 범위: 땅 칸 null이면 모두 < SAND_BAND, 물 칸 null이면 모두 ≥ WET_BAND', () => {
    const m = map(Array(5).fill(',,,,,,~~~~~~'))
    const f = shoreField(m, 'high')
    for (let tx = 0; tx < 12; tx++) {
      if (shoreBands(f, tx, 2)) continue
      for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
        const v = wetness(f, tx * TILE + i + 0.5, 2 * TILE + j + 0.5)
        if (shoreClassAt(f, tx, 2) === 'water') expect(v).toBeGreaterThanOrEqual(WET_BAND)
        else expect(v).toBeLessThan(SAND_BAND)
      }
    }
  })

  it('가장 큰 맵 모든 칸 shoreBands 계산 150ms 이하', () => {
    const big = Object.values(MAPS).reduce((a, b) => (b!.w * b!.h > a!.w * a!.h ? b : a))!
    const f = shoreField(big, 'high')
    const t0 = performance.now()
    for (let ty = 0; ty < big.h; ty++) for (let tx = 0; tx < big.w; tx++) shoreBands(f, tx, ty)
    expect(performance.now() - t0).toBeLessThan(150)
  })
})

describe('footprintAt', () => {
  it('나무 x4–12 y3–10, 바위 x1–14 y6–14, 세로 울타리 x5–11, 물체 아닌 칸 null', () => {
    const m = map([',,,|,', ',T,|,', ',o,,,'])
    const f = shoreField(m, 'high')
    expect(footprintAt(f, 1, 1)).toEqual({ tx: 4, ty: 3, w: 9, h: 8 })
    expect(footprintAt(f, 1, 2)).toEqual({ tx: 1, ty: 6, w: 14, h: 9 })
    expect(footprintAt(f, 3, 0)).toEqual({ tx: 5, ty: 0, w: 7, h: 16 })
    expect(footprintAt(f, 0, 0)).toBeNull()
  })

  it('deco 발밑은 prop 스프라이트 불투명 영역 안이고 높이 ≤ 8', () => {
    const m = map([',,,', ',x,', ',,,'], { props: [{ tx: 1, ty: 1, sprite: 'deco-lamp' }] })
    const r = footprintAt(shoreField(m, 'high'), 1, 1)!
    const b = opaqueBox('deco-lamp')
    expect(r.h).toBeLessThanOrEqual(8)
    expect(r.tx).toBeGreaterThanOrEqual(b.x0)
    expect(r.tx + r.w - 1).toBeLessThanOrEqual(b.x1)
    expect(r.ty + r.h - 1).toBe(b.y1)
  })

  it('모든 발밑 사각형은 그 스프라이트 불투명 바깥 사각형 안', () => {
    const kinds: [string, string][] = [['T', 'tile-tree'], ['P', 'tile-palm'], ['X', 'tile-deadtree'], ['A', 'tile-snowpine'], ['R', 'tile-reed'], ['o', 'tile-rock'], ['j', 'workbench']]
    for (const [ch, sprite] of kinds) {
      const m = map([',,,', `,${ch},`, ',,,'])
      const r = footprintAt(shoreField(m, 'high'), 1, 1)!
      const b = opaqueBox(sprite)
      expect([ch, r.tx >= b.x0 && r.tx + r.w - 1 <= b.x1 && r.ty >= b.y0 && r.ty + r.h - 1 <= b.y1]).toEqual([ch, true])
    }
  })
})
