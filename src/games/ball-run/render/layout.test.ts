import { describe, expect, it } from 'vitest'
import { BLOCK_H, GATE_H, PILLAR_H, R, X_LIMIT } from '../constants.ts'
import { courseFromSegments } from '../course.ts'
import { JOINT, parseSegment } from '../segments.ts'
import {
  BALL_FRAC, BANK_ANGLE, BANK_EASE, CAM_BACK, CAM_UP, EYE_LAG_MAX, LINTEL_H, VFOV, bankEase, bankOffset, buildingsFor, cameraTarget,
  BANK_FLOAT_MAX, bankFollow, lookPitch, segmentBoxes, smoothEye,
} from './layout.ts'
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
    // 문 기둥은 1 m 큐브, 가로대는 기둥 꼭대기부터 LINTEL_H 위까지 솟는다(녹화 27.0 s).
    expect(GATE_H).toBe(BLOCK_H)
    expect(l.cy - l.h / 2).toBe(floor + GATE_H)
    expect(l.cy + l.h / 2).toBe(floor + GATE_H + LINTEL_H)
    expect(LINTEL_H).toBe(1000)
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

// 기운 판 이음: 판(같은 행·같은 방향·같은 칸 범위)이 이어지는 행 묶음의 처음·끝 BANK_EASE 안에서 굴림이 0까지 줄어
// 평평한 이웃 행과 높이가 맞는다(공이 판 사이에서 튀지 않고, 굴린 판 모서리가 솟아 보이지 않는다).
describe('bank easing', () => {
  // 행 1~2 평지, 3~8 '..>>>..', 9~10 평지, 11~16 '.<<<...', 17 평지.
  const BANKS = parseSegment({
    id: 'banks', kind: 'obstacle', tier: 1,
    rows: [JOINT, '._____.', '._____.', ...new Array<string>(6).fill('..>>>..'), '._____.', '._____.', ...new Array<string>(6).fill('.<<<...'), JOINT],
  })
  const bc = courseFromSegments([{ seg: BANKS, mirrored: false }])

  it('ease is 0 at the ends of a banked run and 1 in the middle', () => {
    expect(BANK_EASE).toBeGreaterThanOrEqual(500)
    expect(bankEase(bc, 0, 3000)).toBe(0) // 판 묶음 시작
    expect(bankEase(bc, 0, 9000 - 1)).toBeCloseTo(0, 2) // 끝 바로 앞
    expect(bankEase(bc, 0, 6000)).toBe(1)
    expect(bankEase(bc, 0, 3000 + BANK_EASE / 2)).toBeGreaterThan(0)
    expect(bankEase(bc, 0, 3000 + BANK_EASE / 2)).toBeLessThan(1)
    expect(bankEase(bc, 0, 1500)).toBe(0) // 평지
    expect(bankEase(bc, -1, 13000)).toBe(1) // 방향이 바뀐 다른 판
  })

  it('bankOffset is continuous along z (no jump at plank joints)', () => {
    for (const x of [-500, 0, 400, 1400, -1400]) {
      let prev = bankOffset(bc, x, 0)
      for (let z = 50; z < 18000; z += 50) {
        const cur = bankOffset(bc, x, z)
        // 판 이음에서 50 mm 전진에 생기는 높이 차가 작다(급격한 계단 없음).
        expect(Math.abs(cur - prev), `x=${x} z=${z}`).toBeLessThan(60)
        prev = cur
      }
    }
    // 판 가운데 행에서는 온전히 굴린 높이.
    expect(bankOffset(bc, 1000, 6000)).toBeCloseTo(-1000 * Math.tan(BANK_ANGLE))
  })

  it('bankFollow: drops onto a lower plank face under gravity, climbs with the face', () => {
    const dt = 1 / 60
    // 판 면이 프레임마다 40 mm씩 내려가면(판 이음 비틀림) 첫 프레임은 중력으로 조금만, 그 뒤 면 위 BANK_FLOAT_MAX 안에서 따라간다.
    let st = { dy: 0, vy: 0 }
    let face = 0
    const steps: number[] = []
    for (let i = 0; i < 40; i++) {
      face = Math.max(-550, face - 40)
      const n = bankFollow(st, face, dt)
      steps.push(st.dy - n.dy)
      expect(n.dy).toBeGreaterThanOrEqual(face)
      expect(n.dy - face).toBeLessThanOrEqual(BANK_FLOAT_MAX)
      st = n
    }
    expect(steps[0]).toBeGreaterThan(0)
    expect(steps[0]).toBeLessThan(40)
    for (const d of steps) {
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(40 + BANK_FLOAT_MAX)
    }
    expect(st.dy).toBe(-550)
    expect(st.vy).toBe(0)
    // 한 번에 크게 낮아진 면에서도 BANK_FLOAT_MAX보다 높이 뜨지 않는다.
    expect(bankFollow({ dy: 0, vy: 0 }, -550, dt).dy).toBe(-550 + BANK_FLOAT_MAX)
    // 면이 올라가면 면을 그대로 따라간다(묻히지 않는다).
    expect(bankFollow({ dy: -550, vy: 0 }, 0, dt)).toEqual({ dy: 0, vy: 0 })
    expect(bankFollow({ dy: -300, vy: -2000 }, -200, dt)).toEqual({ dy: -200, vy: 0 })
  })
})

describe('camera framing', () => {
  // 공이 화면 위에서 BALL_FRAC에 오도록 시선 각을 정한다: 눈→공 방향에서 고정 각만큼 위를 본다.
  const project = (eye: { y: number; z: number }, ball: { y: number; z: number }, pitch: number) => {
    const toBall = Math.atan2(ball.y - eye.y, ball.z - eye.z)
    const ndc = Math.tan(toBall - pitch) / Math.tan(((VFOV / 2) * Math.PI) / 180)
    return 0.5 - ndc / 2
  }

  it('ball projects at BALL_FRAC for any eye height', () => {
    expect(BALL_FRAC).toBeCloseTo(0.62, 2)
    for (const dy of [0, CAM_UP, 2000, 4000, -200]) {
      const eye = { y: R + dy, z: 10000 - CAM_BACK }
      const ball = { y: R, z: 10000 }
      expect(project(eye, ball, lookPitch(eye, ball)), `dy=${dy}`).toBeCloseTo(BALL_FRAC, 6)
    }
  })

  it('a higher eye looks further down', () => {
    const ball = { y: R, z: 10000 }
    const low = lookPitch({ y: R + CAM_UP, z: 10000 - CAM_BACK }, ball)
    const high = lookPitch({ y: R + 3000, z: 10000 - CAM_BACK }, ball)
    expect(high).toBeLessThan(low)
    expect(low).toBeLessThan(0)
  })

  it('smoothEye eases down slowly, catches up upward, respects the floor and the lag cap', () => {
    const dt = 1 / 60
    // 단차: 목표가 1 m 내려가도 한 프레임에 크게 움직이지 않는다.
    let eye = 2000
    const first = smoothEye(eye, 1000, -Infinity, dt)
    expect(eye - first).toBeGreaterThan(0)
    expect(eye - first).toBeLessThan(80)
    for (let i = 0; i < 90; i++) eye = smoothEye(eye, 1000, -Infinity, dt)
    expect(eye - 1000).toBeLessThan(50) // 1.5초 뒤 거의 따라잡음
    // 목표가 아무리 빨리 내려가도 EYE_LAG_MAX보다 높이 남지 않는다.
    expect(smoothEye(10000, 0, -Infinity, dt)).toBeLessThanOrEqual(EYE_LAG_MAX)
    // 오르막: 아래로 처진 눈은 빨리 올라온다.
    const up = smoothEye(1000, 2000, -Infinity, dt)
    expect(up - 1000).toBeGreaterThan(first > 0 ? 2000 - first : 0)
    // 바닥 기준 최저 높이 아래로는 가지 않는다.
    expect(smoothEye(1000, 500, 1500, dt)).toBe(1500)
  })
})

describe('cameraTarget', () => {
  // 평지 10행 뒤 급경사 10행.
  const DESC = parseSegment({
    id: 'desc', kind: 'descent', tier: 1, rows: [JOINT, ...new Array<string>(10).fill('._____.'), ...new Array<string>(10).fill('.!!!!!.'), JOINT],
  })
  const c = courseFromSegments([{ seg: DESC, mirrored: false }])

  it('eye target ignores the floor ahead (no step when z + 6 m crosses an edge)', () => {
    const before = cameraTarget(c, { x: 0, y: R, z: 4900 })
    const after = cameraTarget(c, { x: 0, y: R, z: 5100 })
    expect(after.eyeY).toBe(before.eyeY)
    expect(before.eyeY).toBe(R + CAM_UP)
  })

  it('eye stays above the floor behind on descents', () => {
    // 급경사 중간: 공 뒤 CAM_BACK 바닥이 공 바닥보다 높아도 눈은 그 바닥 위에 있다.
    const z = 15500
    const ball = { x: 0, y: floorAt(c, 0, z)! + R, z }
    const behind = floorAt(c, 0, z - CAM_BACK)!
    expect(behind).toBeGreaterThan(ball.y)
    const t = cameraTarget(c, ball)
    expect(t.eyeY).toBeGreaterThanOrEqual(behind + R + CAM_UP)
    // 최저 눈 높이: 카메라~공 사이 바닥 위(판 속에 묻히지 않게).
    expect(t.minEyeY).toBeGreaterThan(behind)
    expect(t.minEyeY).toBeLessThanOrEqual(t.eyeY)
    // 평지에서는 공 위 CAM_UP.
    expect(cameraTarget(c, { x: 0, y: R, z: 6000 }).eyeY).toBe(R + CAM_UP)
  })

  it('over a hole the eye follows the ball', () => {
    // 바깥 열(구멍) 위: 바닥이 없으니 공 높이 기준.
    const t = cameraTarget(c, { x: 3000, y: 1234, z: 2000 })
    expect(t.eyeY).toBe(1234 + CAM_UP)
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
