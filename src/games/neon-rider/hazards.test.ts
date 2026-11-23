import { describe, expect, it } from 'vitest'
import { BODY_DY, BODY_R, HEAD_OFFSET, HEAD_R, MM, SUBSTEPS, WHEELBASE, WHEEL_R } from './constants.ts'
import { bladeAngles, hazardBox, hazardHit, shapeAt, type Hazard, type HazardShape, type Probe } from './hazards.ts'
import { subtick, type Motion } from './motion.ts'
import { TRIG_ONE, TURN, cosT, sinT } from './trig.ts'

const S = SUBSTEPS
const TOL = Math.floor(WHEEL_R / 4) // 설계 §5.4: 45 mm
const FAR = { x0: -90_000_000, y0: -90_000_000, x1: -90_000_000, y1: -90_000_000, r: 16 } // 판정에 안 걸리는 차대
const NONE: Motion = { k: 'none' }
const fixedAngle = (a0: number): Motion => ({ k: 'rotate', a0, w: 0 })

function hz(shape: HazardShape, motion: Motion = NONE): Hazard {
  return { id: 1, shape, motion, look: 'plain' }
}
function circ(x: number, y: number, r: number): Probe {
  return { circles: [{ x, y, r }], capsule: FAR }
}
function caps(x0: number, y0: number, x1: number, y1: number, r: number): Probe {
  return { circles: [], capsule: { x0, y0, x1, y1, r } }
}
/** 원점에서 각 a, 거리 d인 점(±1 u) */
function polar(a: number, d: number, ox = 0, oy = 0): [number, number] {
  return [ox + Math.floor((cosT(a) * d) / TRIG_ONE), oy + Math.floor((sinT(a) * d) / TRIG_ONE)]
}
const hitAt = (h: Hazard, p: Probe, T = 0): boolean => hazardHit(h, T, p)

describe('원–원 (disc ↔ 바퀴·차체 원)', () => {
  const h = hz({ s: 'disc', x: 0, y: 0, r: 1000 })
  it('거리 = r1 + r2 + 1 → false, r1 + r2 − 1 → true', () => {
    expect(hitAt(h, circ(1501, 0, 500))).toBe(false)
    expect(hitAt(h, circ(1499, 0, 500))).toBe(true)
    expect(hitAt(h, circ(0, -1501, 500))).toBe(false)
    expect(hitAt(h, circ(0, -1499, 500))).toBe(true)
  })
  it('대각선에서도 정확하다(거리 = 합은 닿지 않음)', () => {
    expect(hitAt(h, circ(900, 1200, 500))).toBe(false) // 거리 1500
    expect(hitAt(h, circ(899, 1200, 500))).toBe(true)
  })
  it('차대 캡슐과 disc', () => {
    expect(hitAt(h, caps(-5000, 1501, 5000, 1501, 500))).toBe(false)
    expect(hitAt(h, caps(-5000, 1499, 5000, 1499, 500))).toBe(true)
  })
})

describe('원–캡슐 (bar ↔ 원)', () => {
  const h = hz({ s: 'bar', x0: 0, y0: 0, x1: 10000, y1: 0, r: 200 })
  it('가운데', () => {
    expect(hitAt(h, circ(5000, 501, 300))).toBe(false)
    expect(hitAt(h, circ(5000, 499, 300))).toBe(true)
    expect(hitAt(h, circ(5000, -501, 300))).toBe(false)
    expect(hitAt(h, circ(5000, -499, 300))).toBe(true)
  })
  it('끝 캡', () => {
    expect(hitAt(h, circ(10501, 0, 300))).toBe(false)
    expect(hitAt(h, circ(10499, 0, 300))).toBe(true)
    expect(hitAt(h, circ(-501, 0, 300))).toBe(false)
    expect(hitAt(h, circ(-499, 0, 300))).toBe(true)
    expect(hitAt(h, circ(10300, 400, 300))).toBe(false) // 끝점에서 거리 500
    expect(hitAt(h, circ(10300, 399, 300))).toBe(true)
  })
  it('비스듬한 막대(√ 정수가 아닌 길이)', () => {
    const d = hz({ s: 'bar', x0: 0, y0: 0, x1: 7000, y1: 7000, r: 0 })
    // 선분 y = x까지의 거리 = |x − y| / √2
    expect(hitAt(d, circ(3000, 3000 + 141, 100))).toBe(true) // 99.7
    expect(hitAt(d, circ(3000, 3000 + 142, 100))).toBe(false) // 100.4
    // 짧은 막대: 길이 √18 ≈ 4.24 (isqrt = 4로 내리면 거리 96.9를 놓친다)
    const short = hz({ s: 'bar', x0: 0, y0: 0, x1: 3, y1: 3, r: 0 })
    expect(hitAt(short, circ(70, -67, 100))).toBe(true) // 137/√2 = 96.9
    expect(hitAt(short, circ(73, -70, 100))).toBe(false) // 143/√2 = 101.1
  })
})

describe('캡슐–캡슐 (bar ↔ 차대)', () => {
  const h = hz({ s: 'bar', x0: 0, y0: 0, x1: 10000, y1: 0, r: 200 })
  it('평행', () => {
    expect(hitAt(h, caps(2000, 501, 8000, 501, 300))).toBe(false)
    expect(hitAt(h, caps(2000, 499, 8000, 499, 300))).toBe(true)
  })
  it('교차(끝점은 모두 멀다)', () => {
    expect(hitAt(h, caps(5000, -30000, 5000, 30000, 1))).toBe(true)
    expect(hitAt(h, caps(-3000, -3000, 13000, 3000, 1))).toBe(true)
  })
  it('끝 근접', () => {
    expect(hitAt(h, caps(10501, 0, 20000, 0, 300))).toBe(false) // 끝–끝
    expect(hitAt(h, caps(10499, 0, 20000, 0, 300))).toBe(true)
    expect(hitAt(h, caps(5000, 501, 5000, 9000, 300))).toBe(false) // 끝–가운데
    expect(hitAt(h, caps(5000, 499, 5000, 9000, 300))).toBe(true)
    expect(hitAt(h, caps(10300, 400, 10300, 9000, 300))).toBe(false) // 끝–끝 대각 500
    expect(hitAt(h, caps(10300, 399, 10300, 9000, 300))).toBe(true)
  })
  it('교차하지 않는 엇갈린 선분', () => {
    expect(hitAt(h, caps(12000, -5000, 12000, 5000, 300))).toBe(false)
  })
})

describe('부채꼴 고리 (blades ↔ 원)', () => {
  // 조각 둘(폭 1/4바퀴), 0°와 180°를 가운데로. 빈 각은 45°~135°, 225°~315°
  const h = hz({ s: 'blades', x: 0, y: 0, rIn: 4000, rOut: 10000, n: 2, w: TURN / 4 }, fixedAngle(-TURN / 8))
  it('조각 안 점', () => {
    expect(hitAt(h, circ(7000, 0, 500))).toBe(true)
    expect(hitAt(h, circ(-7000, 0, 500))).toBe(true)
    expect(hitAt(h, circ(6000, 4000, 500))).toBe(true)
  })
  it('조각 사이 빈 각', () => {
    expect(hitAt(h, circ(0, 7000, 500))).toBe(false)
    expect(hitAt(h, circ(0, -7000, 500))).toBe(false)
  })
  it('rIn 안쪽', () => {
    expect(hitAt(h, circ(2000, 0, 500))).toBe(false)
    expect(hitAt(h, circ(3500, 0, 500))).toBe(false) // 거리 = rIn − c
    expect(hitAt(h, circ(3501, 0, 500))).toBe(true)
  })
  it('바깥 rOut + c − 1 → true, rOut + c → false', () => {
    expect(hitAt(h, circ(10499, 0, 500))).toBe(true)
    expect(hitAt(h, circ(10500, 0, 500))).toBe(false)
  })
  it('rIn = 0이면 중심도 닿는다', () => {
    const fan = hz({ s: 'blades', x: 500, y: -300, rIn: 0, rOut: 8000, n: 3, w: 400 })
    expect(hitAt(fan, circ(500, -300, 10))).toBe(true)
  })
  it('팩맨(n = 1, w = 3/4바퀴): 입 안은 빈다', () => {
    const pac = hz({ s: 'blades', x: 0, y: 0, rIn: 0, rOut: 10000, n: 1, w: (TURN * 3) / 4 }, fixedAngle(TURN / 8))
    expect(hitAt(pac, circ(7000, 0, 300))).toBe(false) // 입(−45°~45°) 가운데
    expect(hitAt(pac, circ(-7000, 0, 300))).toBe(true)
    expect(hitAt(pac, circ(0, 7000, 300))).toBe(true)
  })
  it('회전 후(시각을 바꿔) 같은 점의 결과가 바뀐다', () => {
    const spin = hz({ s: 'blades', x: 0, y: 0, rIn: 4000, rOut: 10000, n: 2, w: TURN / 4 }, { k: 'rotate', a0: -TURN / 8, w: 8 })
    const quarter = ((TURN / 4) * S) / 8 // 1/4바퀴 돈 부분 틱
    expect(hitAt(spin, circ(7000, 0, 500), 0)).toBe(true)
    expect(hitAt(spin, circ(0, 7000, 500), 0)).toBe(false)
    expect(hitAt(spin, circ(7000, 0, 500), quarter)).toBe(false)
    expect(hitAt(spin, circ(0, 7000, 500), quarter)).toBe(true)
  })
})

describe('bladeAngles', () => {
  it('pose.a + i·TURN/n, [0, TURN)로 접는다', () => {
    const h = hz({ s: 'blades', x: 0, y: 0, rIn: 0, rOut: 1000, n: 2, w: 100 }, fixedAngle(-512))
    expect(bladeAngles(h, 0)).toEqual([3584, 1536])
    const three = hz({ s: 'blades', x: 0, y: 0, rIn: 0, rOut: 1000, n: 3, w: 100 })
    expect(bladeAngles(three, 0)).toEqual([0, 1365, 2730])
  })
  it('rotate를 따라 돈다', () => {
    const h = hz({ s: 'blades', x: 0, y: 0, rIn: 0, rOut: 1000, n: 2, w: 100 }, { k: 'rotate', a0: 10, w: 6 })
    expect(bladeAngles(h, subtick(10, 2))).toEqual([10 + 66, 10 + 66 + 2048])
  })
  it('blades가 아니면 빈 배열', () => {
    expect(bladeAngles(hz({ s: 'disc', x: 0, y: 0, r: 10 }), 0)).toEqual([])
  })
})

describe('허용 오차 45 mm (설계 §5.4)', () => {
  const c = WHEEL_R
  const DIRS = [0, 300, 1024, 1700, 2048, 2500, 3072, 3900]
  it('disc: 여러 방향', () => {
    const h = hz({ s: 'disc', x: 12345, y: -6789, r: 3000 })
    for (const a of DIRS) {
      expect(hitAt(h, circ(...polar(a, 3000 + c + TOL, 12345, -6789), c)), `밖 ${a}`).toBe(false)
      expect(hitAt(h, circ(...polar(a, 3000 + c - TOL, 12345, -6789), c)), `안 ${a}`).toBe(true)
    }
  })
  it('기울어진 bar(rotate로 돌린 창): 양옆·끝·바닥', () => {
    const r = 10 * MM
    const tilt = 300
    const h = hz({ s: 'bar', x0: 0, y0: 0, x1: 0, y1: 20000, r }, fixedAngle(tilt))
    const along = TURN / 4 + tilt // 막대 방향
    const [mx, my] = polar(along, 10000)
    const cases: [number, number, number][] = [
      [along + TURN / 4, mx, my], // 왼쪽 옆
      [along - TURN / 4, mx, my], // 오른쪽 옆
    ]
    for (const [a, ox, oy] of cases) {
      expect(hitAt(h, circ(...polar(a, r + c + TOL, ox, oy), c))).toBe(false)
      expect(hitAt(h, circ(...polar(a, r + c - TOL, ox, oy), c))).toBe(true)
    }
    expect(hitAt(h, circ(...polar(along, 20000 + r + c + TOL), c))).toBe(false) // 끝
    expect(hitAt(h, circ(...polar(along, 20000 + r + c - TOL), c))).toBe(true)
    expect(hitAt(h, circ(...polar(along + TURN / 2, r + c + TOL), c))).toBe(false) // 바닥
    expect(hitAt(h, circ(...polar(along + TURN / 2, r + c - TOL), c))).toBe(true)
    for (const a of [along + 600, along - 600]) {
      // 끝 둥근 부분의 비스듬한 방향
      const [tx, ty] = polar(along, 20000)
      expect(hitAt(h, circ(...polar(a, r + c + TOL, tx, ty), c))).toBe(false)
      expect(hitAt(h, circ(...polar(a, r + c - TOL, tx, ty), c))).toBe(true)
    }
  })
  describe('blades: 바깥 호·안쪽 호·곧은 변·모서리', () => {
    const s0 = 100
    const w = 600
    const rIn = 4000
    const rOut = 12000
    const h = hz({ s: 'blades', x: 1000, y: 2000, rIn, rOut, n: 3, w }, fixedAngle(s0))
    const ox = 1000
    const oy = 2000
    it('바깥 호(조각마다)', () => {
      for (let i = 0; i < 3; i++) {
        const mid = s0 + Math.floor((i * TURN) / 3) + w / 2
        for (const a of [mid - 200, mid, mid + 200]) {
          expect(hitAt(h, circ(...polar(a, rOut + c + TOL, ox, oy), c))).toBe(false)
          expect(hitAt(h, circ(...polar(a, rOut + c - TOL, ox, oy), c))).toBe(true)
        }
      }
    })
    it('안쪽 호', () => {
      const mid = s0 + w / 2
      expect(hitAt(h, circ(...polar(mid, rIn - c - TOL, ox, oy), c))).toBe(false)
      expect(hitAt(h, circ(...polar(mid, rIn - c + TOL, ox, oy), c))).toBe(true)
    })
    it('곧은 변(시작 변·끝 변, 빈 각 쪽으로 수직)', () => {
      for (const [edge, out] of [
        [s0, s0 - TURN / 4],
        [s0 + w, s0 + w + TURN / 4],
      ]) {
        const [ex, ey] = polar(edge, 8000, ox, oy)
        expect(hitAt(h, circ(...polar(out, c + TOL, ex, ey), c))).toBe(false)
        expect(hitAt(h, circ(...polar(out, c - TOL, ex, ey), c))).toBe(true)
      }
    })
    it('바깥 모서리(대각선)', () => {
      for (const [edge, out] of [
        [s0, s0 - TURN / 8],
        [s0 + w, s0 + w + TURN / 8],
      ]) {
        const [ex, ey] = polar(edge, rOut, ox, oy)
        expect(hitAt(h, circ(...polar(out, c + TOL, ex, ey), c))).toBe(false)
        expect(hitAt(h, circ(...polar(out, c - TOL, ex, ey), c))).toBe(true)
      }
    })
    it('차대 캡슐: 바깥 호 위·곧은 변 옆', () => {
      const top = hz({ s: 'blades', x: 0, y: 0, rIn: 0, rOut, n: 1, w: TURN / 4 }, fixedAngle(TURN / 8)) // 45°~135°
      const half = WHEELBASE / 2
      for (const shift of [0, 700, -1500]) {
        expect(hitAt(top, caps(shift - half, rOut + BODY_R + TOL, shift + half, rOut + BODY_R + TOL, BODY_R))).toBe(false)
        expect(hitAt(top, caps(shift - half, rOut + BODY_R - TOL, shift + half, rOut + BODY_R - TOL, BODY_R))).toBe(true)
      }
      // 135° 변 바깥쪽(왼쪽 아래)으로 변에 평행한 차대
      const out = TURN / 8 + TURN / 4 + TURN / 4 // 225°: 변(135°)에 수직, 빈 각 쪽
      for (const d of [BODY_R + TOL, BODY_R - TOL]) {
        const [ax, ay] = polar(TURN / 8 + TURN / 4, 3000)
        const [bx, by] = polar(TURN / 8 + TURN / 4, 9000)
        const [px, py] = polar(out, d)
        expect(hitAt(top, caps(ax + px, ay + py, bx + px, by + py, BODY_R))).toBe(d < BODY_R)
      }
    })
  })
})

describe('차대 캡슐 (설계 §5.1)', () => {
  // 뒷바퀴 (0, 0), 앞바퀴 (WHEELBASE, 0), 차체 판정원은 가운데 위 HEAD_OFFSET
  const circles = [
    { x: 0, y: 0, r: WHEEL_R },
    { x: WHEELBASE, y: 0, r: WHEEL_R },
    { x: WHEELBASE / 2, y: HEAD_OFFSET, r: HEAD_R },
  ]
  const car: Probe = { circles, capsule: { x0: 0, y0: BODY_DY, x1: WHEELBASE, y1: BODY_DY, r: BODY_R } } // 차대 캡슐은 윗방향으로 BODY_DY 올라 있다
  const circlesOnly: Probe = { circles, capsule: FAR }
  it('두 바퀴 사이로 지나가는 가는 세로 막대: 원은 안 겹치고 캡슐이 겹친다', () => {
    const spear = hz({ s: 'bar', x0: WHEELBASE / 2, y0: -500 * MM, x1: WHEELBASE / 2, y1: 5 * MM, r: MM })
    expect(hitAt(spear, circlesOnly)).toBe(false)
    expect(hitAt(spear, car)).toBe(true)
  })
  it('차 그림의 등(뒤 데크)·보닛 높이도 캡슐이 잡는다', () => {
    for (const [x, y] of [[356, 284], [1090, 245]]) {
      const dot = hz({ s: 'disc', x: x * MM, y: y * MM, r: MM })
      expect(hitAt(dot, circlesOnly), `(${x}, ${y})`).toBe(false)
      expect(hitAt(dot, car), `(${x}, ${y})`).toBe(true)
    }
  })
  it('캡슐 아래 끝은 바퀴 바닥(−WHEEL_R)보다 위다', () => {
    expect(BODY_DY - BODY_R).toBeGreaterThan(-WHEEL_R)
  })
  it('바퀴 사이 가로 레이저도 캡슐로 잡는다', () => {
    const laser = hz({ s: 'bar', x0: WHEELBASE / 2 - 100 * MM, y0: 0, x1: WHEELBASE / 2 + 100 * MM, y1: 0, r: MM })
    expect(hitAt(laser, circlesOnly)).toBe(false)
    expect(hitAt(laser, car)).toBe(true)
  })
  it('바퀴 사이로 들어온 작은 날도 캡슐로 잡는다', () => {
    const blade = hz({ s: 'blades', x: WHEELBASE / 2, y: -1500, rIn: 0, rOut: 1000, n: 1, w: TURN / 4 }, fixedAngle(TURN / 8)) // 위쪽 날
    expect(hitAt(blade, circlesOnly)).toBe(false)
    expect(hitAt(blade, car)).toBe(true)
  })
})

describe('pop 창', () => {
  const pop: Motion = { k: 'pop', period: 120, phase: 0, hide: 40, rise: 10, up: 40, fall: 30, height: 1000 * MM }
  const spear = hz({ s: 'bar', x0: 0, y0: 0, x1: 0, y1: 0, r: 20 * MM }, pop)
  it('숨음이면 shapeAt null이고 닿지 않는다(바닥에 겹쳐도)', () => {
    const T = subtick(10, 0)
    expect(shapeAt(spear, T)).toBeNull()
    expect(hitAt(spear, circ(0, 8000, 500), T)).toBe(false)
    expect(hitAt(spear, circ(0, 0, 500), T)).toBe(false)
  })
  it('솟으면 끝점 1만 (0, extension)만큼 올라가 닿는다', () => {
    const T = subtick(60, 0) // 서 있음
    expect(shapeAt(spear, T)).toEqual({ s: 'bar', x0: 0, y0: 0, x1: 0, y1: 1000 * MM, r: 20 * MM })
    expect(hitAt(spear, circ(0, 8000, 500), T)).toBe(true)
  })
  it('솟는 중에는 높이만큼만 닿는다', () => {
    const T = (40 + 5) * S // 솟음 절반
    const sh = shapeAt(spear, T)
    expect(sh).toEqual({ s: 'bar', x0: 0, y0: 0, x1: 0, y1: 500 * MM, r: 20 * MM })
    expect(hitAt(spear, circ(0, 500 * MM + 20 * MM + 499, 500), T)).toBe(true)
    expect(hitAt(spear, circ(0, 500 * MM + 20 * MM + 501, 500), T)).toBe(false)
  })
})

describe('shapeAt', () => {
  it('swing은 도형 전체를 옮긴다', () => {
    const h = hz({ s: 'disc', x: 0, y: 0, r: 1000 }, { k: 'swing', ax: 6000, ay: -2000, period: 60, phase: 0 })
    expect(shapeAt(h, 30 * S)).toEqual({ s: 'disc', x: 6000, y: -2000, r: 1000 })
    const b = hz({ s: 'bar', x0: 0, y0: 0, x1: 100, y1: 0, r: 5 }, { k: 'swing', ax: 6000, ay: 0, period: 60, phase: 0 })
    expect(shapeAt(b, 30 * S)).toEqual({ s: 'bar', x0: 6000, y0: 0, x1: 6100, y1: 0, r: 5 })
  })
  it('blades는 중심만 옮기고 회전은 bladeAngles로 꺼낸다', () => {
    const h = hz({ s: 'blades', x: 10, y: 20, rIn: 1, rOut: 2000, n: 2, w: 100 }, { k: 'swing', ax: 300, ay: 0, period: 10, phase: 0 })
    expect(shapeAt(h, 5 * S)).toEqual({ s: 'blades', x: 310, y: 20, rIn: 1, rOut: 2000, n: 2, w: 100 })
  })
  it('rotate bar는 (x0, y0) 둘레로 돈다', () => {
    const h = hz({ s: 'bar', x0: 100, y0: 100, x1: 10100, y1: 100, r: 5 }, fixedAngle(TURN / 4))
    const sh = shapeAt(h, 0)
    expect(sh).toMatchObject({ s: 'bar', x0: 100, y0: 100 })
    if (sh === null || sh.s !== 'bar') throw new Error('bar')
    expect(Math.abs(sh.x1 - 100)).toBeLessThanOrEqual(1)
    expect(Math.abs(sh.y1 - 10100)).toBeLessThanOrEqual(1)
  })
})

describe('hazardBox', () => {
  function extent(sh: HazardShape): { x0: number; y0: number; x1: number; y1: number } {
    if (sh.s === 'disc') return { x0: sh.x - sh.r, y0: sh.y - sh.r, x1: sh.x + sh.r, y1: sh.y + sh.r }
    if (sh.s === 'blades') return { x0: sh.x - sh.rOut, y0: sh.y - sh.rOut, x1: sh.x + sh.rOut, y1: sh.y + sh.rOut }
    return {
      x0: Math.min(sh.x0, sh.x1) - sh.r,
      y0: Math.min(sh.y0, sh.y1) - sh.r,
      x1: Math.max(sh.x0, sh.x1) + sh.r,
      y1: Math.max(sh.y0, sh.y1) + sh.r,
    }
  }
  it('swing 끝점을 덮는다', () => {
    const h = hz({ s: 'disc', x: 0, y: 0, r: 1000 }, { k: 'swing', ax: 6000, ay: -2000, period: 60, phase: 0 })
    expect(hazardBox(h)).toEqual({ x0: -1000, y0: -3000, x1: 7000, y1: 1000 })
  })
  it('blades는 중심 ± rOut(전 원)', () => {
    const h = hz({ s: 'blades', x: 500, y: -500, rIn: 100, rOut: 8000, n: 2, w: 300 }, { k: 'rotate', a0: 0, w: 5 })
    expect(hazardBox(h)).toEqual({ x0: -7500, y0: -8500, x1: 8500, y1: 7500 })
  })
  const cases: [string, Hazard, number][] = [
    ['swing disc', hz({ s: 'disc', x: 0, y: 0, r: 1000 }, { k: 'swing', ax: 6000, ay: -2000, period: 37, phase: 3 }), 37],
    ['swing blades', hz({ s: 'blades', x: 0, y: 0, rIn: 0, rOut: 3000, n: 3, w: 300 }, { k: 'swing', ax: -5000, ay: 7000, period: 41, phase: 0 }), 41],
    ['rotate bar', hz({ s: 'bar', x0: 300, y0: -200, x1: 7300, y1: 4800, r: 160 }, { k: 'rotate', a0: 0, w: 31 }), 400],
    ['pop bar', hz({ s: 'bar', x0: 0, y0: 0, x1: 0, y1: 0, r: 320 }, { k: 'pop', period: 60, phase: 7, hide: 20, rise: 10, up: 20, fall: 10, height: 9000 }), 60],
  ]
  for (const [name, h, period] of cases) {
    it(`${name}: 한 주기 동안 도형이 상자 안`, () => {
      const box = hazardBox(h)
      for (let T = 0; T <= period * S; T++) {
        const sh = shapeAt(h, T)
        if (sh === null) continue
        const e = extent(sh)
        expect(e.x0, `T=${T}`).toBeGreaterThanOrEqual(box.x0)
        expect(e.y0, `T=${T}`).toBeGreaterThanOrEqual(box.y0)
        expect(e.x1, `T=${T}`).toBeLessThanOrEqual(box.x1)
        expect(e.y1, `T=${T}`).toBeLessThanOrEqual(box.y1)
      }
    })
  }
})

describe('정수', () => {
  it('무작위 도형·시각에서 shapeAt·bladeAngles·hazardBox가 정수', () => {
    let seed = 12345
    const rnd = (n: number): number => {
      seed = (seed * 48271) % 2147483647
      return seed % n
    }
    for (let i = 0; i < 300; i++) {
      const h = hz(
        { s: 'blades', x: rnd(100000) - 50000, y: rnd(100000) - 50000, rIn: rnd(1000), rOut: 1000 + rnd(9000), n: 1 + rnd(4), w: 1 + rnd(1000) },
        { k: 'rotate', a0: rnd(TURN), w: rnd(41) - 20 },
      )
      const T = rnd(100000)
      const sh = shapeAt(h, T)
      for (const v of Object.values(sh ?? {})) if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true)
      for (const a of bladeAngles(h, T)) expect(Number.isInteger(a)).toBe(true)
      for (const v of Object.values(hazardBox(h))) expect(Number.isInteger(v)).toBe(true)
    }
  })
})
