import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MINIMAP_LOOK, MINIMAP_PX, drawMinimap, minimapScale, minimapUrl, releaseMinimapCache, spotHighlightUrl } from './minimap.ts'
import { TILE_CHARS, WATER_KINDS, defineMap } from './map.ts'
import { MAPS } from './maps/index.ts'

type Fill = { style: string; x: number; y: number; w: number; h: number }
function fakeCtx() {
  const fills: Fill[] = []
  const ctx = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ style: this.fillStyle, x, y, w, h })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills }
}

describe('MINIMAP_LOOK', () => {
  it('모든 타일 종류에 3×3 b/m 무늬; 물 종류는 무늬 없고 바탕색이 서로 다르다', () => {
    for (const kind of Object.values(TILE_CHARS)) {
      const lk = MINIMAP_LOOK[kind]
      expect(lk, kind).toBeDefined()
      expect(lk.glyph).toHaveLength(3)
      for (const line of lk.glyph) expect(line, kind).toMatch(/^[bm]{3}$/)
    }
    const waters = [...WATER_KINDS]
    for (const w of waters) expect(MINIMAP_LOOK[w].glyph.join(''), w).toBe('bbbbbbbbb')
    expect(new Set(waters.map((w) => MINIMAP_LOOK[w].base)).size).toBe(waters.length)
  })
})

describe('drawMinimap', () => {
  it('2×1 맵(~T): 칠하기가 모두 그림 안, 나무 칸에 무늬 색', () => {
    const m = defineMap('village', ['.~T'], {})
    const { ctx, fills } = fakeCtx()
    drawMinimap(ctx, m)
    for (const f of fills) {
      expect(f.x).toBeGreaterThanOrEqual(0)
      expect(f.x + f.w).toBeLessThanOrEqual(3 * MINIMAP_PX)
      expect(f.y + f.h).toBeLessThanOrEqual(MINIMAP_PX)
    }
    expect(fills.some((f) => f.style === MINIMAP_LOOK.tree.mark && f.x >= 2 * MINIMAP_PX)).toBe(true)
  })
})

describe('minimapUrl / spotHighlightUrl', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getContext: any
  beforeEach(() => {
    releaseMinimapCache()
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeCtx().ctx as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/png;base64,xx')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    releaseMinimapCache()
  })

  it('지역마다 한 번만 그리고, 해제하면 다시 그린다', () => {
    const v = MAPS.village!
    expect(minimapUrl(v)).toMatch(/^data:/)
    minimapUrl(v)
    expect(getContext).toHaveBeenCalledTimes(1)
    minimapUrl(MAPS.river!)
    expect(getContext).toHaveBeenCalledTimes(2)
    releaseMinimapCache()
    minimapUrl(v)
    expect(getContext).toHaveBeenCalledTimes(3)
  })

  it('2D 컨텍스트가 없으면 null, 예외 없음, null도 캐시', () => {
    getContext.mockImplementation(() => null)
    expect(minimapUrl(MAPS.village!)).toBeNull()
    expect(minimapUrl(MAPS.village!)).toBeNull()
    expect(getContext).toHaveBeenCalledTimes(1)
  })

  it('강조 그림은 (지역, 자리)마다 한 번; 모르는 자리는 null', () => {
    const v = MAPS.village!
    expect(spotHighlightUrl(v, 'pier')).toMatch(/^data:/)
    expect(spotHighlightUrl(v, 'shore')).toMatch(/^data:/)
    spotHighlightUrl(v, 'pier')
    spotHighlightUrl(v, 'shore')
    expect(getContext).toHaveBeenCalledTimes(2)
    expect(spotHighlightUrl(v, 'nope')).toBeNull()
  })
})

describe('minimapScale', () => {
  it('정수 배율', () => {
    const m = MAPS.village! // 48칸
    expect(minimapScale(300, m)).toBe(2)
    expect(minimapScale(100, m)).toBe(1)
    expect(minimapScale(600, m)).toBe(4)
  })
})
