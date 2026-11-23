import { describe, expect, it } from 'vitest'
import { BLOCK_MASS, BODY_DY, BODY_R, MM, SUBSTEPS, WHEEL_R } from './constants.ts'
import { blockBox, blockCands, blockSegs, blockWork, isBlockCand, pushCar, wakeBlock } from './blocks.ts'
import type { Block } from './blocks.ts'
import type { Body } from './collide.ts'
import { moverIdOf } from './movers.ts'
import { TURN } from './trig.ts'

const mm = (n: number): number => n * MM
const corners = (p: number[]): [number, number][] => [0, 1, 2, 3].map((i) => [p[4 * i], p[4 * i + 1]])
const body = (x: number, y: number, vx = 0, vy = 0): Body => ({ x, y, vx, vy })
const noHead = (): { x: number; y: number } => ({ x: 1e9, y: 1e9 })

describe('넘어지는 블록: 상태와 도형', () => {
  it('wakeBlock: 꼭짓점 4개(반시계, 0번 = 왼쪽 아래)를 정지 상태(px = x)로 놓는다. 너비는 x − floor(w/2) … x + (w − floor(w/2))', () => {
    const b: Block = { id: 3, x: 1000, y: 50, w: 401, h: 600, a: 0 }
    const s = wakeBlock(b)
    expect(s.id).toBe(3)
    expect(s.p).toHaveLength(16)
    expect(corners(s.p)).toEqual([[800, 50], [1201, 50], [1201, 650], [800, 650]])
    for (let i = 0; i < 4; i++) expect([s.p[4 * i + 2], s.p[4 * i + 3]]).toEqual([s.p[4 * i], s.p[4 * i + 1]])
  })

  it('wakeBlock: a만큼 (x, y) 둘레로 돈다(90° → 0번이 오른쪽 아래)', () => {
    const s = wakeBlock({ id: 0, x: 0, y: 0, w: 400, h: 600, a: TURN / 4 })
    expect(corners(s.p)).toEqual([[0, -200], [0, 200], [-600, 200], [-600, -200]])
  })

  it('blockBox는 꼭짓점을 덮는다', () => {
    const s = wakeBlock({ id: 0, x: 0, y: 0, w: 400, h: 600, a: 300 })
    const box = blockBox(s)
    for (const [x, y] of corners(s.p)) {
      expect(x).toBeGreaterThanOrEqual(box.x0)
      expect(x).toBeLessThanOrEqual(box.x1)
      expect(y).toBeGreaterThanOrEqual(box.y0)
      expect(y).toBeLessThanOrEqual(box.y1)
    }
    expect(box.x1 - box.x0).toBeGreaterThan(400)
  })

  it('blockSegs: 네 변을 왼쪽에서 오른쪽으로(x0 ≤ x1) 돌려준다. 정지면 prev = now, 움직이면 prev는 직전 이동 단계 자세', () => {
    const s = wakeBlock({ id: 0, x: 0, y: 0, w: 400, h: 600, a: 0 })
    const a = blockSegs(s)
    expect(a.now).toHaveLength(4)
    expect(a.prev).toEqual(a.now)
    for (const g of a.now) expect(g.x0).toBeLessThanOrEqual(g.x1)
    // 위 변(2 → 3)은 왼쪽 → 오른쪽으로 뒤집혀 있다(구동 접선이 앞을 향한다).
    expect(a.now).toContainEqual({ x0: -200, y0: 600, x1: 200, y1: 600, boost: false })
    // 틱 속도 (300, −90): 마지막 이동 단계에 (100, −30)만큼 움직였다.
    const moving = { id: 0, p: s.p.map((v, k) => (k % 4 === 2 ? v - 300 : k % 4 === 3 ? v + 90 : v)) }
    const b = blockSegs(moving)
    for (let e = 0; e < 4; e++) {
      expect(b.prev[e].x0).toBe(b.now[e].x0 - 300 / SUBSTEPS)
      expect(b.prev[e].y1).toBe(b.now[e].y1 + 90 / SUBSTEPS)
    }
  })

  it('블록 변 후보는 움직이는 길 번호와 겹치지 않는 음수 번호와 prev를 가진다', () => {
    const s = wakeBlock({ id: 7, x: 0, y: 0, w: 400, h: 600, a: 0 })
    const cs = blockCands([s.id], [blockSegs(s)])
    expect(cs).toHaveLength(4)
    for (const c of cs) {
      expect(c.i).toBeLessThan(0)
      expect(isBlockCand(c.i)).toBe(true)
      expect(c.prev).toBeDefined()
    }
    expect(new Set(cs.map((c) => c.i)).size).toBe(4)
    for (const i of [-1, -1 - 5 * 1000 - 3, -1 - 1000000 * 1000]) expect(isBlockCand(i), `mover ${moverIdOf(i)}`).toBe(false)
  })
})

describe('넘어지는 블록: 차와 서로 미는 비율 (BLOCK_MASS)', () => {
  const B: Block = { id: 0, x: 0, y: 0, w: mm(1000), h: mm(1000), a: 0 }
  const work = () => blockWork(wakeBlock(B), B, [])

  it('바퀴가 꼭짓점에 d만큼 파고들면 바퀴는 d·M/(1+M), 꼭짓점은 d/(1+M)만큼 반대로 밀린다', () => {
    const bw = work()
    const d = 300
    const left = -mm(500)
    const r = body(left - (WHEEL_R - d), 0) // 0번 꼭짓점(왼쪽 아래)의 바로 왼쪽
    const f = body(left - (WHEEL_R - d) - mm(1400), 0)
    pushCar(r, f, noHead, [bw])
    expect(r.x).toBe(left - (WHEEL_R - d) - Math.floor((d * BLOCK_MASS) / (1 + BLOCK_MASS)))
    expect(bw.c[0].x).toBe(left + Math.floor(d / (1 + BLOCK_MASS)))
    expect(bw.c[0].y).toBe(0)
    expect([bw.c[1].x, bw.c[2].x, bw.c[3].x]).toEqual([mm(500), mm(500), left]) // 다른 꼭짓점은 그대로
  })

  it('변 가운데에 닿으면 두 꼭짓점에 반씩 나누고, 바퀴와 접점이 겹침을 모두 푼다(운동량 보존)', () => {
    const bw = work()
    const d = 600
    const left = -mm(500)
    const r = body(left - (WHEEL_R - d), mm(500)) // 왼쪽 변(3 → 0) 가운데
    const f = body(left - (WHEEL_R - d) - mm(1400), mm(500))
    pushCar(r, f, noHead, [bw])
    const dw = left - (WHEEL_R - d) - r.x
    const d0 = bw.c[0].x - left
    const d3 = bw.c[3].x - left
    expect(d0).toBe(d3)
    expect(Math.abs(dw - BLOCK_MASS * (d0 + d3))).toBeLessThanOrEqual(2) // 바퀴 질량 1 × 이동 = 꼭짓점 질량 M × 이동의 합
    expect(Math.abs(dw + Math.floor((d0 + d3) / 2) - d)).toBeLessThanOrEqual(2) // 접점이 바퀴 밖으로
  })

  it('다가오던 바퀴는 법선 속도를 질량비대로 잃는다(블록은 위치 보정에서 속도를 얻는다)', () => {
    const bw = work()
    const left = -mm(500)
    const r = body(left - WHEEL_R + 300, 0, 900, 0)
    const f = body(left - WHEEL_R + 300 - mm(1400), 0, 900, 0)
    pushCar(r, f, noHead, [bw])
    expect(r.vx).toBe(900 - Math.floor((900 * BLOCK_MASS) / (1 + BLOCK_MASS)))
    expect(f.vx).toBe(900)
  })

  it('차대 캡슐 안에 들어온 꼭짓점은 캡슐 밖으로, 두 바퀴는 접점 위치 비율(가운데면 반씩)로 반대쪽으로', () => {
    // 45° 돌린 400 mm 정사각형: 맨 위 꼭짓점 하나만 위로 솟는다. 바퀴는 블록에서 멀리(±700 mm) 있다.
    const D: Block = { id: 0, x: 0, y: 0, w: mm(400), h: mm(400), a: TURN / 8 }
    const bw = blockWork(wakeBlock(D), D, [])
    const k = [0, 1, 2, 3].reduce((m, i) => (bw.c[i].y > bw.c[m].y ? i : m), 0)
    const { x: vx, y: vy } = { ...bw.c[k] }
    const y = vy + BODY_R - BODY_DY - 300 // 꼭짓점이 (윗방향으로 BODY_DY 올린) 캡슐 선분 아래 BODY_R − 300에 있다
    const r = body(vx - mm(700), y)
    const f = body(vx + mm(700), y)
    pushCar(r, f, noHead, [bw])
    expect(r.y - y).toBe(f.y - y)
    expect(r.y - y).toBe(Math.floor((300 * BLOCK_MASS) / (BLOCK_MASS + 2))) // 바퀴 둘(질량 2)이 함께 움직인다
    expect(bw.c[k].y).toBe(vy - Math.floor((300 * 2) / (BLOCK_MASS + 2)))
    expect(bw.c[k].x).toBe(vx)
  })
})
