import { describe, expect, it } from 'vitest'
import { BLOCK_H, GATE_H, PILLAR_H, R, X_LIMIT } from '../constants.ts'
import { courseFromSegments } from '../course.ts'
import { JOINT, parseSegment } from '../segments.ts'
import { CAM_BACK, CAM_UP, bankOffset, buildingsFor, cameraTarget, segmentBoxes } from './layout.ts'
import { floorAt } from '../sim.ts'

const SEED = '0123456789abcdef0123456789abcdef'

// 첫 조각: 이음 행만 6행(행마다 바닥 5칸). 둘째: 블록·오르막.
const STRAIGHT = parseSegment({ id: 'straight', kind: 'obstacle', tier: 1, rows: new Array<string>(6).fill(JOINT) })
const MIXED = parseSegment({ id: 'mixed', kind: 'obstacle', tier: 1, rows: [JOINT, '___B___', '/______', 'B______', JOINT] })
const course = courseFromSegments([
  { seg: STRAIGHT, mirrored: false },
  { seg: MIXED, mirrored: false },
])

describe('segmentBoxes', () => {
  it('floor boxes match cells', () => {
    const info = course.segmentAt(0)
    const floors = segmentBoxes(course, info).filter((b) => b.kind === 'floor')
    expect(floors).toHaveLength(info.length * 5)
    for (let row = info.startRow; row < info.startRow + info.length; row++) {
      for (let col = -2; col <= 2; col++) {
        const b = floors.find((f) => f.cx === col * 1000 && f.cz === row * 1000 + 500)
        expect(b).toBeDefined()
        expect(b!.w).toBe(1000)
        expect(b!.d).toBe(1000)
        expect(b!.slope).toBe(0)
      }
    }
  })

  it('block box sits on floor', () => {
    const info = course.segmentAt(6)
    const boxes = segmentBoxes(course, info)
    const blocks = boxes.filter((b) => b.kind === 'block')
    expect(blocks).toHaveLength(2)
    const b = blocks.find((k) => k.cx === 0 && k.cz === 7 * 1000 + 500)!
    expect(b).toBeDefined()
    const floor = course.cell(0, 7).floor!.h0
    expect(b.cy).toBe(floor + BLOCK_H / 2)
    expect(b.h).toBe(BLOCK_H)
    expect(b.w).toBe(1000)
    expect(b.d).toBe(1000)
    // 블록 칸에도 바닥 상자가 있다.
    expect(boxes.some((f) => f.kind === 'floor' && f.cx === 0 && f.cz === b.cz)).toBe(true)
  })

  it('ramp slope', () => {
    const info = course.segmentAt(6)
    const ramp = segmentBoxes(course, info).find((b) => b.kind === 'floor' && b.cx === -3000 && b.cz === 8 * 1000 + 500)!
    expect(ramp.slope).toBe(250)
    // 오르막 뒤 칸 위 블록은 올라간 바닥 위에 앉는다.
    const block = segmentBoxes(course, info).find((b) => b.kind === 'block' && b.cx === -3000)!
    expect(block.cy).toBe(course.cell(-3, 9).floor!.h0 + BLOCK_H / 2)
  })

  it('holes have no boxes', () => {
    const info = course.segmentAt(0)
    const boxes = segmentBoxes(course, info)
    expect(boxes.some((b) => b.cx === -3000 || b.cx === 3000)).toBe(false)
  })
})

// v2: 기둥·문·기운 판. 행 1: 기둥과 문 기둥 둘(사이 2칸), 행 2: 기운 판.
const V2 = parseSegment({ id: 'v2', kind: 'obstacle', tier: 1, rows: [JOINT, 'PG__G_.', '.<<_>>.', JOINT] })
const v2course = courseFromSegments([{ seg: V2, mirrored: false }])

describe('segmentBoxes v2', () => {
  it('pillar height', () => {
    const boxes = segmentBoxes(v2course, v2course.segmentAt(0))
    const p = boxes.find((b) => b.kind === 'block' && b.cx === -3000)!
    expect(p.h).toBe(PILLAR_H)
    expect(p.cy).toBe(v2course.cell(-3, 1).floor!.h0 + PILLAR_H / 2)
    const g = boxes.find((b) => b.kind === 'block' && b.cx === -2000)!
    expect(g.h).toBe(GATE_H)
  })

  it('gate lintel', () => {
    const boxes = segmentBoxes(v2course, v2course.segmentAt(0))
    const lintels = boxes.filter((b) => b.kind === 'lintel')
    expect(lintels).toHaveLength(1)
    const l = lintels[0]
    // 문 기둥 col -2와 col 1 사이(col -1, 0) 2칸 폭, 가운데는 -500.
    expect(l.cx).toBe(-500)
    expect(l.w).toBe(2000)
    expect(l.cz).toBe(1 * 1000 + 500)
    const floor = v2course.cell(-2, 1).floor!.h0
    // 공 위(블록 높이)부터 기둥 꼭대기까지.
    expect(l.cy - l.h / 2).toBe(floor + BLOCK_H)
    expect(l.cy + l.h / 2).toBe(floor + GATE_H)
  })

  it('bank flag', () => {
    const floors = segmentBoxes(v2course, v2course.segmentAt(0)).filter((b) => b.kind === 'floor' && b.cz === 2500)
    expect(floors.find((b) => b.cx === -2000)!.bank).toBe(-1)
    expect(floors.find((b) => b.cx === -1000)!.bank).toBe(-1)
    expect(floors.find((b) => b.cx === 0)!.bank).toBeUndefined()
    expect(floors.find((b) => b.cx === 1000)!.bank).toBe(1)
    expect(floors.find((b) => b.cx === 2000)!.bank).toBe(1)
  })
})

describe('bankOffset', () => {
  it('follows the rolled plank', () => {
    // 행 2: '.<<_>>.' → 왼쪽 판(col -2, -1, 가운데 -1500)은 왼쪽이 낮고, 오른쪽 판(1, 2, 가운데 1500)은 오른쪽이 낮다.
    expect(bankOffset(v2course, -1500, 2500)).toBeCloseTo(0)
    expect(bankOffset(v2course, -2000, 2500)).toBeLessThan(0)
    expect(bankOffset(v2course, -1000, 2500)).toBeGreaterThan(0)
    expect(bankOffset(v2course, 2000, 2500)).toBeLessThan(0)
    expect(bankOffset(v2course, 2000, 2500)).toBeCloseTo(bankOffset(v2course, -2000, 2500))
    expect(bankOffset(v2course, 0, 2500)).toBe(0)
    expect(bankOffset(v2course, 0, 500)).toBe(0)
  })
})

describe('cameraTarget', () => {
  // 평지 10행 뒤 급경사 10행.
  const DESC = parseSegment({
    id: 'desc', kind: 'descent', tier: 1, rows: [JOINT, ...new Array<string>(10).fill('._____.'), ...new Array<string>(10).fill('.!!!!!.'), JOINT],
  })
  const c = courseFromSegments([{ seg: DESC, mirrored: false }])

  it('cameraTarget looks down on descents', () => {
    // 평지 위, 6 m 앞도 평지.
    const flat = { x: 0, y: R, z: 2000 }
    const t0 = cameraTarget(c, flat)
    expect(t0.lookY).toBe(flat.y)
    expect(t0.eyeY).toBeGreaterThan(flat.y)
    // 6 m 앞이 급경사.
    const edge = { x: 0, y: R, z: 9500 }
    const t1 = cameraTarget(c, edge)
    expect(t1.lookY).toBeLessThan(edge.y)
    expect(t1.eyeY).toBeGreaterThan(edge.y)
  })

  it('eye stays above the floor behind on descents', () => {
    // 급경사 중간: 공 뒤 CAM_BACK 바닥이 공 바닥보다 높아도 눈은 그 바닥 위에 있다.
    const z = 15500
    const ball = { x: 0, y: floorAt(c, 0, z)! + R, z }
    const behind = floorAt(c, 0, z - CAM_BACK)!
    expect(behind).toBeGreaterThan(ball.y)
    const t = cameraTarget(c, ball)
    expect(t.eyeY).toBeGreaterThanOrEqual(behind + R + CAM_UP)
    // 평지에서는 공 위 CAM_UP.
    expect(cameraTarget(c, { x: 0, y: R, z: 6000 }).eyeY).toBe(R + CAM_UP)
  })

  it('no floor ahead keeps ball height', () => {
    // 바깥 열(구멍) 앞은 바닥이 없다.
    const t = cameraTarget(c, { x: 3000, y: 1234, z: 2000 })
    expect(t.lookY).toBe(1234)
  })
})

describe('buildingsFor', () => {
  it('buildings are deterministic and off-track', () => {
    const a = buildingsFor(SEED, 0, 300)
    const b = buildingsFor(SEED, 0, 300)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    for (const k of a) {
      expect(Math.abs(k.cx) - k.w / 2).toBeGreaterThan(X_LIMIT + 1000)
      expect(k.w).toBeGreaterThan(0)
      expect(k.d).toBeGreaterThan(0)
      expect(k.h).toBeGreaterThan(0)
    }
    expect(a.some((k) => k.cx < 0)).toBe(true)
    expect(a.some((k) => k.cx > 0)).toBe(true)
  })

  it('split ranges give the same buildings without duplicates', () => {
    const whole = buildingsFor(SEED, 0, 300)
    const split = [...buildingsFor(SEED, 0, 137), ...buildingsFor(SEED, 137, 300)]
    expect(split).toEqual(whole)
    for (const k of buildingsFor(SEED, 137, 300)) expect(k.cz).toBeGreaterThanOrEqual(137 * 1000)
  })

  it('different seeds differ', () => {
    expect(buildingsFor(SEED, 0, 300)).not.toEqual(buildingsFor('f'.repeat(32), 0, 300))
  })
})
