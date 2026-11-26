import { describe, expect, it } from 'vitest'
import type { AreaId } from './data.ts'
import { ALL_AREAS_OPEN, TILE, defineMap, isWalkable, pierEnd, type Opened } from './map.ts'
import { VILLAGE } from './maps/village.ts'
import { MAX_DT_MS } from './minigame.ts'
import { FEET, WALK_SPEED, cameraFor, feetBlocked, joystickVector, keysVector, pointBlocked, stepWalk, type Player } from './walk.ts'
import { shoreField, wetness } from './shore.ts'

const MAP_W = VILLAGE.w
const MAP_H = VILLAGE.h
const SPAWN = VILLAGE.spawn
const PIER_END = pierEnd(VILLAGE)!

function player(pos: { x: number; y: number }): Player {
  return { pos: { ...pos }, facing: 'down', moving: false, walkMs: 0 }
}

/** 발 사각형 9점(꼭짓점·변 가운데·중심) 가운데 막힌 점이 있는가(새 판정: 그린 물가선·물체 발밑) */
function feetOverlapsBlocked(pos: { x: number; y: number }): boolean {
  const e = 1e-6
  for (const y of [pos.y - FEET.h / 2 + e, pos.y, pos.y + FEET.h / 2 - e]) {
    for (const x of [pos.x - FEET.w / 2 + e, pos.x, pos.x + FEET.w / 2 - e]) if (pointBlocked(VILLAGE, x, y, ALL_AREAS_OPEN)) return true
  }
  return false
}

function center(tx: number, ty: number) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
}

function findTile(pred: (tx: number, ty: number) => boolean) {
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) if (pred(tx, ty)) return { tx, ty }
  return null
}

describe('입력 벡터', () => {
  it('keysVector 대각선은 길이 1로 정규화된다', () => {
    const v = keysVector({ up: true, down: false, left: false, right: true })
    expect(v.x).toBeCloseTo(0.7071, 4)
    expect(v.y).toBeCloseTo(-0.7071, 4)
  })
  it('keysVector 반대 키는 상쇄되고 단일 키는 길이 1', () => {
    expect(keysVector({ up: true, down: true, left: false, right: false })).toEqual({ x: 0, y: 0 })
    expect(keysVector({ up: false, down: false, left: true, right: false })).toEqual({ x: -1, y: 0 })
  })
  it('joystickVector: 원 밖은 길이 1, 데드존, 비례', () => {
    expect(joystickVector(0, 100, 50)).toEqual({ x: 0, y: 1 })
    expect(joystickVector(3, 0, 50)).toEqual({ x: 0, y: 0 })
    expect(joystickVector(25, 0, 50)).toEqual({ x: 0.5, y: 0 })
  })
})

describe('stepWalk', () => {
  const open = findTile((tx, ty) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!isWalkable(VILLAGE, tx + dx, ty + dy, ALL_AREAS_OPEN)) return false
    return true
  })

  it('넓은 걷기 영역이 존재한다', () => {
    expect(open).not.toBeNull()
  })

  it('대각선 입력 1초 이동 거리는 WALK_SPEED', () => {
    let p = player(center(open!.tx, open!.ty))
    const start = { ...p.pos }
    const s = Math.SQRT1_2
    for (let i = 0; i < 20; i++) p = stepWalk(VILLAGE, p, { x: s, y: s }, 50, ALL_AREAS_OPEN)
    expect(Math.hypot(p.pos.x - start.x, p.pos.y - start.y)).toBeGreaterThan(WALK_SPEED - 0.5)
    expect(Math.hypot(p.pos.x - start.x, p.pos.y - start.y)).toBeLessThan(WALK_SPEED + 0.5)
  })

  it('신발 배율: speed 1.75면 같은 입력·시간의 이동 거리가 1.75배', () => {
    const start = player(center(open!.tx, open!.ty))
    const a = stepWalk(VILLAGE, start, { x: 1, y: 0 }, 40, ALL_AREAS_OPEN)
    const b = stepWalk(VILLAGE, start, { x: 1, y: 0 }, 40, ALL_AREAS_OPEN, undefined, 1.75)
    expect(b.pos.x - start.pos.x).toBeCloseTo((a.pos.x - start.pos.x) * 1.75, 6)
  })
  it('물을 향해 아래로 걸으면 발이 물과 겹치기 전에 멈춘다', () => {
    const shore = findTile((tx, ty) => isWalkable(VILLAGE, tx, ty, ALL_AREAS_OPEN) && !isWalkable(VILLAGE, tx, ty + 1, ALL_AREAS_OPEN) && ty + 1 < MAP_H)
    expect(shore).not.toBeNull()
    let p = player(center(shore!.tx, shore!.ty))
    for (let i = 0; i < 40; i++) p = stepWalk(VILLAGE, p, { x: 0, y: 1 }, 50, ALL_AREAS_OPEN)
    expect(feetOverlapsBlocked(p.pos)).toBe(false)
    // 그린 물가선에 닿기 직전에 멈춘다: 한 걸음 더 가면 막힌다
    expect(feetBlocked(VILLAGE, p.pos.x, p.pos.y + (WALK_SPEED * 50) / 1000, ALL_AREAS_OPEN)).toBe(true)
  })

  it('물 쪽 대각선 입력이면 x는 계속 움직인다 (벽 따라 미끄러짐)', () => {
    const shore = findTile((tx, ty) =>
      [0, 1, 2, 3].every((d) => isWalkable(VILLAGE, tx + d, ty, ALL_AREAS_OPEN) && !isWalkable(VILLAGE, tx + d, ty + 1, ALL_AREAS_OPEN)),
    )
    expect(shore).not.toBeNull()
    let p = player(center(shore!.tx, shore!.ty))
    const x0 = p.pos.x
    for (let i = 0; i < 20; i++) p = stepWalk(VILLAGE, p, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 50, ALL_AREAS_OPEN)
    expect(p.pos.x - x0).toBeGreaterThan(30)
    expect(feetOverlapsBlocked(p.pos)).toBe(false)
  })

  it('60초 무작위 입력에도 발이 막힌 타일과 겹치지 않고 맵 안에 있다', () => {
    let seed = 12345
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    for (const start of [SPAWN.pos, center(PIER_END.tx, PIER_END.ty)]) {
      let p = player(start)
      let input = { x: 0, y: 0 }
      for (let i = 0; i < 1200; i++) {
        if (i % 10 === 0) {
          const a = rnd() * Math.PI * 2
          const m = rnd() < 0.1 ? 0 : 1
          input = { x: Math.cos(a) * m, y: Math.sin(a) * m }
        }
        p = stepWalk(VILLAGE, p, input, 50, ALL_AREAS_OPEN)
        expect(feetOverlapsBlocked(p.pos)).toBe(false)
        expect(p.pos.x).toBeGreaterThan(0)
        expect(p.pos.y).toBeGreaterThan(0)
        expect(p.pos.x).toBeLessThan(MAP_W * TILE)
        expect(p.pos.y).toBeLessThan(MAP_H * TILE)
      }
    }
  })

  it('큰 dt는 MAX_DT_MS로 잘린다', () => {
    const p = player(center(open!.tx, open!.ty))
    const a = stepWalk(VILLAGE, p, { x: 1, y: 0 }, 5000, ALL_AREAS_OPEN)
    const b = stepWalk(VILLAGE, p, { x: 1, y: 0 }, MAX_DT_MS, ALL_AREAS_OPEN)
    expect(a).toEqual(b)
    expect(stepWalk(VILLAGE, p, { x: 1, y: 0 }, -10, ALL_AREAS_OPEN).pos).toEqual(p.pos)
  })

  it('입력 0이면 facing 유지, moving false, walkMs 0', () => {
    const p: Player = { pos: center(open!.tx, open!.ty), facing: 'left', moving: true, walkMs: 200 }
    const q = stepWalk(VILLAGE, p, { x: 0, y: 0 }, 16, ALL_AREAS_OPEN)
    expect(q.facing).toBe('left')
    expect(q.moving).toBe(false)
    expect(q.walkMs).toBe(0)
    expect(q.pos).toEqual(p.pos)
  })

  it('입력이 있으면 facing·moving·walkMs 갱신 (막혀도 방향은 바뀐다)', () => {
    let p = player(center(open!.tx, open!.ty))
    p = stepWalk(VILLAGE, p, { x: -1, y: 0.5 }, 20, ALL_AREAS_OPEN)
    expect(p.facing).toBe('left')
    expect(p.moving).toBe(true)
    expect(p.walkMs).toBe(20)
    p = stepWalk(VILLAGE, p, { x: 0.2, y: -0.9 }, 30, ALL_AREAS_OPEN)
    expect(p.facing).toBe('up')
    expect(p.walkMs).toBe(50)
    p = stepWalk(VILLAGE, p, { x: 0.5, y: 0.5 }, 10, ALL_AREAS_OPEN)
    expect(p.facing).toBe('right')
  })
})

describe('cameraFor', () => {
  const mapW = MAP_W * TILE
  const mapH = MAP_H * TILE
  it('맵 모서리에서 clamp', () => {
    expect(cameraFor(VILLAGE, { x: 0, y: 0 }, { w: 195, h: 280 })).toEqual({ x: 0, y: 0 })
    expect(cameraFor(VILLAGE, { x: mapW, y: mapH }, { w: 195, h: 280 })).toEqual({ x: mapW - 195, y: mapH - 280 })
  })
  it('화면이 맵보다 넓으면 가운데 정렬(음수 오프셋)', () => {
    const c = cameraFor(VILLAGE, { x: 100, y: 100 }, { w: 2000, h: 280 })
    expect(c.x).toBe(-Math.floor((2000 - mapW) / 2))
  })
  it('중앙은 round(target - view/2)', () => {
    expect(cameraFor(VILLAGE, { x: 300.4, y: 200 }, { w: 195, h: 280 })).toEqual({ x: Math.round(300.4 - 97.5), y: 60 })
  })
})

describe('잠긴 문과 열린 지역', () => {
  // (4,2) 다리가 호수 문. (4,3)에서 위로 걸으면 문 앞에서 멈춘다
  const MAP = defineMap('river', ['TTTTTTTTTT', 'T,,,,,,,,T', 'TrrrHrrrrT', 'T,,,,,,,,T', 'TTTTTTTTTT'], {
    gates: [{ area: 'lake', tiles: { tx: 4, ty: 2, w: 1, h: 1 }, look: 'broken-bridge', front: { tx: 4, ty: 3, facing: 'up' } }],
  })
  const BASE: Opened = new Set<AreaId>(['village', 'river', 'forest'])
  const OPEN: Opened = new Set<AreaId>([...BASE, 'lake'])

  it('feetBlocked: 문 칸은 잠기면 막히고, 열리면 원래 칸(다리) 규칙대로', () => {
    const c = center(4, 2)
    expect(feetBlocked(MAP, c.x, c.y, BASE)).toBe(true)
    expect(feetBlocked(MAP, c.x, c.y, OPEN)).toBe(false)
    const side = center(3, 2) // 강물은 열려도 막힘
    expect(feetBlocked(MAP, side.x, side.y, OPEN)).toBe(true)
  })

  it('stepWalk: 잠긴 문을 향해 걸으면 문 앞에서 멈추고, 열린 집합으로는 지나간다', () => {
    const walkUp = (opened: Opened) => {
      let p = player(center(4, 3))
      for (let i = 0; i < 60; i++) p = stepWalk(MAP, p, { x: 0, y: -1 }, 16, opened)
      return p
    }
    const locked = walkUp(BASE)
    // 발 사각형 윗변이 문 칸 아래 경계 바로 밑에서 멈춘다(한 걸음 = 72px/s × 16ms)
    expect(locked.pos.y).toBeGreaterThanOrEqual(3 * TILE + FEET.h / 2)
    expect(locked.pos.y).toBeLessThan(3 * TILE + FEET.h / 2 + (WALK_SPEED * 16) / 1000)
    expect(locked.facing).toBe('up')
    const open = walkUp(OPEN)
    expect(open.pos.y).toBeLessThan(2 * TILE) // 다리를 건너 북쪽 풀밭
  })
})

describe('벽 모서리', () => {
  const m = defineMap('cave', ['YYYYY', 'YFFFY', 'YFFFY', 'YYYYY'], { walls: { v: [[2, 1, 2]] } })
  it('feetBlocked: 벽 모서리를 걸친 발 사각형은 막힌다, 같은 칸 안은 열림', () => {
    expect(feetBlocked(m, 2 * TILE, 1.5 * TILE, ALL_AREAS_OPEN)).toBe(true)
    expect(feetBlocked(m, 1.5 * TILE, 1.5 * TILE, ALL_AREAS_OPEN)).toBe(false)
    expect(feetBlocked(m, 2.5 * TILE, 1.5 * TILE, ALL_AREAS_OPEN)).toBe(false)
  })
  it('stepWalk: 대각선으로 벽을 비벼도 x가 모서리를 넘지 못한다', () => {
    let p: Player = { pos: { x: 1.5 * TILE, y: 1.2 * TILE }, facing: 'right', moving: false, walkMs: 0 }
    for (let i = 0; i < 60; i++) p = stepWalk(m, p, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 16, ALL_AREAS_OPEN)
    expect(p.pos.x + FEET.w / 2).toBeLessThanOrEqual(2 * TILE)
  })
  it('가장 빠른 신발(×1.75)로 한 프레임(MAX_DT_MS) 걸어도 얇은 가로 벽을 건너뛰지 않는다(발 높이 6px < 한 프레임 6.3px)', () => {
    const g = defineMap('cave', ['YYYYY', 'YFFFY', 'YFFFY', 'YYYYY'], { walls: { h: [[2, 1, 3]] } })
    // 발 아래쪽이 벽 모서리 0.1px 위
    let p: Player = { pos: { x: 2.5 * TILE, y: 2 * TILE - FEET.h / 2 - 0.1 }, facing: 'down', moving: false, walkMs: 0 }
    for (let i = 0; i < 5; i++) p = stepWalk(g, p, { x: 0, y: 1 }, MAX_DT_MS, ALL_AREAS_OPEN, undefined, 1.75)
    expect(p.pos.y + FEET.h / 2).toBeLessThanOrEqual(2 * TILE)
  })
})

describe('부드러운 물가·물체 발밑', () => {
  const m = (rows: string[], opts: Parameters<typeof defineMap>[2] = {}) => defineMap('village', rows, { spots: { water: 'shore', marsh: 'shore' } as never, ...opts })

  it('볼록한 물 모서리: 물 칸 안이지만 땅으로 그려진 곳에 설 수 있다', () => {
    const map = m([',,,,,', ',,,,,', ',,~~~', ',,~~~', ',,~~~'])
    expect(wetness(shoreField(map, 'high'), 2 * TILE + 1, 2 * TILE + 1)).toBeLessThan(0.5)
    // 발 중심이 물 칸(2,2) 안에 들어간 채 설 수 있는 자리가 있다
    let found = false
    for (let y = 2 * TILE; y < 3 * TILE && !found; y += 0.5) for (let x = 2 * TILE; x < 3 * TILE && !found; x += 0.5) {
      if (!feetBlocked(map, x, y, ALL_AREAS_OPEN)) found = true
    }
    expect(found).toBe(true)
  })

  it('오목한 물가: 땅 칸 안이지만 물로 그려진 곳은 막힌다', () => {
    const map = m(['~~~~~', '~~~~~', '~~,,,', '~~,,,', '~~,,,'])
    const p = { x: 2 * TILE + 1, y: 2 * TILE + 1 }
    expect(wetness(shoreField(map, 'high'), p.x, p.y)).toBeGreaterThanOrEqual(0.5)
    expect(feetBlocked(map, p.x, p.y, ALL_AREAS_OPEN)).toBe(true)
  })

  it('나무 칸 아래쪽(y11–15)에 설 수 있고 줄기에는 못 선다', () => {
    const map = m([',,,', ',T,', ',,,'])
    expect(feetBlocked(map, TILE + 8, TILE + 14.5, ALL_AREAS_OPEN)).toBe(false)
    expect(feetBlocked(map, TILE + 8, TILE + 7, ALL_AREAS_OPEN)).toBe(true)
  })

  it('부두: 모래에서 부두로, 부두에서 모래로 걸어서 오간다', () => {
    const map = m(['.....', '.....', '~~#~~', '~~#~~', '~~#~~', '~~~~~'])
    let p = player({ x: 2 * TILE + 8, y: TILE + 8 })
    for (let i = 0; i < 120; i++) p = stepWalk(map, p, { x: 0, y: 1 }, 16, ALL_AREAS_OPEN)
    expect(Math.floor(p.pos.y / TILE)).toBe(4)
    for (let i = 0; i < 120; i++) p = stepWalk(map, p, { x: 0, y: -1 }, 16, ALL_AREAS_OPEN)
    expect(Math.floor(p.pos.y / TILE)).toBe(0)
  })

  it('늪 갈대 칸: 발밑 바깥이라도 물로 그려진 곳은 막힌다', () => {
    const map = m(['zzz,', 'zRz,', 'zzz,'])
    expect(feetBlocked(map, TILE + 8, TILE + 14, ALL_AREAS_OPEN)).toBe(true)
  })

  it('잠긴 문 칸은 물 정도와 상관없이 막힌다', () => {
    const map = m([',,,,', ',,,,', ',,,,'], {
      gates: [{ area: 'river' as AreaId, tiles: { tx: 2, ty: 1, w: 1, h: 1 }, look: 'rubble', front: { tx: 1, ty: 1, facing: 'right' } }],
    })
    expect(feetBlocked(map, 2 * TILE + 8, TILE + 8, new Set() as Opened)).toBe(true)
    expect(feetBlocked(map, 2 * TILE + 8, TILE + 8, ALL_AREAS_OPEN)).toBe(false)
  })

  it('pointBlocked: 매끄러운 칸 점은 wetness ≥ 0.5와 같다', () => {
    const map = m(['~~~~~~', '~~,,~~', '~,,,,~', '~~,,~~', '~~~~~~'])
    const f = shoreField(map, 'high')
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < 500; n++) {
      const x = rnd() * map.w * TILE
      const y = rnd() * map.h * TILE
      expect(pointBlocked(map, x, y, ALL_AREAS_OPEN)).toBe(wetness(f, x, y) >= 0.5)
    }
  })
})

describe('검토 수정: 물체 사이·울타리 모서리', () => {
  const m = (rows: string[]) => defineMap('village', rows, { spots: { water: 'shore' } })
  it('위아래로 붙은 나무 줄은 옆으로 빠져나갈 수 없다', () => {
    const map = m([',T,', ',T,', ',T,'])
    let p = player({ x: 8, y: TILE + 14 })
    for (let i = 0; i < 60; i++) p = stepWalk(map, p, { x: 1, y: 0 }, 16, ALL_AREAS_OPEN)
    expect(p.pos.x).toBeLessThan(TILE)
  })
  it('나무 줄 맨 아래 나무 밑(y11–15)에는 여전히 설 수 있다', () => {
    const map = m([',T,', ',T,', ',,,'])
    expect(feetBlocked(map, TILE + 8, TILE + 14.5, ALL_AREAS_OPEN)).toBe(false)
  })
  it('울타리 모서리 칸은 위 울타리 쪽 기둥 자리도 막는다', () => {
    const map = m([',|,,', ',||,', ',,,,'])
    expect(feetBlocked(map, TILE + 8, TILE + 4, ALL_AREAS_OPEN)).toBe(true)
  })
  it('발이 발밑 사각형에 딱 닿기만 해도 막힌다', () => {
    const map = m([',,,', ',o,', ',,,'])
    expect(feetBlocked(map, TILE + 8, TILE + 3, ALL_AREAS_OPEN)).toBe(true)
  })
  it('절벽 옆 물은 물가 띠 없이 물이다', () => {
    const map = m(['ccc', '~~~', ',,,'])
    expect(wetness(shoreField(map, 'high'), TILE + 8, TILE + 0.5)).toBeGreaterThanOrEqual(0.5)
  })
})
