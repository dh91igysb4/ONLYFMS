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
// 매 틱 검사는 일반 조건으로 하고, 첫 실패만 기록해 한 번 assert한다.
function firstFailure(check: (p: Proctor, prev: Proctor, type: 0 | 1 | 2) => string | null): string | null {
  for (const type of TYPES)
    for (const seed of seeds) {
      const t = run(seed, type, TICKS, 0)
      for (let i = 1; i < t.length; i++) {
        const msg = check(t[i], t[i - 1], type)
        if (msg) return `type ${type} seed ${seed} tick ${i}: ${msg} ${JSON.stringify(t[i])}`
      }
    }
  return null
}

const inAisle = (x: number) => (AISLE_X as readonly number[]).includes(x)

describe('proctor', () => {
  it('starts in front with the grace timer', () => {
    expect(initProctor()).toEqual({ x: 0, z: FRONT_Z, face: 0, mode: 'front', dozing: false, timer: 120, tx: 0, tz: FRONT_Z, relooked: false })
  })

  it('stays on the graph', () => {
    const fail = firstFailure((p) => {
      if (!(inAisle(p.x) || p.z === FRONT_Z)) return 'off graph'
      if (!(p.z >= ROW_Z[0] && p.z <= FRONT_Z)) return 'z out of range'
      for (const v of [p.x, p.z, p.face, p.timer, p.tx, p.tz]) if (!Number.isInteger(v)) return 'non-integer'
      return null
    })
    expect(fail).toBeNull()
  })

  it('stops in aisles only at row centers', () => {
    const fail = firstFailure((p) =>
      p.mode === 'look' && !(inAisle(p.x) && (ROW_Z as readonly number[]).includes(p.z)) ? 'look off row center' : null,
    )
    expect(fail).toBeNull()
  })

  it('faces the way it walks', () => {
    const fail = firstFailure((b, a) => {
      if (b.mode !== 'walk' || (a.x === b.x && a.z === b.z)) return null
      const face = b.z < a.z ? 0 : b.z > a.z ? 1 : b.x < a.x ? 2 : 3
      return b.face === face ? null : `face ${b.face} want ${face}`
    })
    expect(fail).toBeNull()
  })

  it('moves at the type speed', () => {
    const fail = firstFailure((b, a, type) => {
      if (a.mode !== 'walk') return null
      // 현재 구간에 남은 거리(구현과 따로 쓴 같은 규칙)
      const remaining = a.x === a.tx ? Math.abs(a.tz - a.z) : a.z === FRONT_Z ? Math.abs(a.tx - a.x) : FRONT_Z - a.z
      const d = Math.abs(b.x - a.x) + Math.abs(b.z - a.z)
      const want = Math.min(PROCTORS[type].speed, remaining)
      return d === want ? null : `moved ${d} want ${want}`
    })
    expect(fail).toBeNull()
  })

  it('only the drowsy type dozes', () => {
    for (const type of TYPES) {
      let dozed = false
      for (const seed of seeds) if (run(seed, type, TICKS, 0).some((p) => p.dozing)) dozed = true
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
