// 큰 지도의 축소 그림. 칸마다 3×3px 무늬(타일 종류별 바탕·무늬 두 색)로 그려 맵 id별 PNG 주소로 캐시한다.
// 그림 안 색은 "낚시 캔버스 내부 색" 예외라 여기 색표에만 둔다. 브라우저 전용(document로 오프스크린 캔버스를 만든다).
import { spotTiles } from './atlas.ts'
import { tileAt, type MapDef, type TileKind } from './map.ts'

/** 칸당 px */
export const MINIMAP_PX = 3

type Look = { base: string; mark: string; glyph: readonly [string, string, string] }
const PLAIN = ['bbb', 'bbb', 'bbb'] as const
const look = (base: string, mark: string, glyph: readonly [string, string, string] = PLAIN): Look => ({ base, mark, glyph })
const TREE_GLYPH = ['bmb', 'mmm', 'bmb'] as const
const PLANK_GLYPH = ['bbb', 'mmm', 'bbb'] as const

/** 타일 종류별 [바탕, 무늬] 색과 3×3 무늬('b' 바탕 / 'm' 무늬). 물 종류는 무늬 없이 바탕색만 서로 다르다 */
export const MINIMAP_LOOK: Readonly<Record<TileKind, Look>> = {
  water: look('#2f7fb5', '#2f7fb5'),
  river: look('#4fa6d6', '#4fa6d6'),
  pond: look('#245f8c', '#245f8c'),
  basin: look('#3a8fc4', '#3a8fc4'),
  lake: look('#1f6f78', '#1f6f78'),
  'cave-pool': look('#1d3352', '#1d3352'),
  crystal: look('#5a6fd0', '#5a6fd0'),
  lava: look('#d8461f', '#d8461f'),
  lagoon: look('#3cc4b4', '#3cc4b4'),
  falls: look('#8fd0ea', '#e4f6fc', ['mbm', 'mbm', 'mbm']),
  sand: look('#f0dca8', '#f0dca8'),
  grass: look('#78b85c', '#78b85c'),
  path: look('#d6b27a', '#d6b27a'),
  flower: look('#78b85c', '#f28fae', ['bbb', 'bmb', 'bbb']),
  tree: look('#3f8a4f', '#1f3a2c', TREE_GLYPH),
  palm: look('#f0dca8', '#2a7a49', TREE_GLYPH),
  rock: look('#9eabb3', '#5d6872', ['bbb', 'bmb', 'bbb']),
  fence: look('#78b85c', '#a2703f', ['bbb', 'mmm', 'bbb']),
  pier: look('#c8925a', '#86562f', PLANK_GLYPH),
  dock: look('#b97d4c', '#7c4b2b', PLANK_GLYPH),
  bridge: look('#c8925a', '#86562f', ['mbm', 'mbm', 'mbm']),
  building: look('#9fcbd8', '#d9654b', ['mmm', 'bbb', 'bbb']),
  door: look('#9fcbd8', '#4a3a4a', ['bbb', 'bmb', 'bmb']),
  cliff: look('#8f8993', '#5a5560', ['bbb', 'bbb', 'mmm']),
  'cave-floor': look('#4a4553', '#4a4553'),
  'cave-wall': look('#25212c', '#25212c'),
  'cave-mouth': look('#8f8993', '#2a2433', ['bbb', 'bmb', 'bmb']),
}

/** 고른 낚시 자리 칸에 겹칠 밝은 색(반투명) */
const HIGHLIGHT = 'rgba(255, 244, 170, 0.75)'
const HIGHLIGHT_EDGE = '#2a2135'

/** 맵 칸을 MINIMAP_PX 무늬로 ctx에 그린다. 같은 색이 이어지는 바탕은 칸 단위로 한 번씩 칠한다 */
export function drawMinimap(ctx: CanvasRenderingContext2D, map: MapDef): void {
  const P = MINIMAP_PX
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const kind = tileAt(map, tx, ty)
      if (kind === null) continue
      const lk = MINIMAP_LOOK[kind]
      ctx.fillStyle = lk.base
      ctx.fillRect(tx * P, ty * P, P, P)
      if (lk.mark === lk.base) continue
      ctx.fillStyle = lk.mark
      for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) if (lk.glyph[y][x] === 'm') ctx.fillRect(tx * P + x, ty * P + y, 1, 1)
    }
  }
}

/** 오프스크린 캔버스에 그려 PNG 주소를 만들고 캔버스를 바로 놓아 준다(iOS 메모리). 2D 컨텍스트가 없으면 null */
function render(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): string | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx || typeof ctx.fillRect !== 'function') return null
    draw(ctx)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

const miniCache = new Map<string, string | null>()
const highlightCache = new Map<string, string | null>()

/** 맵 id별 PNG 주소. 처음 한 번만 그린다. 그리지 못하면 null(그 null도 해제 전까지 캐시) */
export function minimapUrl(map: MapDef): string | null {
  if (miniCache.has(map.id)) return miniCache.get(map.id)!
  const url = render(map.w * MINIMAP_PX, map.h * MINIMAP_PX, (ctx) => drawMinimap(ctx, map))
  miniCache.set(map.id, url)
  return url
}

/** 그 자리 설 자리·물 칸을 밝게 칠한 투명 PNG. (맵 id, 자리)별 캐시. 모르는 자리·실패면 null */
export function spotHighlightUrl(map: MapDef, spot: string): string | null {
  const key = `${map.id}|${spot}`
  if (highlightCache.has(key)) return highlightCache.get(key)!
  const { stands, waters } = spotTiles(map, spot)
  if (stands.length === 0) return null
  const P = MINIMAP_PX
  const url = render(map.w * P, map.h * P, (ctx) => {
    for (const c of waters) {
      ctx.fillStyle = HIGHLIGHT
      ctx.fillRect(c.tx * P, c.ty * P, P, P)
    }
    for (const c of stands) {
      ctx.fillStyle = HIGHLIGHT_EDGE
      ctx.fillRect(c.tx * P, c.ty * P, P, P)
      ctx.fillStyle = HIGHLIGHT
      ctx.fillRect(c.tx * P + 1, c.ty * P + 1, P - 2, P - 2)
    }
  })
  highlightCache.set(key, url)
  return url
}

/** 캐시를 비운다. 게임 화면을 떠날 때 장면 캐시와 함께 부른다 */
export function releaseMinimapCache(): void {
  miniCache.clear()
  highlightCache.clear()
}

/** 표시 배율(정수): max(1, floor(안쪽 폭 / (맵 칸 수 × MINIMAP_PX))) */
export function minimapScale(innerWidth: number, map: MapDef): number {
  return Math.max(1, Math.floor(innerWidth / (map.w * MINIMAP_PX)))
}
