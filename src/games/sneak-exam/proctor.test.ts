import { describe, expect, it } from 'vitest'
import { AISLE_X, FRONT_Z, ROW_Z, SUSP_WATCH, WATCH_AISLE_X, PROCTORS } from './constants.ts'
import { initProctor, stepProctor } from './proctor.ts'
import type { Proctor } from './proctor.ts'

const TYPES = [0, 1, 2] as const
const TICKS = 7200

function run(seed: number, type: 0 | 1 | 2, ticks: number, susp: number): Proctor[] {
  let p = initProctor()
  let rng = seed >>> 0
  const out: Proctor[] = [p]
  for (let i = 0; i < ticks; i++) {
    const s = stepProctor(p, rng, type, susp)
    p = s.p
    rng = s.rng
    out.push(p)
  }
  return out
}

const seeds = Array.from({ length: 20 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0)
const inAisle = (x: number) => (AISLE_X as readonly number[]).includes(x)

describe('proctor', () => {
  it('starts in front with the grace timer', () => {
    expect(initProctor()).toEqual({ x: 0, z: FRONT_Z, face: 0, mode: 'front', dozing: false, timer: 120, tx: 0, tz: FRONT_Z, relooked: false })
  })

  it('stays on the graph', () => {
    for (const type of TYPES)
      for (const seed of seeds)
        for (const p of run(seed, type, TICKS, 0)) {
          expect(inAisle(p.x) || p.z === FRONT_Z).toBe(true)
          expect(p.z >= ROW_Z[0] && p.z <= FRONT_Z).toBe(true)
          for (const v of [p.x, p.z, p.face, p.timer, p.tx, p.tz]) expect(Number.isInteger(v)).toBe(true)
        }
  })

  it('stops in aisles only at row centers', () => {
    for (const type of TYPES)
      for (const seed of seeds)
        for (const p of run(seed, type, TICKS, 0))
          if (p.mode === 'look') {
            expect(inAisle(p.x)).toBe(true)
            expect((ROW_Z as readonly number[]).includes(p.z)).toBe(true)
          }
  })

  it('faces the way it walks', () => {
    for (const type of TYPES)
      for (const seed of seeds) {
        const t = run(seed, type, TICKS, 0)
        for (let i = 1; i < t.length; i++) {
          const a = t[i - 1], b = t[i]
          if (b.mode !== 'walk' || (a.x === b.x && a.z === b.z)) continue
          const face = b.z < a.z ? 0 : b.z > a.z ? 1 : b.x < a.x ? 2 : 3
          expect(b.face).toBe(face)
        }
      }
  })

  it('moves at the type speed', () => {
    for (const type of TYPES)
      for (const seed of seeds) {
        const t = run(seed, type, TICKS, 0)
        const speed = PROCTORS[type].speed
        for (let i = 1; i < t.length; i++) {
          const a = t[i - 1], b = t[i]
          if (a.mode !== 'walk') continue
          const d = Math.abs(b.x - a.x) + Math.abs(b.z - a.z)
          expect(d).toBeLessThanOrEqual(speed)
          // 구간(모서리·목표)에 닿은 틱은 남은 거리만큼만 움직인다.
          const segmentEnd = b.x === a.tx || b.z === a.tz || b.z === FRONT_Z
          if (b.mode === 'walk' && !segmentEnd) expect(d).toBe(speed)
        }
      }
  })

  it('only the drowsy type dozes', () => {
    for (const type of TYPES) {
      let dozed = false
      for (const seed of seeds) for (const p of run(seed, type, TICKS, 0)) if (p.dozing) dozed = true
      expect(dozed).toBe(type === 2)
    }
  })

  it('heads to my aisle when suspicion is high', () => {
    for (const type of TYPES)
      for (const seed of seeds) {
        const t = run(seed, type, 1000, SUSP_WATCH)
        const ok = t.some(
          (p) =>
            p.mode === 'look' &&
            (WATCH_AISLE_X as readonly number[]).includes(p.x) &&
            p.z === ROW_Z[0] &&
            p.face === (p.x === 0 ? 3 : 2),
        )
        expect(ok).toBe(true)
      }
  })

  it('is deterministic', () => {
    for (const type of TYPES) expect(run(12345, type, 1000, 0)).toEqual(run(12345, type, 1000, 0))
  })

  it('does not mutate its input', () => {
    const p = Object.freeze(initProctor())
    expect(() => stepProctor(p, 1, 0, 0)).not.toThrow()
    const q = Object.freeze({ ...initProctor(), timer: 1 })
    expect(() => stepProctor(q, 1, 2, 0)).not.toThrow()
  })
})
