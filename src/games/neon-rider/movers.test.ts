import { describe, expect, it } from 'vitest'
import { FALL_DEPTH, SUBSTEPS, WHEEL_R } from './constants.ts'
import { candVel, collideWheel, toFrame } from './collide.ts'
import type { Body } from './collide.ts'
import { applyPose, poseAt, type Motion } from './motion.ts'
import { carryOn, moverBox, moverCands, moverIdOf, moverPoses, moverSegsAt, moverT0 } from './movers.ts'
import type { Mover, MoverRun } from './movers.ts'
import type { Seg } from './pieces.ts'
import { TURN } from './trig.ts'

const S = SUBSTEPS
const seg = (x0: number, y0: number, x1: number, y1: number): Seg => ({ x0, y0, x1, y1, boost: false })
const mover = (motion: Motion, segs: Seg[] = [seg(1000, 0, 5000, 0), seg(5000, 0, 6000, 2000)], id = 3): Mover => ({
  id,
  segs,
  pivotX: 2000,
  pivotY: 500,
  motion,
  start: { k: 'time' },
  look: 'yellow',
})

function inside(b: { x0: number; y0: number; x1: number; y1: number }, segs: Seg[]): boolean {
  return segs.every((s) => [s.x0, s.x1].every((x) => x >= b.x0 && x <= b.x1) && [s.y0, s.y1].every((y) => y >= b.y0 && y <= b.y1))
}

describe('moverSegsAt: 자세 적용', () => {
  it('none은 처음 선분 그대로, swing은 (dx, dy)만큼, 반 바퀴 회전은 기준점 대칭', () => {
    const m0 = mover({ k: 'none' })
    expect(moverSegsAt(m0, 123, null)).toEqual(m0.segs)
    const sw = mover({ k: 'swing', ax: 3000, ay: -600, period: 40, phase: 0 })
    expect(moverSegsAt(sw, 20 * S, null)).toEqual([seg(4000, -600, 8000, -600), seg(8000, -600, 9000, 1400)])
    // TURN/2 회전: (x, y) → (2·pivotX − x, 2·pivotY − y)
    const rot = mover({ k: 'rotate', a0: TURN / 2, w: 0 })
    expect(moverSegsAt(rot, 0, null)).toEqual([seg(3000, 1000, -1000, 1000), seg(-1000, 1000, -2000, -1000)])
  })

  it('applyPose와 같은 결과(여러 각도·이동)', () => {
    const m = mover({ k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 50, dx: 7777, dy: -3333, a: 5000 }] })
    for (let T = 0; T <= 150; T += 7) {
      const p = poseAt(m.motion, T, 0)
      const want = m.segs.map((g) => {
        const a = applyPose(p, m.pivotX, m.pivotY, g.x0, g.y0)
        const b = applyPose(p, m.pivotX, m.pivotY, g.x1, g.y1)
        return seg(a.x, a.y, b.x, b.y)
      })
      expect(moverSegsAt(m, T, 0)).toEqual(want)
    }
  })

  it('keys는 T0부터 세고(null이면 첫 키), 끝난 길(moverT0 done)은 어느 시각에서도 마지막 키', () => {
    const keys: Motion = { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 10, dx: 0, dy: 1000, a: 0 }] }
    const m: Mover = { ...mover(keys), start: { k: 'touch', delay: 0 } }
    expect(moverSegsAt(m, 500, null)).toEqual(m.segs)
    expect(moverSegsAt(m, 5 * S + 30, 30)[0]).toEqual(seg(1000, 500, 5000, 500))
    const done = moverT0(m, null, true)
    for (const T of [0, 1, 7, 100000]) expect(moverSegsAt(m, T, done)[0]).toEqual(seg(1000, 1000, 5000, 1000))
    expect(moverT0(m, 7, false)).toBe(7 * S)
    expect(moverT0(m, null, false)).toBeNull()
    expect(moverT0({ ...m, start: { k: 'time' } }, null, false)).toBe(0)
  })
})

describe('moverBox: 움직임 전체를 덮는다', () => {
  const cases: [string, Motion][] = [
    ['rotate', { k: 'rotate', a0: 100, w: 37 }],
    ['swing', { k: 'swing', ax: -7000, ay: 3000, period: 50, phase: 7 }],
    ['keys(회전 포함)', { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 30, dx: 2000, dy: -4000, a: 900 }] }],
    ['fall(회전)', { k: 'fall', w: 9 }],
  ]
  for (const [name, motion] of cases) {
    it(name, () => {
      const m = mover(motion)
      const b = moverBox(m)
      for (let T = 0; T < 600 * S; T += 7) {
        const segs = moverSegsAt(m, T, 0)
        // fall은 FALL_DEPTH 넘게 떨어지면 끝난다(판정·그림 없음): 그 전까지만 덮으면 된다.
        if (motion.k === 'fall' && Math.min(...segs.map((s) => Math.min(s.y0, s.y1))) < Math.min(...m.segs.map((s) => Math.min(s.y0, s.y1))) - FALL_DEPTH) break
        expect(inside(b, segs), `${name} T=${T}`).toBe(true)
      }
    })
  }
})

describe('움직이는 길 후보', () => {
  it('후보 번호는 음수이고 길 id로 되돌릴 수 있다, prev는 한 부분 틱 전 자세', () => {
    const m = mover({ k: 'swing', ax: 3000, ay: 0, period: 40, phase: 10 }, undefined, 42)
    const runs: MoverRun[] = [{ m, T0: null }]
    const cs = moverCands(runs, moverPoses(runs, 100), moverPoses(runs, 99))
    expect(cs.map((c) => c.i)).toEqual([-1 - 42000, -1 - 42001])
    for (const c of cs) {
      expect(c.i).toBeLessThan(0)
      expect(moverIdOf(c.i)).toBe(42)
    }
    expect(cs[0].prev).toEqual(moverSegsAt(m, 99, null)[0])
    expect(cs[0].seg).toEqual(moverSegsAt(m, 100, null)[0])
  })

  it('toFrame: 길과 함께 옮긴 점은 선분에 대한 상대 위치가 같다(평행 이동·회전)', () => {
    const a = seg(0, 0, 10000, 0)
    expect(toFrame(a, seg(500, 300, 10500, 300), 2000, 1000)).toEqual({ x: 2500, y: 1300 })
    // 왼쪽 끝 둘레 1/4 바퀴: 선분 위 1000은 선분 왼쪽(−x) 1000으로
    expect(toFrame(a, seg(0, 0, 0, 10000), 2000, 1000)).toEqual({ x: -1000, y: 2000 })
  })

  it('candVel: 고정 선분은 0, 평행 이동은 변위 × SUBSTEPS, 끝 둘레 회전은 위치에 비례', () => {
    const still: MoverRun[] = [{ m: mover({ k: 'none' }), T0: null }]
    const fixed = moverCands(still, moverPoses(still, 5), moverPoses(still, 4))[0]
    expect(candVel(fixed, 3000, 0)).toEqual({ vx: 0, vy: 0 })
    const c = { i: -1, seg: seg(100, 0, 10100, 0), sx: 10000, sy: 0, len: 10000, l2: 1e8, prev: seg(0, 0, 10000, 0) }
    expect(candVel(c, 5000, 999)).toEqual({ vx: 100 * S, vy: 0 })
    const r = { i: -1, seg: seg(0, 0, 10000, 100), sx: 10000, sy: 100, len: 10000, l2: 100010000, prev: seg(0, 0, 10000, 0) }
    expect(candVel(r, 5000, 0)).toEqual({ vx: 0, vy: 50 * S })
    expect(candVel(r, 20000, 0)).toEqual({ vx: 0, vy: 100 * S }) // 선분 밖은 끝점으로 자른다
  })

  it('collideWheel(prev): 길에 대한 상대 위치로 쪽을 정하고, 상대 속도로 응답한다', () => {
    // 길이 이번 부분 틱에 위로 3000 올라와 바퀴 중심을 지나쳤다. 길 기준으로 바퀴는 위에서 왔으므로 위로 밀린다.
    const c = { i: -1, seg: seg(-10000, 3000, 10000, 3000), sx: 20000, sy: 0, len: 20000, l2: 4e8, prev: seg(-10000, 0, 10000, 0) }
    const b: Body = { x: 0, y: 2000, vx: 0, vy: 0 }
    expect(collideWheel(b, 0, 2000, WHEEL_R, 0, [c], 0)).toEqual([c])
    expect(b.y).toBe(3000 + WHEEL_R)
    expect(b.vy).toBe(3000 * S) // 길의 법선 속도를 받는다(상대 법선 속도 0)
    // prev가 없으면(고정 선분) 아래로 민다.
    const { prev: _p, ...still } = c
    const b2: Body = { x: 0, y: 2000, vx: 0, vy: 0 }
    collideWheel(b2, 0, 2000, WHEEL_R, 0, [still], 0)
    expect(b2.y).toBe(3000 - WHEEL_R)
  })

  it('carryOn: 길이 접선 방향으로 속도를 바꾸면 닿은 바퀴도 같은 만큼 바뀐다, 떨어진 바퀴는 그대로', () => {
    // 부분 틱 T−2 → T−1 → T: 0 → 0 → +60 (접선 가속), 바퀴는 T−1 자세 위에 앉아 있다.
    const keys: Motion = { k: 'keys', keys: [{ t: 0, dx: 0, dy: 0, a: 0 }, { t: 1, dx: 180, dy: 0, a: 0 }] }
    const m = mover(keys, [seg(0, 0, 30000, 0)])
    const runs: MoverRun[] = [{ m, T0: 1 }] // T0 = 1: 부분 틱 2부터 움직인다
    const on: Body = { x: 10000, y: WHEEL_R, vx: 5, vy: 0 }
    const at = (T: number) => moverPoses(runs, T)
    carryOn(on, at(2), at(1), at(0), WHEEL_R + 10)
    expect(on).toEqual({ x: 10000, y: WHEEL_R, vx: 5 + 60 * S, vy: 0 })
    const off: Body = { x: 10000, y: WHEEL_R + 100, vx: 5, vy: 0 }
    carryOn(off, at(2), at(1), at(0), WHEEL_R + 10)
    expect(off.vx).toBe(5)
  })
})
