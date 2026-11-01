import { describe, expect, test } from 'vitest'
import { compare, initialsOf, logic, MAX_GUESSES, snapshotOf } from './logic.ts'
import type { Puzzle, Snapshot, State } from './logic.ts'
import { LEAGUES, PLAYERS, TEAMS } from './data.ts'
import { manifest } from './manifest.ts'

const ctx = { now: 0, startedAt: 0, deadline: null }

function ok(r: { state: State } | { error: string }): State {
  if ('error' in r) throw new Error(r.error)
  return r.state
}

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

const byName = (name: string): Snapshot => {
  const row = PLAYERS.find((p) => p[1] === name)
  if (!row) throw new Error(`no player ${name}`)
  return snapshotOf(row[0])!
}

/** 손으로 만든 스냅샷 (데이터와 무관) */
function snap(over: Partial<Snapshot>): Snapshot {
  return {
    id: 1, name: 'Test Player', team: 'Team A', teamCode: 'TA', league: 0, leagueName: 'Premier League',
    leagueKo: '프리미어리그', cc: 'KOR', cn: 'South Korea', pos: 'ST', grp: 'FW', age: 25, shirt: 9,
    ...over,
  }
}

// 정답과 겹치지 않는 실제 선수 id들 (정답 팀·국적과 무관하게 골라도 판정 규칙 테스트에는 지장 없음)
const ANSWER = byName('Erling Haaland')
const P: Puzzle = { answer: ANSWER, tier: 'easy', league: 'all' }
const others = PLAYERS.filter((p) => p[0] !== ANSWER.id).map((p) => p[0])
const init = () => logic.initState(P, ctx)
const guess = (s: State, id: unknown, puzzle: Puzzle = P) => logic.apply(puzzle, s, { type: 'guess', id } as never, ctx)
function wrong(n: number, s: State = init()): State {
  for (let i = 0; i < n; i++) s = ok(guess(s, others[i]))
  return s
}

describe('who-are-ya compare', () => {
  const a = snap({})
  test('club: same team c, same league p, else a', () => {
    expect(compare(snap({ team: 'Team A' }), a).team).toBe('c')
    expect(compare(snap({ team: 'Team B' }), a).team).toBe('p')
    expect(compare(snap({ team: 'Team B', league: 1, leagueName: 'LaLiga' }), a).team).toBe('a')
  })
  test('nationality and position group', () => {
    expect(compare(snap({ cc: 'KOR' }), a).nat).toBe('c')
    expect(compare(snap({ cc: 'JPN' }), a).nat).toBe('a')
    expect(compare(snap({ grp: 'FW', pos: 'LW' }), a).pos).toBe('c')
    expect(compare(snap({ grp: 'MF' }), a).pos).toBe('a')
  })
  test('age/shirt: equal c, ▲ if answer larger, ▼ if smaller, null → a without arrow', () => {
    let f = compare(snap({ age: 25, shirt: 9 }), a)
    expect([f.age, f.ageArrow, f.shirt, f.shirtArrow]).toEqual(['c', '', 'c', ''])
    f = compare(snap({ age: 20, shirt: 30 }), a)
    expect([f.age, f.ageArrow, f.shirt, f.shirtArrow]).toEqual(['a', '▲', 'a', '▼'])
    f = compare(snap({ age: null, shirt: null }), a)
    expect([f.age, f.ageArrow, f.shirt, f.shirtArrow]).toEqual(['a', '', 'a', ''])
    f = compare(snap({}), snap({ age: null, shirt: null }))
    expect([f.age, f.ageArrow, f.shirt, f.shirtArrow]).toEqual(['a', '', 'a', ''])
  })
  test('initials', () => {
    expect(initialsOf('Erling Haaland')).toBe('E. H.')
    expect(initialsOf('Vinícius  Júnior')).toBe('V. J.')
  })
})

describe('who-are-ya logic', () => {
  test('version and puzzleKey', () => {
    expect(logic.version).toBe(2)
    expect(logic.puzzleKey(P)).toBe(String(ANSWER.id))
  })

  test('guess stores looked-up attributes and server-side feedback', () => {
    const s = ok(guess(init(), others[0]))
    expect(s.guesses).toHaveLength(1)
    const g = s.guesses[0]
    expect(g.id).toBe(others[0])
    expect(g.fb).toEqual(compare(snapshotOf(others[0])!, ANSWER))
    expect(logic.isFinished(s, ctx)).toBe(false)
  })

  test('win on correct id; all tiles c', () => {
    const s = ok(guess(init(), ANSWER.id))
    expect(s.won).toBe(true)
    expect(logic.isFinished(s, ctx)).toBe(true)
    expect(s.guesses[0].fb).toEqual({ team: 'c', nat: 'c', pos: 'c', age: 'c', ageArrow: '', shirt: 'c', shirtArrow: '' })
  })

  test('score table', () => {
    const winAt = (n: number, hintAt?: number) => {
      let s = init()
      for (let i = 0; i < n - 1; i++) {
        s = ok(guess(s, others[i]))
        if (hintAt !== undefined && i + 1 === hintAt) s = ok(logic.apply(P, s, { type: 'hint' }, ctx))
      }
      s = ok(guess(s, ANSWER.id))
      expect(s.guesses).toHaveLength(n)
      return logic.score(s, ctx)
    }
    expect(winAt(1)).toBe(10)
    expect(winAt(4)).toBe(10)
    expect(winAt(5)).toBe(8)
    expect(winAt(8)).toBe(8)
    expect(winAt(4, 3)).toBe(7) // 3번 틀린 뒤 힌트, 4번째에 정답
    expect(winAt(6, 3)).toBe(5)
  })

  test('loss after 8 wrong, give up, unfinished all score 0', () => {
    const lost = wrong(MAX_GUESSES)
    expect(logic.isFinished(lost, ctx)).toBe(true)
    expect(lost.won).toBe(false)
    expect(logic.score(lost, ctx)).toBe(0)
    expect(logic.actionCount(lost)).toBe(8)

    const mid = wrong(2)
    expect(logic.isFinished(mid, ctx)).toBe(false)
    expect(logic.score(mid, ctx)).toBe(0)
    expect(logic.actionCount(mid)).toBe(2)
    const gave = ok(logic.apply(P, mid, { type: 'give_up' }, ctx))
    expect(gave.gaveUp).toBe(true)
    expect(logic.isFinished(gave, ctx)).toBe(true)
    expect(logic.score(gave, ctx)).toBe(0)
  })

  test('hint gating: <3 wrong error, once only, reveals initials', () => {
    expect(logic.apply(P, init(), { type: 'hint' }, ctx)).toHaveProperty('error')
    expect(logic.apply(P, wrong(2), { type: 'hint' }, ctx)).toHaveProperty('error')
    const s = ok(logic.apply(P, wrong(3), { type: 'hint' }, ctx))
    expect(s.initials).toBe('E. H.')
    expect(logic.publicState(s).initials).toBe('E. H.')
    expect(logic.apply(P, s, { type: 'hint' }, ctx)).toHaveProperty('error')
    // 힌트는 추측 수에 들어가지 않는다
    expect(logic.actionCount(s)).toBe(3)
  })

  test('errors: duplicate, unknown id, non-integer, unknown action, after finish', () => {
    const s = ok(guess(init(), others[0]))
    expect(guess(s, others[0])).toHaveProperty('error')
    expect(guess(s, 987654321)).toHaveProperty('error')
    expect(guess(s, String(others[1]))).toHaveProperty('error')
    expect(guess(s, 1.5)).toHaveProperty('error')
    expect(logic.apply(P, s, { type: 'nope' } as never, ctx)).toHaveProperty('error')
    const done = ok(guess(s, ANSWER.id))
    expect(guess(done, others[2])).toHaveProperty('error')
    expect(logic.apply(P, done, { type: 'hint' }, ctx)).toHaveProperty('error')
    expect(logic.apply(P, done, { type: 'give_up' }, ctx)).toHaveProperty('error')
    const lost = wrong(MAX_GUESSES)
    expect(guess(lost, ANSWER.id)).toHaveProperty('error')
  })

  test('publicState never contains the answer id or name (unfinished, hinted, lost, gave up)', () => {
    const states = [init(), wrong(1), ok(logic.apply(P, wrong(3), { type: 'hint' }, ctx)), wrong(MAX_GUESSES)]
    states.push(ok(logic.apply(P, wrong(2), { type: 'give_up' }, ctx)))
    for (const s of states) {
      const json = JSON.stringify(logic.publicState(s))
      expect(json).not.toContain(ANSWER.name)
      expect(json).not.toContain(String(ANSWER.id))
    }
    expect(logic.reveal(P)).toEqual(ANSWER)
  })

  test('pickPuzzle respects tier/league filters and defaults', () => {
    const tierOf = (id: number) => PLAYERS.find((p) => p[0] === id)![9]
    for (let seed = 1; seed <= 40; seed++) {
      const e = logic.pickPuzzle(seeded(seed), { tier: 'easy', league: 'all' })
      expect(tierOf(e.answer.id)).toBe(1)
      const n = logic.pickPuzzle(seeded(seed), { tier: 'normal', league: 'laliga' })
      expect(tierOf(n.answer.id)).toBeLessThanOrEqual(2)
      expect(n.answer.leagueName).toBe('LaLiga')
      expect(n.tier).toBe('normal')
      expect(n.league).toBe('laliga')
      const d = logic.pickPuzzle(seeded(seed), {})
      expect(d.tier).toBe('easy')
      expect(d.league).toBe('all')
      expect(tierOf(d.answer.id)).toBe(1)
    }
    // 어려움은 티어 3까지 나온다
    const hardTiers = new Set(
      Array.from({ length: 60 }, (_, i) => tierOf(logic.pickPuzzle(seeded(i + 1), { tier: 'hard' }).answer.id)),
    )
    expect(hardTiers.has(3)).toBe(true)
    // 잘못된 값은 기본값
    const bad = logic.pickPuzzle(seeded(3), { tier: 'x', league: 'y' })
    expect([bad.tier, bad.league]).toEqual(['easy', 'all'])
  })

  test('pickPuzzle is deterministic for a given rng and stores a full snapshot', () => {
    const a = logic.pickPuzzle(seeded(42), { tier: 'hard', league: 'all' })
    const b = logic.pickPuzzle(seeded(42), { tier: 'hard', league: 'all' })
    expect(a).toEqual(b)
    expect(a.answer).toEqual(snapshotOf(a.answer.id))
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })

  test('old puzzle: answer absent from current data still plays (compares against the snapshot)', () => {
    const real = snapshotOf(others[0])!
    const gone = snap({ id: 999_999_999, name: 'Retired Legend', team: real.team, teamCode: real.teamCode,
      league: real.league, leagueName: real.leagueName, leagueKo: real.leagueKo, cc: real.cc, grp: real.grp, age: 40, shirt: 99 })
    expect(snapshotOf(gone.id)).toBeUndefined()
    const OLD: Puzzle = { answer: gone, tier: 'easy', league: 'all' }
    let s = logic.initState(OLD, ctx)
    s = ok(guess(s, real.id, OLD))
    expect(s.guesses[0].fb.team).toBe('c')
    expect(s.guesses[0].fb.nat).toBe('c')
    expect(s.guesses[0].fb.pos).toBe('c')
    s = ok(guess(s, others[1], OLD))
    s = ok(guess(s, others[2], OLD))
    s = ok(logic.apply(OLD, s, { type: 'hint' }, ctx))
    expect(s.initials).toBe('R. L.')
    expect(logic.reveal(OLD)).toEqual(gone)
  })

  test('winning row is all green even if the answer moved club or aged since the puzzle was made', () => {
    const now = snapshotOf(others[0])!
    const then = { ...now, team: 'Old Club', teamCode: 'OLD', age: (now.age ?? 20) - 1 }
    const OLD: Puzzle = { answer: then, tier: 'easy', league: 'all' }
    const s = ok(guess(logic.initState(OLD, ctx), now.id, OLD))
    expect(s.won).toBe(true)
    expect(s.guesses[0].fb).toEqual(compare(then, then))
    expect(s.guesses[0].team).toBe('Old Club')
  })
})

describe('who-are-ya data & manifest', () => {
  test('data integrity', () => {
    expect(PLAYERS.length).toBeGreaterThan(2000)
    expect(new Set(PLAYERS.map((p) => p[0])).size).toBe(PLAYERS.length)
    for (const p of PLAYERS) {
      expect(TEAMS[p[2]]).toBeDefined()
      expect(['GK', 'DF', 'MF', 'FW']).toContain(p[6])
      expect([1, 2, 3]).toContain(p[9])
    }
    expect(TEAMS.some((t) => t[0] === 'Fulham')).toBe(true)
  })

  test('manifest league choices match data leagues', () => {
    const league = manifest.options.find((o) => o.key === 'league')!
    expect(league.choices.map((c) => c.value)).toEqual(['all', ...LEAGUES.map((l) => l[0])])
    expect(league.choices.slice(1).map((c) => c.label)).toEqual(LEAGUES.map((l) => l[2]))
    const tier = manifest.options.find((o) => o.key === 'tier')!
    expect(tier.choices.map((c) => c.value)).toEqual(['easy', 'normal', 'hard'])
    expect(tier.default).toBe('easy')
    expect(league.default).toBe('all')
  })
})
