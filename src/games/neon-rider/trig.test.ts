import { describe, expect, it } from 'vitest'
import { TRIG_ONE, TURN, angDiff, atan2T, cosT, isqrt, sinT } from './trig.ts'

// 결정적 의사난수 (테스트 재현성)
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

describe('sinT / cosT', () => {
  it('기준값', () => {
    expect(TURN).toBe(4096)
    expect(TRIG_ONE).toBe(16384)
    expect(sinT(0)).toBe(0)
    expect(sinT(1024)).toBe(16384)
    expect(sinT(-1024)).toBe(-16384)
    expect(sinT(2048)).toBe(0)
    expect(cosT(0)).toBe(16384)
    expect(cosT(2048)).toBe(-16384)
  })
  it('주기성과 음수·큰 값', () => {
    for (const a of [0, 1, 17, 1023, 1500, 4095]) {
      expect(sinT(a + 4096)).toBe(sinT(a))
      expect(sinT(a - 4096 * 3)).toBe(sinT(a))
      expect(cosT(a + 8192)).toBe(cosT(a))
    }
  })
  it('모든 각에서 Math.sin 오차 1 이내', () => {
    for (let a = 0; a < TURN; a++) {
      const want = Math.round(TRIG_ONE * Math.sin((2 * Math.PI * a) / TURN))
      expect(Math.abs(sinT(a) - want)).toBeLessThanOrEqual(1)
      const wantC = Math.round(TRIG_ONE * Math.cos((2 * Math.PI * a) / TURN))
      expect(Math.abs(cosT(a) - wantC)).toBeLessThanOrEqual(1)
    }
  })
})

describe('isqrt', () => {
  it('기준값', () => {
    expect(isqrt(0)).toBe(0)
    expect(isqrt(1)).toBe(1)
    expect(isqrt(15)).toBe(3)
    expect(isqrt(16)).toBe(4)
    const r = isqrt(2 ** 52 - 1)
    expect(r * r).toBeLessThanOrEqual(2 ** 52 - 1)
    expect((r + 1) * (r + 1)).toBeGreaterThan(2 ** 52 - 1)
  })
  it('무작위 1000개', () => {
    const rand = rng(7)
    for (let i = 0; i < 1000; i++) {
      const n = Math.floor(rand() * 2 ** (1 + Math.floor(rand() * 51)))
      const r = isqrt(n)
      expect(r * r).toBeLessThanOrEqual(n)
      expect((r + 1) * (r + 1)).toBeGreaterThan(n)
    }
  })
  it('음수·정수 아님·NaN·무한대는 RangeError (무한 루프 대신)', () => {
    for (const n of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => isqrt(n)).toThrow(RangeError)
    }
  })
  it('완전제곱 경계', () => {
    for (const r of [2, 3, 1000, 2 ** 25, 2 ** 26 - 1]) {
      expect(isqrt(r * r)).toBe(r)
      expect(isqrt(r * r - 1)).toBe(r - 1)
    }
  })
})

describe('atan2T', () => {
  it('축 방향', () => {
    expect(atan2T(0, 1)).toBe(0)
    expect(atan2T(1, 0)).toBe(1024)
    expect(atan2T(0, -1)).toBe(2048)
    expect(atan2T(-1, 0)).toBe(3072)
    expect(atan2T(0, 0)).toBe(0)
  })
  it('대각선', () => {
    expect(atan2T(5, 5)).toBe(512)
    expect(atan2T(5, -5)).toBe(1536)
    expect(atan2T(-5, -5)).toBe(2560)
    expect(atan2T(-5, 5)).toBe(3584)
  })
  it('무작위 방향에서 Math.atan2 오차 1 이내', () => {
    const rand = rng(11)
    for (let i = 0; i < 5000; i++) {
      const mag = 2 ** (1 + Math.floor(rand() * 24))
      const dy = Math.floor((rand() * 2 - 1) * mag)
      const dx = Math.floor((rand() * 2 - 1) * mag)
      if (dy === 0 && dx === 0) continue
      const exact = (Math.atan2(dy, dx) * TURN) / (2 * Math.PI)
      const want = Math.round(exact + TURN) % TURN
      const got = atan2T(dy, dx)
      expect(got).toBeGreaterThanOrEqual(0)
      expect(got).toBeLessThan(TURN)
      expect(Math.abs(angDiff(got, want))).toBeLessThanOrEqual(1)
    }
  })
  it('큰 입력(2^25)에서도 정수·범위·결정적', () => {
    const big = 2 ** 25
    expect(atan2T(big, big)).toBe(512)
    expect(atan2T(-big, 1)).toBe(3072)
    expect(atan2T(1, -big)).toBe(2048 - atan2T(1, big))
    for (const [y, x] of [[big, 3], [3, big], [-big + 1, big - 7], [12345678, -33554431]]) {
      const v = atan2T(y, x)
      expect(Number.isInteger(v)).toBe(true)
      expect(atan2T(y, x)).toBe(v)
    }
  })
})

describe('angDiff', () => {
  it('(-TURN/2, TURN/2]로 접는다', () => {
    expect(angDiff(10, 4090)).toBe(16)
    expect(angDiff(4090, 10)).toBe(-16)
    expect(angDiff(2048, 0)).toBe(2048)
    expect(angDiff(0, 2048)).toBe(2048)
    expect(angDiff(0, 0)).toBe(0)
    expect(angDiff(5000, -5000)).toBe(angDiff(5000 + 5000 + 4096 * 5, 0))
  })
})
