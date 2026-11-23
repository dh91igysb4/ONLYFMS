// 캐릭터 옷 합성(설계 2026-11-24-fishing-wardrobe §4). 순수 모듈: DOM·Date.now·Math.random 없음.
// 지금 sprites.ts의 캐릭터 15장 위에 옷차림을 입혀 같은 Sprite 형식으로 돌려준다. 기본 옷차림은 원래 그림과 픽셀이 같다.
// 순서: 색 바꾸기 → 상의·하의 무늬 → (비니가 아니면) 비니 벗기기 → 머리 모양 덧그림 → 모자 덧그림 → 낚싯대 다시 칠하기.
// 화면은 playerSprites(옷차림)로 15장을 한 번에 받아 캐시한다(옷차림이 바뀔 때만 다시 합성).
import { SPRITES, type Sprite } from './sprites.ts'
import { BOTTOM_ART, HAIR_ART, HAIR_COLORS, HAT_ART, ROD_ART, TOP_ART, type Dir, type Layer, type Pattern } from './wearArt.ts'
import { DEFAULT_OUTFIT, WEAR_SLOTS, wearItem, type Outfit } from './wardrobe.ts'

/** 자세별 방향과 대기 그림 대비 머리 이동(px). 옆 걷기 0·위 던지기는 몸이 1px 내려가고, 옆 던지기는 머리를 젖혀 1px 앞이다 */
export const POSE_FRAMES: Readonly<Record<string, { dir: Dir; dx: number; dy: number }>> = {
  'player-idle': { dir: 'down', dx: 0, dy: 0 },
  'player-idle-down': { dir: 'down', dx: 0, dy: 0 },
  'player-walk-down-0': { dir: 'down', dx: 0, dy: 0 },
  'player-walk-down-1': { dir: 'down', dx: 0, dy: 0 },
  'player-cast': { dir: 'down', dx: 0, dy: 0 },
  'player-reel': { dir: 'down', dx: 0, dy: 0 },
  'player-idle-up': { dir: 'up', dx: 0, dy: 0 },
  'player-walk-up-0': { dir: 'up', dx: 0, dy: 0 },
  'player-walk-up-1': { dir: 'up', dx: 0, dy: 0 },
  'player-cast-up': { dir: 'up', dx: 0, dy: 1 },
  'player-reel-up': { dir: 'up', dx: 0, dy: 0 },
  'player-idle-side': { dir: 'side', dx: 0, dy: 0 },
  'player-walk-side-0': { dir: 'side', dx: 0, dy: 1 },
  'player-walk-side-1': { dir: 'side', dx: 0, dy: 0 },
  'player-cast-side': { dir: 'side', dx: 1, dy: 0 },
  'player-reel-side': { dir: 'side', dx: 0, dy: 0 },
}
export const POSES: readonly string[] = Object.keys(POSE_FRAMES)

/** 머리(비니) 맨 윗줄. 이 줄보다 위의 비니 외곽선·방울은 벗길 때 지운다 */
const HEAD_TOP = 3
/** 머리 모양 덧그림에서 이 줄 위쪽은 모자에 가려진다 */
const HAT_LINE = 7
const TOP_LETTERS = new Set(['j', 'J', 'z'])
const ROD_LETTERS = new Set(['r', 'R', 'g'])

function patternOn(p: Pattern, x: number, y: number): boolean {
  if (p === 'stripeH') return y % 2 === 0
  if (p === 'stripeV') return x % 2 === 0
  return (((x >> 1) + (y >> 1)) & 1) === 1
}

/** 잘못된 값은 부위마다 기본값. 품목 목록과 그림 자료가 둘 다 있는 id만 남긴다(소유는 보지 않는다 — 서버가 지킨다) */
export function normalizeOutfit(raw: unknown): Outfit {
  const o: Outfit = { ...DEFAULT_OUTFIT }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return o
  const r = raw as Record<string, unknown>
  const art: Record<keyof Outfit, Readonly<Record<string, unknown>>> = {
    hat: HAT_ART, top: TOP_ART, bottom: BOTTOM_ART, hair: HAIR_ART, hairColor: HAIR_COLORS, rodSkin: ROD_ART,
  }
  for (const slot of WEAR_SLOTS) {
    const id = Object.prototype.hasOwnProperty.call(r, slot) ? r[slot] : undefined
    if (typeof id === 'string' && wearItem(slot, id) && Object.prototype.hasOwnProperty.call(art[slot], id)) o[slot] = id
  }
  return o
}

/** 프로필 캐릭터 문자열(logic.avatar의 JSON) → 옷차림. 깨진 값은 기본 옷차림 */
export function decodeOutfit(data: string): Outfit {
  try {
    return normalizeOutfit(JSON.parse(data))
  } catch {
    return { ...DEFAULT_OUTFIT }
  }
}

export const outfitKey = (o: Outfit): string => WEAR_SLOTS.map((s) => o[s]).join('|')

/** 칸 값: '.' 투명, 글자(원래 팔레트 글자, 옷 색으로 풀린다), '#rrggbb' 정한 색 */
type Grid = string[][]

function stamp(g: Grid, layer: Layer, dx: number, dy: number, token: (ch: string) => string, skipAbove = -1): void {
  layer.rows.forEach((row, i) => {
    const y0 = layer.y + i
    if (y0 < skipAbove) return
    const y = y0 + dy
    if (y < 0 || y >= g.length) return
    for (let col = 0; col < row.length; col++) {
      const ch = row[col]
      const x = col + dx
      if (ch === '.' || x < 0 || x >= g[y].length) continue
      g[y][x] = token(ch)
    }
  })
}

/** 한 자세에 옷을 입힌 그림 */
export function composePose(name: string, outfit: Outfit): Sprite {
  const base = SPRITES[name]
  const frame = POSE_FRAMES[name]
  if (!base || !frame) throw new Error(`unknown pose: ${name}`)
  const { dir, dx, dy } = frame
  const orig = base.rows
  const g: Grid = orig.map((r) => [...r])
  const P: Record<string, string> = { ...base.palette }

  // 1. 색 바꾸기
  const hc = HAIR_COLORS[outfit.hairColor]
  if (hc) [P.a, P.A] = hc
  const rod = ROD_ART[outfit.rodSkin] ?? null
  if (rod) Object.assign(P, { r: rod.r, R: rod.R, g: rod.g })
  const bottom = BOTTOM_ART[outfit.bottom] ?? null
  if (bottom) {
    P.l = bottom.main
    P.L = bottom.shade
    if (bottom.shoes) P.b = bottom.shoes
  }
  const top = TOP_ART[outfit.top] ?? null
  if (top) {
    P.j = top.body
    P.J = top.shade
    P.z = top.zip ?? top.body
  }

  // 2. 무늬
  if (top) {
    const rows: number[] = []
    for (let y = 0; y < orig.length; y++) {
      const xs = [...orig[y]].flatMap((ch, x) => (TOP_LETTERS.has(ch) ? [x] : []))
      if (xs.length === 0) continue
      rows.push(y)
      if (top.pattern && top.alt) {
        for (const x of xs) if (orig[y][x] !== 'z' && patternOn(top.pattern, x - dx, y - dy)) g[y][x] = orig[y][x] === 'J' ? top.alt[1] : top.alt[0]
      }
      if (top.sleeve) {
        for (const x of [xs[0], xs[xs.length - 1]]) g[y][x] = orig[y][x] === 'J' ? top.sleeve[1] : top.sleeve[0]
      }
    }
    if (top.collar && rows.length > 0) {
      const y = rows[0]
      const xs = [...orig[y]].flatMap((ch, x) => (TOP_LETTERS.has(ch) ? [x] : []))
      const l = xs[0]
      const r = xs[xs.length - 1]
      for (const x of xs) if (x >= l + 2 && x <= r - 2) g[y][x] = top.collar
    }
    if (top.hem && rows.length > 0) {
      const y = rows[rows.length - 1]
      for (let x = 0; x < orig[y].length; x++) if (TOP_LETTERS.has(orig[y][x])) g[y][x] = top.hem
    }
  }
  if (bottom) {
    if (bottom.pattern && bottom.alt) {
      for (let y = 0; y < orig.length; y++) {
        for (let x = 0; x < orig[y].length; x++) {
          const ch = orig[y][x]
          if ((ch === 'l' || ch === 'L') && patternOn(bottom.pattern, x - dx, y - dy)) g[y][x] = ch === 'L' ? bottom.alt[1] : bottom.alt[0]
        }
      }
    }
    if (bottom.shorts) {
      for (let x = 0; x < 16; x++) {
        for (let y = orig.length - 1; y >= 0; y--) {
          const ch = orig[y][x]
          if (ch === 'l' || ch === 'L') {
            g[y][x] = ch === 'L' ? 'S' : 's'
            break
          }
        }
      }
    }
  }

  // 3. 모자: 비니 계열은 원래 그림(색만), 아니면 벗긴다
  const hat = HAT_ART[outfit.hat] ?? HAT_ART[DEFAULT_OUTFIT.hat]
  if (hat.kind === 'beanie') {
    if (hat.palette) Object.assign(P, hat.palette)
  } else {
    const fresh: [number, number][] = []
    for (let y = 0; y < g.length; y++) {
      for (let x = 0; x < g[y].length; x++) {
        const ch = orig[y][x]
        if (ch === 'h' || ch === 'H' || ch === 'c') {
          g[y][x] = 'a'
          fresh.push([x, y])
        } else if (ch === 'p' || (ch === 'k' && y < HEAD_TOP + dy)) g[y][x] = '.'
      }
    }
    for (const [x, y] of fresh) if (y > 0 && g[y - 1][x] === '.') g[y - 1][x] = 'k'
  }

  // 4. 머리 모양
  const hair = HAIR_ART[outfit.hair] ?? null
  if (hair) {
    const layer = hair[dir] ?? hair.down
    stamp(g, layer, dx, dy, (ch) => ch, hat.kind === 'none' ? -1 : hair.under ?? HAT_LINE)
  }
  // 비니는 머리 위에 다시 얹는다(비니 칸과 그 둘레 외곽선). 옆으로 부푸는 머리가 비니를 덮지 않게
  if (hat.kind === 'beanie' && hair) {
    const isBeanie = (x: number, y: number) => y >= 0 && y < orig.length && x >= 0 && x < 16 && 'hHpc'.includes(orig[y][x])
    for (let y = 0; y < HAT_LINE + dy; y++) {
      for (let x = 0; x < 16; x++) {
        const ch = orig[y][x]
        if ('hHpc'.includes(ch)) g[y][x] = ch
        else if (ch === 'k' && (isBeanie(x - 1, y) || isBeanie(x + 1, y) || isBeanie(x, y - 1) || isBeanie(x, y + 1))) g[y][x] = 'k'
      }
    }
  }

  // 5. 모자 덧그림
  if (hat.kind === 'overlay') {
    const layer = hat.layers[dir] ?? hat.layers.down
    stamp(g, layer, dx, dy, (ch) => (ch === 'k' ? 'k' : hat.palette[ch] ?? 'k'))
  }

  // 6. 낚싯대는 늘 맨 위(줄 끝 ROD_TIP 칸이 가려지지 않게)
  for (let y = 0; y < orig.length; y++) {
    for (let x = 0; x < orig[y].length; x++) {
      const ch = orig[y][x]
      if (!ROD_LETTERS.has(ch)) continue
      g[y][x] = ch === 'r' && rod?.rainbow ? rod.rainbow[(((y - dy) % rod.rainbow.length) + rod.rainbow.length) % rod.rainbow.length] : ch
    }
  }

  return toSprite(g, P)
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function toSprite(g: Grid, P: Record<string, string>): Sprite {
  const byColor = new Map<string, string>()
  const palette: Record<string, string> = {}
  const rows = g.map((row) =>
    row.map((t) => {
      if (t === '.') return '.'
      const color = t.startsWith('#') ? t : P[t]
      if (color === undefined) throw new Error(`no color for ${t}`)
      let ch = byColor.get(color)
      if (ch === undefined) {
        ch = LETTERS[byColor.size]
        if (ch === undefined) throw new Error('too many colors')
        byColor.set(color, ch)
        palette[ch] = color
      }
      return ch
    }).join(''),
  )
  return { w: rows[0].length, h: rows.length, rows, palette }
}

const CACHE_MAX = 8
const cache = new Map<string, Readonly<Record<string, Sprite>>>()

/** 옷차림 하나의 15장(자세 이름 → Sprite). 키마다 한 번만 합성하고 최근 CACHE_MAX개를 둔다 */
export function playerSprites(outfit: Outfit): Readonly<Record<string, Sprite>> {
  const key = outfitKey(outfit)
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const set: Record<string, Sprite> = {}
  for (const name of POSES) set[name] = composePose(name, outfit)
  cache.set(key, set)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  return set
}
