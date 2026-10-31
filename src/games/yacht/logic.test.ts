import { describe, expect, test } from 'vitest'
import { logic } from './logic.ts'
import type { YAction, YState } from './logic.ts'
import { allowed, CATEGORIES, scoreFor, total } from './scoring.ts'
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

/** 한 턴: 한 번 굴리고 timeoutActions의 점수 행동 대신 첫 허용 칸에 적는다 */
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

describe('timeout_actions', () => {
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
  test('before rolling: roll then best score; applying passes the turn', () => {
    const s = logic.init(seeded(20), {})
    const acts = logic.timeoutActions(s, seeded(21))
    expect(acts).toHaveLength(2)
    expect(acts[0]).toEqual({ type: 'roll', keep: [] })
    expect(acts[1].type).toBe('score')
    const rng = seeded(21)
    let st = s
    for (const a of acts) st = ok(logic.apply(st, st.seat, a, rng))
    expect(st.seat).toBe(1)
    expect(st.dice).toEqual([])
    expect(logic.turnNo(st)).toBe(1)
    expect((acts[1] as { category: Category }).category).toBe(
      best(
        ok(logic.apply(s, 0, roll(), seeded(21))).dice,
        s.sheets[0],
      ),
    )
  })
  test('after rolling: only the best score', () => {
    const rng = seeded(22)
    const s = ok(logic.apply(logic.init(rng, {}), 0, roll(), rng))
    const acts = logic.timeoutActions(s, rng)
    expect(acts).toEqual([score(best(s.dice, s.sheets[0]))])
    expect(ok(logic.apply(s, 0, acts[0], rng)).seat).toBe(1)
  })
  test('tie goes to earlier category in CATEGORIES order', () => {
    // [1,1,1,1,1]-like tie: choice(5)=aces(5)=threeKind(5)=fourKind(5) -> actually yacht 50 wins; use [1,2,3,3,6]
    const s: YState = {
      sheets: [{}, {}],
      bonus: [0, 0],
      seat: 0,
      dice: [6, 6, 1, 2, 3],
      rolls: 1,
    }
    // sixes=12, choice=18 -> choice; make a real tie: [2,2,2,2,2] w/o yacht impossible; use [1,1,1,1,2]: aces=4
    const t: YState = { ...s, dice: [2, 2, 1, 1, 1] }
    // aces 3, twos 4, choice 7, threeKind 7, fullHouse 25 -> fullHouse; block it
    const u: YState = { ...t, sheets: [{ fullHouse: 0, yacht: 0 }, {}] }
    // choice 7 vs threeKind 7 tie -> choice (earlier)
    expect(logic.timeoutActions(u, seeded(1))).toEqual([score('choice')])
  })
  test('joker: picks only within allowed', () => {
    const s: YState = {
      sheets: [{ yacht: 50 }, {}],
      bonus: [0, 0],
      seat: 0,
      dice: [1, 1, 1, 1, 1],
      rolls: 2,
    }
    expect(logic.timeoutActions(s, seeded(1))).toEqual([score('aces')])
    const s2: YState = { ...s, sheets: [{ yacht: 50, aces: 5 }, {}] }
    const a = logic.timeoutActions(s2, seeded(1))
    expect(a).toEqual([score('largeStraight')])
    expect(allowed(s2.dice, s2.sheets[0])).toContain('largeStraight')
  })
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
