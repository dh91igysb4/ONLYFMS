import { describe, expect, test } from 'vitest'
import { logic } from './logic.ts'
import type { YAction, YState } from './logic.ts'
import { allowed, CATEGORIES, rawScore, scoreFor, total } from './scoring.ts'
import type { Category } from './scoring.ts'
import { manifest } from './manifest.ts'
import { duels, getDuel, getGame } from '../index.ts'

/** 결정적 난수 (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function ok(r: { state: YState } | { error: string }): YState {
  if ('error' in r) throw new Error(r.error)
  return r.state
}
const roll = (keep: number[] = []): YAction => ({ type: 'roll', keep })
const score = (category: Category): YAction => ({ type: 'score', category })

/** 한 턴: 한 번 굴리고 첫 허용 칸에 적는다 */
function playTurn(s: YState, rng: () => number): YState {
  let st = ok(logic.apply(s, s.seat, roll(), rng))
  const cat = allowed(st.dice, st.sheets[st.seat])[0]
  st = ok(logic.apply(st, st.seat, score(cat), rng))
  return st
}

function playAll(seed: number): YState {
  const rng = seeded(seed)
  let s = logic.init(rng, {})
  while (!logic.result(s).over) s = playTurn(s, rng)
  return s
}

describe('registry', () => {
  test('yacht is a hidden duel, not a solo game', () => {
    expect(manifest.id).toBe('yacht')
    expect(getDuel('yacht')?.logic).toBe(logic)
    expect(duels.map((d) => d.manifest.id)).toContain('yacht')
    expect(getGame('yacht')).toBeUndefined()
    expect(logic.version).toBe(1)
  })
})

describe('roll_rules', () => {
  test('first action cannot be score', () => {
    const s = logic.init(seeded(1), {})
    expect('error' in logic.apply(s, 0, score('choice'), seeded(1))).toBe(true)
  })
  test('fourth roll is an error', () => {
    const rng = seeded(2)
    let s = logic.init(rng, {})
    s = ok(logic.apply(s, 0, roll(), rng))
    s = ok(logic.apply(s, 0, roll([0]), rng))
    s = ok(logic.apply(s, 0, roll([0]), rng))
    expect(s.rolls).toBe(3)
    expect('error' in logic.apply(s, 0, roll([0]), rng)).toBe(true)
  })
  test('kept dice stay the same', () => {
    const rng = seeded(3)
    let s = ok(logic.apply(logic.init(rng, {}), 0, roll(), rng))
    const before = s.dice
    s = ok(logic.apply(s, 0, roll([0, 2, 4]), rng))
    expect([s.dice[0], s.dice[2], s.dice[4]]).toEqual([before[0], before[2], before[4]])
    expect(s.dice).toHaveLength(5)
    expect(s.dice.every((d) => d >= 1 && d <= 6)).toBe(true)
  })
  test('first roll keep must be empty', () => {
    const s = logic.init(seeded(4), {})
    expect('error' in logic.apply(s, 0, roll([0]), seeded(4))).toBe(true)
  })
  test('keep rejects out of range and duplicate indices', () => {
    const rng = seeded(5)
    const s = ok(logic.apply(logic.init(rng, {}), 0, roll(), rng))
    expect('error' in logic.apply(s, 0, roll([5]), rng)).toBe(true)
    expect('error' in logic.apply(s, 0, roll([-1]), rng)).toBe(true)
    expect('error' in logic.apply(s, 0, roll([1, 1]), rng)).toBe(true)
    expect('error' in logic.apply(s, 0, roll([1.5]), rng)).toBe(true)
  })
})

describe('turn_flow', () => {
  test('score switches seat and clears dice', () => {
    const rng = seeded(6)
    let s = ok(logic.apply(logic.init(rng, {}), 0, roll(), rng))
    const cat = allowed(s.dice, s.sheets[0])[0]
    s = ok(logic.apply(s, 0, score(cat), rng))
    expect(s.seat).toBe(1)
    expect(logic.toMove(s)).toBe(1)
    expect(s.dice).toEqual([])
    expect(s.rolls).toBe(0)
    expect(s.sheets[0][cat]).toBeDefined()
  })
  test('wrong seat is an error', () => {
    const s = logic.init(seeded(7), {})
    expect('error' in logic.apply(s, 1, roll(), seeded(7))).toBe(true)
  })
  test('filled or non-allowed category is an error', () => {
    const rng = seeded(8)
    let s = playTurn(logic.init(rng, {}), rng)
    s = playTurn(s, rng)
    // seat 0 again; sheet 0 has one filled box
    const filled = CATEGORIES.find((c) => s.sheets[0][c] !== undefined)!
    s = ok(logic.apply(s, 0, roll(), rng))
    expect('error' in logic.apply(s, 0, score(filled), rng)).toBe(true)
    expect('error' in logic.apply(s, 0, score('nope' as Category), rng)).toBe(true)
  })
})

test('same_seed_same_dice', () => {
  const run = () => {
    const rng = seeded(42)
    let s = logic.init(rng, {})
    s = ok(logic.apply(s, 0, roll(), rng))
    s = ok(logic.apply(s, 0, roll([1, 3]), rng))
    return s.dice
  }
  expect(run()).toEqual(run())
})

describe('game_end', () => {
  test('ends after 26 scores with totals', () => {
    const s = playAll(11)
    expect(logic.turnNo(s)).toBe(26)
    const r = logic.result(s)
    if (!r.over) throw new Error('not over')
    const t0 = total(s.sheets[0], s.bonus[0])
    const t1 = total(s.sheets[1], s.bonus[1])
    expect(r.scores).toEqual([t0, t1])
    expect(r.winner).toBe(t0 > t1 ? 0 : t1 > t0 ? 1 : null)
  })
  test('tie gives null winner; larger total wins', () => {
    const base = playAll(12)
    const tie: YState = { ...base, sheets: [base.sheets[0], { ...base.sheets[0] }], bonus: [base.bonus[0], base.bonus[0]] }
    expect(logic.result(tie)).toEqual({ over: true, winner: null, scores: [total(tie.sheets[0], tie.bonus[0]), total(tie.sheets[0], tie.bonus[0])] })
    const win1: YState = { ...tie, bonus: [0, 100] }
    const r = logic.result(win1)
    expect(r.over && r.winner).toBe(1)
  })
  test('not over mid-game; actions after end are errors', () => {
    const rng = seeded(13)
    expect(logic.result(logic.init(rng, {}))).toEqual({ over: false })
    const s = playAll(13)
    expect('error' in logic.apply(s, s.seat, roll(), rng)).toBe(true)
    expect('error' in logic.apply(s, s.seat, score('choice'), rng)).toBe(true)
  })
})

describe('timeout_action', () => {
  const best = (dice: number[], sheet: YState['sheets'][0]): Category => {
    let top: Category | null = null
    let topScore = -1
    for (const c of CATEGORIES) {
      if (!allowed(dice, sheet).includes(c)) continue
      const v = scoreFor(dice, c, sheet)
      if (v > topScore) {
        top = c
        topScore = v
      }
    }
    return top!
  }
  test('unrolled -> roll', () => {
    expect(logic.timeoutAction(logic.init(seeded(20), {}))).toEqual({ type: 'roll', keep: [] })
  })
  test('rolled -> best score', () => {
    const rng = seeded(22)
    const s = ok(logic.apply(logic.init(rng, {}), 0, roll(), rng))
    expect(logic.timeoutAction(s)).toEqual(score(best(s.dice, s.sheets[0])))
  })
  test('tie goes to earlier category in CATEGORIES order', () => {
    // choice 7 and threeKind 7 tie (fullHouse and yacht blocked) -> choice
    const u: YState = {
      sheets: [{ fullHouse: 0, yacht: 0 }, {}],
      bonus: [0, 0],
      seat: 0,
      dice: [2, 2, 1, 1, 1],
      rolls: 1,
    }
    expect(logic.timeoutAction(u)).toEqual(score('choice'))
  })
  test('joker: picks only within allowed', () => {
    const s: YState = { sheets: [{ yacht: 50 }, {}], bonus: [0, 0], seat: 0, dice: [1, 1, 1, 1, 1], rolls: 2 }
    expect(logic.timeoutAction(s)).toEqual(score('aces'))
    const s2: YState = { ...s, sheets: [{ yacht: 50, aces: 5 }, {}] }
    expect(logic.timeoutAction(s2)).toEqual(score('largeStraight'))
    expect(allowed(s2.dice, s2.sheets[0])).toContain('largeStraight')
  })
  test('loop with a different rng per action: always legal, turn ends within 2 applies', () => {
    for (let i = 0; i < 200; i++) {
      // half the runs start with yacht box filled so a rolled yacht triggers joker rules
      const start: YState = {
        ...logic.init(seeded(i), {}),
        sheets: [i % 2 ? { yacht: 50, fives: 10 } : {}, {}],
      }
      let s = start
      const before = logic.turnNo(s)
      for (let k = 0; k < 2; k++) {
        s = ok(logic.apply(s, s.seat, logic.timeoutAction(s), seeded(i * 7 + k + 1000)))
      }
      expect(logic.turnNo(s)).toBe(before + 1)
      expect(s.seat).toBe(1)
    }
  })
})

test('extra scoring cases', () => {
  expect(rawScore([1, 2, 2, 3, 4], 'smallStraight')).toBe(30)
  expect(rawScore([1, 1, 2, 2, 2], 'fullHouse')).toBe(25)
})

test('apply on finished game is an error', () => {
  const s = playAll(14)
  for (const seat of [0, 1] as const) {
    expect('error' in logic.apply(s, seat, roll(), seeded(1))).toBe(true)
  }
})

test('apply never throws on malformed input', () => {
  const rng = seeded(40)
  const s = ok(logic.apply(logic.init(rng, {}), 0, roll(), rng))
  const bad: unknown[] = [
    null,
    undefined,
    42,
    'roll',
    {},
    { type: 'dance' },
    { type: 'roll' },
    { type: 'roll', keep: 'abc' },
    { type: 'roll', keep: null },
    { type: 'roll', keep: [null] },
    { type: 'score' },
    { type: 'score', category: 7 },
    { type: 'score', category: 'nope' },
    { type: 'score', category: '__proto__' },
  ]
  for (const a of bad) {
    const r = logic.apply(s, 0, a as YAction, rng)
    expect('error' in r).toBe(true)
  }
})

test('turn_no', () => {
  const rng = seeded(30)
  let s = logic.init(rng, {})
  expect(logic.turnNo(s)).toBe(0)
  s = playTurn(s, rng)
  expect(logic.turnNo(s)).toBe(1)
})

test('yacht bonus is added on score', () => {
  const s: YState = {
    sheets: [{ yacht: 50 }, {}],
    bonus: [0, 0],
    seat: 0,
    dice: [4, 4, 4, 4, 4],
    rolls: 1,
  }
  const n = ok(logic.apply(s, 0, score('fours'), seeded(1)))
  expect(n.bonus[0]).toBe(100)
  expect(n.sheets[0].fours).toBe(20)
})

test('view is the state itself', () => {
  const s = logic.init(seeded(1), {})
  expect(logic.view(s, 0)).toEqual(s)
  expect(logic.view(s, null)).toEqual(s)
})

describe('kept_and_last', () => {
  test('kept: first roll [], later roll = keep, reset after score', () => {
    const rng = seeded(11)
    let s = logic.init(rng, {})
    expect(s.kept).toEqual([])
    expect(s.last).toBeNull()
    s = ok(logic.apply(s, 0, roll(), rng))
    expect(s.kept).toEqual([])
    s = ok(logic.apply(s, 0, roll([1, 3]), rng))
    expect(s.kept).toEqual([1, 3])
    s = ok(logic.apply(s, 0, roll([0]), rng))
    expect(s.kept).toEqual([0])
    const cat = allowed(s.dice, s.sheets[0])[0]
    s = ok(logic.apply(s, 0, score(cat), rng))
    expect(s.kept).toEqual([])
  })
  test('last set on score by seat and kept until next score', () => {
    const rng = seeded(12)
    let s = ok(logic.apply(logic.init(rng, {}), 0, roll(), rng))
    const c0 = allowed(s.dice, s.sheets[0])[0]
    s = ok(logic.apply(s, 0, score(c0), rng))
    expect(s.last).toEqual({ seat: 0, category: c0 })
    s = ok(logic.apply(s, 1, roll(), rng))
    expect(s.last).toEqual({ seat: 0, category: c0 })
    const c1 = allowed(s.dice, s.sheets[1])[0]
    s = ok(logic.apply(s, 1, score(c1), rng))
    expect(s.last).toEqual({ seat: 1, category: c1 })
  })
  test('old state without the fields still applies', () => {
    const old = { sheets: [{}, {}], bonus: [0, 0], seat: 0, dice: [], rolls: 0 } as unknown as YState
    const rng = seeded(13)
    let s = ok(logic.apply(old, 0, roll(), rng))
    expect(s.kept).toEqual([])
    s = ok(logic.apply(s, 0, roll([2]), rng))
    expect(s.kept).toEqual([2])
    const cat = allowed(s.dice, s.sheets[0])[0]
    s = ok(logic.apply(s, 0, score(cat), rng))
    expect(s.last).toEqual({ seat: 0, category: cat })
    expect(logic.timeoutAction(old)).toEqual({ type: 'roll', keep: [] })
  })
})
