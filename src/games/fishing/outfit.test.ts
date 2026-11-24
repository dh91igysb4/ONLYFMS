import { describe, expect, test } from 'vitest'
import { SPRITES, type Sprite } from './sprites.ts'
import { ROD_TIP } from './scene.ts'
import { composePose, decodeOutfit, normalizeOutfit, outfitKey, playerSprites, POSE_FRAMES, POSES } from './outfit.ts'
import { BOTTOM_ART, HAIR_ART, HAIR_COLORS, HAT_ART, ROD_ART, TOP_ART } from './wearArt.ts'
import { DEFAULT_OUTFIT, WEAR, WEAR_SLOTS, type Outfit } from './wardrobe.ts'

const color = (sp: Sprite, x: number, y: number): string | null => {
  const ch = sp.rows[y]?.[x]
  return ch === undefined || ch === '.' ? null : sp.palette[ch]
}
const ART = { hat: HAT_ART, top: TOP_ART, bottom: BOTTOM_ART, hair: HAIR_ART, hairColor: HAIR_COLORS, rodSkin: ROD_ART } as const
const IDLE = { down: 'player-idle-down', up: 'player-idle-up', side: 'player-idle-side' } as const

describe('outfit compose', () => {
  test('every pose of the walk/fish animation is covered', () => {
    for (const name of Object.keys(SPRITES).filter((n) => n.startsWith('player-'))) expect(POSES, name).toContain(name)
  })

  test('default outfit is pixel-identical to the original sprites', () => {
    for (const name of POSES) {
      const a = SPRITES[name]
      const b = composePose(name, { ...DEFAULT_OUTFIT })
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) expect(color(b, x, y), `${name} ${x},${y}`).toBe(color(a, x, y))
    }
  })

  test('every item has art, and every art entry is a catalog item', () => {
    for (const w of WEAR) expect(Object.prototype.hasOwnProperty.call(ART[w.slot], w.id), `${w.slot}:${w.id}`).toBe(true)
    for (const slot of WEAR_SLOTS) for (const id of Object.keys(ART[slot])) expect(WEAR.some((w) => w.slot === slot && w.id === id), `${slot}:${id}`).toBe(true)
  })

  test('every item composes on every pose as 16×24, hats without beanie keep the rod tip', () => {
    for (const w of WEAR) {
      const o: Outfit = { ...DEFAULT_OUTFIT, [w.slot]: w.id }
      for (const name of POSES) {
        const sp = composePose(name, o)
        expect([sp.w, sp.h, sp.rows.length]).toEqual([16, 24, 24])
        for (const r of sp.rows) expect(r.length).toBe(16)
        const tip = ROD_TIP[name]
        if (tip) expect(color(sp, tip[0], tip[1]), `${w.slot}:${w.id} ${name}`).not.toBeNull()
      }
    }
  })

  test('overlay hats cover the top of the head (row 3, x5..10) in all three directions', () => {
    for (const [id, art] of Object.entries(HAT_ART)) {
      if (art.kind !== 'overlay') continue
      for (const name of Object.values(IDLE)) {
        const sp = composePose(name, { ...DEFAULT_OUTFIT, hat: id, hair: 'afro', hairColor: 'pink' })
        const pink = HAIR_COLORS.pink
        for (let x = 5; x <= 10; x++) {
          const c = color(sp, x, 3)
          expect(c, `${id} ${name} x${x}`).not.toBeNull()
          expect(pink, `${id} ${name} x${x}`).not.toContain(c)
        }
      }
    }
  })

  test('without a hat the hair colour shows on top of the head; with a hat the hair above the band is hidden', () => {
    const bare = composePose('player-idle-down', { ...DEFAULT_OUTFIT, hat: 'none', hairColor: 'green' })
    expect(color(bare, 7, 4)).toBe(HAIR_COLORS.green[0])
    const spiky = composePose('player-idle-down', { ...DEFAULT_OUTFIT, hat: 'none', hair: 'spiky' })
    expect(color(spiky, 4, 1)).not.toBeNull()
    const capped = composePose('player-idle-down', { ...DEFAULT_OUTFIT, hat: 'cap', hair: 'spiky' })
    expect(color(capped, 4, 1)).toBeNull()
  })

  test('head offsets: shifting the idle beanie band lands on each pose band', () => {
    for (const name of POSES) {
      const { dir, dx, dy } = POSE_FRAMES[name]
      if (name === 'player-cast-side') continue // 머리를 젖힌 그림이라 띠가 기울어 있다
      const band = (rows: readonly string[]) => rows.flatMap((r, y) => [...r].flatMap((ch, x) => (ch === 'c' ? [`${x},${y}`] : [])))
      const idle = new Set(band(SPRITES[IDLE[dir]].rows).map((k) => k.split(',').map(Number)).map(([x, y]) => `${x + dx},${y + dy}`))
      const here = band(SPRITES[name].rows)
      expect(here.length, name).toBeGreaterThanOrEqual(6)
      for (const k of here) expect(idle.has(k), `${name} ${k}`).toBe(true)
    }
  })

  test('rod skin recolours the rod tip; looks only', () => {
    for (const [name, tip] of Object.entries(ROD_TIP)) {
      if (!POSES.includes(name)) continue
      const sp = composePose(name, { ...DEFAULT_OUTFIT, rodSkin: 'blue' })
      expect(color(sp, tip[0], tip[1]), name).toBe(ROD_ART.blue!.r)
    }
  })

  test('kit tops change the shirt but not face, hair or legs', () => {
    const a = SPRITES['player-idle-down']
    const b = composePose('player-idle-down', { ...DEFAULT_OUTFIT, top: 'kit-stripes' })
    for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) if (x !== 14 && x !== 15) expect(color(b, x, y)).toBe(color(a, x, y))
    for (let y = 19; y < 24; y++) for (let x = 0; x < 16; x++) expect(color(b, x, y)).toBe(color(a, x, y))
    expect(color(b, 5, 14)).not.toBe(color(a, 5, 14))
  })

  test('shorts show bare legs above the shoes', () => {
    const sp = composePose('player-idle-down', { ...DEFAULT_OUTFIT, bottom: 'shorts' })
    expect(color(sp, 5, 21)).toBe(SPRITES['player-idle-down'].palette.s)
  })

  test('playerSprites caches per outfit key and returns the same object', () => {
    const o = { ...DEFAULT_OUTFIT, hat: 'straw' }
    const a = playerSprites(o)
    expect(playerSprites({ ...o })).toBe(a)
    expect(Object.keys(a).sort()).toEqual([...POSES].sort())
    expect(playerSprites({ ...o, hat: 'cap' })).not.toBe(a)
    expect(outfitKey(o)).toBe('straw|windbreaker|jeans|short|brown|bamboo')
  })

  test('normalizeOutfit / decodeOutfit fall back to defaults per slot', () => {
    expect(normalizeOutfit(null)).toEqual(DEFAULT_OUTFIT)
    expect(normalizeOutfit({ hat: 'cap', top: 'zzz', hairColor: 'crown', __proto__: { hat: 'x' } })).toEqual({ ...DEFAULT_OUTFIT, hat: 'cap' })
    expect(decodeOutfit('not json')).toEqual(DEFAULT_OUTFIT)
    expect(decodeOutfit(JSON.stringify({ ...DEFAULT_OUTFIT, rodSkin: 'gold' }))).toEqual({ ...DEFAULT_OUTFIT, rodSkin: 'gold' })
  })
})

describe('리뷰 반영 그림', () => {
  test('빨강·흰 깃 유니폼은 새빨간 유니폼과 맨 윗줄·가운데 선이 다르다', () => {
    const a = composePose('player-idle-down', { ...DEFAULT_OUTFIT, top: 'kit-red' })
    const b = composePose('player-idle-down', { ...DEFAULT_OUTFIT, top: 'kit-redwhite' })
    const diff = a.rows.flatMap((r, y) => [...r].flatMap((_, x) => (color(a, x, y) !== color(b, x, y) ? [1] : []))).length
    expect(diff).toBeGreaterThanOrEqual(12)
  })

  test('옆모습 소매는 앞뒤 가장자리가 아니라 팔 칸', () => {
    const sp = composePose('player-idle-side', { ...DEFAULT_OUTFIT, top: 'kit-claret' })
    const sky = TOP_ART['kit-claret']!.sleeve!
    // idle-side 팔: 13~17행 x5~8, 앞 가장자리(x11 지퍼 칸)는 소매색이 아니다
    expect(sky).toContain(color(sp, 5, 14))
    expect(sky).not.toContain(color(sp, 11, 14))
  })

  test('모자를 쓰면 뽀글·양갈래는 얼굴 옆 덧그림(hatted)을 쓰고 모자 높이(4~6행)로 부풀지 않는다', () => {
    for (const hair of ['afro', 'twin']) {
      const sp = composePose('player-idle-down', { ...DEFAULT_OUTFIT, hair, hairColor: 'pink' })
      // x14는 낚싯대라 뺀다
      for (let y = 4; y <= 6; y++) for (const x of [0, 1, 15]) expect(color(sp, x, y), `${hair} ${x},${y}`).toBeNull()
      expect(color(sp, 2, 8)).toBe(HAIR_COLORS.pink[0])
    }
  })
})
