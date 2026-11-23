import { describe, expect, it } from 'vitest'
import { RODS, SPECIES } from './data.ts'
import { TILE } from './map.ts'
import { VILLAGE } from './maps/village.ts'
import { SPRITES, drawSprite } from './sprites.ts'

const PLAYER_POSES = [
  'player-idle-down',
  'player-walk-down-0',
  'player-walk-down-1',
  'player-idle-up',
  'player-walk-up-0',
  'player-walk-up-1',
  'player-idle-side',
  'player-walk-side-0',
  'player-walk-side-1',
  'player-cast-up',
  'player-reel-up',
  'player-cast-side',
  'player-reel-side',
]
const TILES = ['tile-grass', 'tile-grass-alt', 'tile-path', 'tile-sand', 'tile-flower', 'tile-rock', 'tile-fence', 'tile-fence-v']

const DIGITS = [...'0123456789'].map((d) => `digit-${d}`)
const SEASON_ICONS = ['season-spring', 'season-summer', 'season-autumn', 'season-winter']

const REQUIRED = [
  'player-idle',
  'player-cast',
  'player-reel',
  'water-0',
  'water-1',
  'pier-plank',
  'pier-post',
  'bobber',
  ...SPECIES.map((s) => `fish-${s.id}`),
  ...RODS.map((r) => `rod-${r.tier}`),
  ...PLAYER_POSES,
  ...TILES,
  'tile-tree',
  'shop',
  ...DIGITS,
  'digit-colon',
  ...SEASON_ICONS,
]

const INLAND_FISH = [
  'pale-chub',
  'dark-chub',
  'skin-carp',
  'aucha-perch',
  'sweetfish',
  'catfish',
  'mandarin-fish',
  'eel',
  'golden-mandarin',
  'crucian',
  'carp',
  'bluegill',
  'loach',
  'snakehead',
  'stream-minnow',
  'lenok',
  'century-snakehead',
]

// 두 물고기 그림에서 색이 다른 칸 수. 글자가 아니라 실제 색으로 비교한다(팔레트 글자가 달라도 같은 색이면 같은 칸)
function colorDiff(a: string, b: string): number {
  const A = SPRITES[`fish-${a}`]
  const B = SPRITES[`fish-${b}`]
  let n = 0
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const ca = A.rows[y]?.[x] ?? '.'
      const cb = B.rows[y]?.[x] ?? '.'
      const colA = ca === '.' ? null : A.palette[ca]
      const colB = cb === '.' ? null : B.palette[cb]
      if (colA !== colB) n++
    }
  }
  return n
}

// 머리부터 꼬리까지 모든 열에 외곽선(k)이 아닌 몸통 칸이 있다(외곽선만 있는 잘록한 목이 없다)
function expectBodyUnbroken(id: string): void {
  const rows = SPRITES[`fish-${id}`].rows
  const painted = (x: number) => rows.some((r) => r[x] !== '.')
  const body = (x: number) => rows.some((r) => r[x] !== '.' && r[x] !== 'k')
  const cols = Array.from({ length: 16 }, (_, x) => x).filter(painted)
  for (let x = cols[0] + 1; x < cols[cols.length - 1]; x++) expect(body(x), `${id} col ${x}`).toBe(true)
}

// 산 호수·동굴·섬 물고기 23종(3단계)
const UNLOCK_FISH = [
  'rainbow-trout',
  'largemouth-bass',
  'smelt',
  'masu-salmon',
  'skygazer',
  'israeli-carp',
  'sturgeon',
  'silver-king-trout',
  'blind-fish',
  'cave-crayfish',
  'crystal-fry',
  'ember-carp',
  'bat-catfish',
  'lava-eel',
  'fire-dragonfish',
  'clownfish',
  'butterflyfish',
  'blue-damsel',
  'lionfish',
  'moray',
  'stingray',
  'mahi',
  'rainbow-marlin',
]

const REGION_TILES = ['river-0', 'river-1', 'pond-0', 'pond-1', 'basin-0', 'basin-1', 'falls-0', 'falls-1', 'bridge-plank', 'tile-cliff']

describe('SPRITES', () => {
  it('has every required key', () => {
    for (const key of REQUIRED) expect(SPRITES[key], key).toBeDefined()
  })

  it('every sprite matches its size and palette', () => {
    for (const [name, sp] of Object.entries(SPRITES)) {
      expect(sp.rows.length, `${name} rows`).toBe(sp.h)
      sp.rows.forEach((row, y) => {
        expect(row.length, `${name} row ${y} width`).toBe(sp.w)
        for (const ch of row) {
          if (ch !== '.') expect(sp.palette[ch], `${name} row ${y} char '${ch}'`).toBeDefined()
        }
      })
    }
  })

  it('fish fit in 16×16 and the player is 16×24', () => {
    for (const s of SPECIES) {
      const sp = SPRITES[`fish-${s.id}`]
      expect(sp.w, s.id).toBeLessThanOrEqual(16)
      expect(sp.h, s.id).toBeLessThanOrEqual(16)
    }
    for (const pose of ['player-idle', 'player-cast', 'player-reel']) {
      expect([SPRITES[pose].w, SPRITES[pose].h], pose).toEqual([16, 24])
    }
  })

  it('weather icons exist and are small', () => {
    for (const name of ['icon-sun', 'icon-rain', 'icon-snow']) {
      expect(SPRITES[name], name).toBeDefined()
      expect(SPRITES[name].w, name).toBeLessThanOrEqual(10)
      expect(SPRITES[name].h, name).toBeLessThanOrEqual(10)
    }
  })

  it('HUD 시계 글자: 숫자는 4×6이고 모두 다르며, 콜론은 1×6', () => {
    for (const d of DIGITS) expect([SPRITES[d].w, SPRITES[d].h], d).toEqual([4, 6])
    expect(new Set(DIGITS.map((d) => SPRITES[d].rows.join('\n'))).size).toBe(10)
    expect([SPRITES['digit-colon'].w, SPRITES['digit-colon'].h]).toEqual([1, 6])
  })

  it('계절 아이콘 4종은 7×7이고 서로 다르다', () => {
    for (const name of SEASON_ICONS) expect([SPRITES[name].w, SPRITES[name].h], name).toEqual([7, 7])
    expect(new Set(SEASON_ICONS.map((n) => SPRITES[n].rows.join('\n'))).size).toBe(4)
  })

  it('붕장어 몸통은 머리에서 꼬리까지 이어지고, 문어 두 눈은 좌우 대칭', () => {
    expectBodyUnbroken('conger')
    const eyes = SPRITES['fish-octopus'].rows.find((r) => r.includes('e'))!
    expect(eyes).toBe([...eyes].reverse().join(''))
  })

  it('all fish are drawn differently', () => {
    const drawings = SPECIES.map((s) => SPRITES[`fish-${s.id}`].rows.join('\n'))
    expect(new Set(drawings).size).toBe(SPECIES.length)
  })

  it('강·숲 17종 스프라이트가 모두 있고 16×16 안, 서로 다르고 기존 16종과도 다르다', () => {
    expect(new Set(INLAND_FISH).size).toBe(17)
    for (const id of INLAND_FISH) {
      const sp = SPRITES[`fish-${id}`]
      expect(sp, id).toBeDefined()
      expect(sp.w, id).toBeLessThanOrEqual(16)
      expect(sp.h, id).toBeLessThanOrEqual(16)
    }
    const inland = INLAND_FISH.map((id) => SPRITES[`fish-${id}`].rows.join('\n'))
    expect(new Set(inland).size).toBe(17)
    const village = SPECIES.filter((s) => !INLAND_FISH.includes(s.id)).map((s) => SPRITES[`fish-${s.id}`].rows.join('\n'))
    for (const art of inland) expect(village).not.toContain(art)
  })

  it('전설 2종(golden-mandarin, century-snakehead)은 금빛/거대함 등으로 일반종(mandarin-fish, snakehead)과 구별된다', () => {
    expect(colorDiff('golden-mandarin', 'mandarin-fish')).toBeGreaterThanOrEqual(30)
    expect(colorDiff('century-snakehead', 'snakehead')).toBeGreaterThanOrEqual(30)
  })

  it('village art has the sizes the tile map expects', () => {
    for (const pose of PLAYER_POSES) expect([SPRITES[pose].w, SPRITES[pose].h], pose).toEqual([16, 24])
    for (const tile of TILES) expect([SPRITES[tile].w, SPRITES[tile].h], tile).toEqual([16, 16])
    expect([SPRITES['tile-tree'].w, SPRITES['tile-tree'].h]).toEqual([16, 32])
    expect(SPRITES.shop.w % 16).toBe(0)
    expect(SPRITES.shop.h % 16).toBe(0)
    // 맵의 건물 사각형(B·D 칸)과 같은 크기라 좌상단에 한 번에 그리면 맞는다
    expect([SPRITES.shop.w, SPRITES.shop.h]).toEqual([VILLAGE.shop!.w * TILE, VILLAGE.shop!.h * TILE])
  })

  it('지역 타일(강·연못·웅덩이·폭포·다리·절벽)은 16×16이고 0/1 쌍은 서로 다르다', () => {
    for (const name of REGION_TILES) {
      expect(SPRITES[name], name).toBeDefined()
      expect([SPRITES[name].w, SPRITES[name].h], name).toEqual([16, 16])
    }
    for (const kind of ['river', 'pond', 'basin', 'falls']) {
      expect(SPRITES[`${kind}-0`].rows.join('\n'), kind).not.toBe(SPRITES[`${kind}-1`].rows.join('\n'))
    }
  })

  it('찌 5종은 16×16이고 서로 다르다', () => {
    const names = ['tackle-cork', 'tackle-trap', 'tackle-barbed', 'tackle-spinner', 'tackle-curious']
    for (const name of names) {
      expect(SPRITES[name], name).toBeDefined()
      expect([SPRITES[name].w, SPRITES[name].h], name).toEqual([16, 16])
    }
    expect(new Set(names.map((n) => SPRITES[n].rows.join('\n'))).size).toBe(5)
  })

  it('walk frames 0 and 1 differ in every direction', () => {
    for (const dir of ['down', 'up', 'side']) {
      const a = SPRITES[`player-walk-${dir}-0`].rows.join('\n')
      const b = SPRITES[`player-walk-${dir}-1`].rows.join('\n')
      expect(a, dir).not.toBe(b)
    }
  })
})

describe('drawSprite', () => {
  // 칠한 사각형을 기록하는 가짜 컨텍스트
  function recorder() {
    const rects: { x: number; y: number; w: number; h: number; color: string }[] = []
    const ctx = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push({ x, y, w, h, color: String(this.fillStyle) })
      },
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
  }

  // 사각형 목록을 픽셀 격자로 되돌린다(스프라이트 좌표, 칠하지 않은 칸은 null)
  function pixels(rects: { x: number; y: number; w: number; h: number; color: string }[], ox: number, oy: number, scale: number, w: number, h: number) {
    const grid: (string | null)[][] = Array.from({ length: h }, () => Array<string | null>(w).fill(null))
    for (const r of rects) {
      for (let px = r.x; px < r.x + r.w; px += scale) grid[(r.y - oy) / scale][(px - ox) / scale] = r.color
    }
    return grid
  }

  it('flipX mirrors the sprite inside the same box', () => {
    const name = 'player-walk-side-0'
    const sp = SPRITES[name]
    const plain = recorder()
    const flipped = recorder()
    drawSprite(plain.ctx, name, 10, 20, 2)
    drawSprite(flipped.ctx, name, 10, 20, 2, { flipX: true })
    const a = pixels(plain.rects, 10, 20, 2, sp.w, sp.h)
    const b = pixels(flipped.rects, 10, 20, 2, sp.w, sp.h)
    expect(b).toEqual(a.map((row) => [...row].reverse()))
    expect(b).not.toEqual(a)
  })
})

describe('3단계 문·배 스프라이트', () => {
  it('gate-broken-bridge·gate-rubble은 16×16, boat는 32×16이고 서로 다르다', () => {
    expect([SPRITES['gate-broken-bridge']?.w, SPRITES['gate-broken-bridge']?.h]).toEqual([16, 16])
    expect([SPRITES['gate-rubble']?.w, SPRITES['gate-rubble']?.h]).toEqual([16, 16])
    expect([SPRITES.boat?.w, SPRITES.boat?.h]).toEqual([32, 16])
    expect(SPRITES['gate-broken-bridge'].rows.join('\n')).not.toBe(SPRITES['gate-rubble'].rows.join('\n'))
  })
})

describe('산 호수·동굴·섬 타일 스프라이트', () => {
  const WATERS = ['lake', 'cave-pool', 'crystal', 'lava', 'lagoon']
  const GROUNDS = ['tile-cave-floor', 'tile-cave-wall', 'tile-cave-mouth', 'dock-plank']
  const art = (name: string) => JSON.stringify([SPRITES[name].rows, SPRITES[name].palette])

  it('물 다섯 종은 0/1 두 장이 16×16이고 두 장이 서로 다르다', () => {
    for (const kind of WATERS) {
      for (const f of [0, 1]) {
        const sp = SPRITES[`${kind}-${f}`]
        expect(sp, `${kind}-${f}`).toBeDefined()
        expect([sp.w, sp.h], `${kind}-${f}`).toEqual([16, 16])
        // 땅 타일처럼 칸을 꽉 채운다(투명 칸 없음)
        expect(sp.rows.join('').includes('.'), `${kind}-${f}`).toBe(false)
      }
      expect(SPRITES[`${kind}-0`].rows.join('\n'), kind).not.toBe(SPRITES[`${kind}-1`].rows.join('\n'))
    }
  })

  it('동굴 바닥·벽·입구, 선착장 판자는 16×16, 야자수는 나무처럼 16×32', () => {
    for (const name of GROUNDS) {
      expect(SPRITES[name], name).toBeDefined()
      expect([SPRITES[name].w, SPRITES[name].h], name).toEqual([16, 16])
    }
    expect([SPRITES['tile-palm']?.w, SPRITES['tile-palm']?.h]).toEqual([16, 32])
  })

  it('선착장 판자는 물이 비치지 않고(투명 칸 없음), 부두 판자와 다른 그림이며 fillRect 수가 부두 판자 이하', () => {
    const runs = (name: string) =>
      SPRITES[name].rows.reduce((n, row) => n + [...row].filter((ch, i) => ch !== '.' && ch !== row[i - 1]).length, 0)
    expect(SPRITES['dock-plank'].rows.join('').includes('.')).toBe(false)
    expect(art('dock-plank')).not.toBe(art('pier-plank'))
    expect(runs('dock-plank')).toBeLessThanOrEqual(runs('pier-plank'))
  })

  it('새 타일은 서로 다르고, 기존 물·땅 타일과도 다르다', () => {
    const fresh = [...WATERS.flatMap((k) => [`${k}-0`, `${k}-1`]), ...GROUNDS, 'tile-palm']
    expect(new Set(fresh.map(art)).size).toBe(fresh.length)
    const old = ['water-0', 'water-1', 'river-0', 'river-1', 'pond-0', 'pond-1', 'basin-0', 'basin-1', 'pier-plank', 'tile-cliff', 'tile-tree', 'tile-sand']
    for (const name of fresh) expect(old.map(art), name).not.toContain(art(name))
    // 물 다섯 종의 바탕색('a')은 서로, 그리고 기존 물과 달라 한눈에 구별된다
    const base = (name: string) => SPRITES[name].palette.a
    const bases = [...WATERS.map((k) => base(`${k}-0`)), ...['water-0', 'river-0', 'pond-0', 'basin-0'].map(base)]
    expect(new Set(bases).size).toBe(bases.length)
  })
})

describe('산 호수·동굴·섬 물고기 스프라이트', () => {
  const art = (id: string) => SPRITES[`fish-${id}`].rows.join('\n')

  it('23종이 모두 있고 16×16이다', () => {
    expect(new Set(UNLOCK_FISH).size).toBe(23)
    for (const id of UNLOCK_FISH) {
      const sp = SPRITES[`fish-${id}`]
      expect(sp, id).toBeDefined()
      expect([sp.w, sp.h], id).toEqual([16, 16])
    }
  })

  it('23종은 서로 다르고 기존 33종과도 다르다', () => {
    expect(new Set(UNLOCK_FISH.map(art)).size).toBe(23)
    const old = SPECIES.filter((s) => !UNLOCK_FISH.includes(s.id)).map((s) => art(s.id))
    expect(old.length).toBeGreaterThanOrEqual(33)
    for (const id of UNLOCK_FISH) expect(old, id).not.toContain(art(id))
  })

  it('전설 3종은 가장 비슷한 일반종과 30칸 이상 다르다', () => {
    expect(colorDiff('silver-king-trout', 'rainbow-trout')).toBeGreaterThanOrEqual(30)
    expect(colorDiff('fire-dragonfish', 'ember-carp')).toBeGreaterThanOrEqual(30)
    expect(colorDiff('rainbow-marlin', 'mahi')).toBeGreaterThanOrEqual(30)
  })

  it('길쭉한 곰치·용암장어·철갑상어는 몸이 한 덩어리로 이어진다', () => {
    for (const id of ['moray', 'lava-eel', 'sturgeon']) expectBodyUnbroken(id)
  })
})
