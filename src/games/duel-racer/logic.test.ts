import { expect, test } from 'vitest'
import { MATCH_SECONDS, RACE_SECONDS, START_DELAY_SEC, TICK_HZ } from './constants.ts'
import { logic, type RacerReport, type RacerState } from './logic.ts'
import { manifest } from './manifest.ts'

const fresh = () => logic.init(() => 0, {})
function both(r0: RacerReport, r1: RacerReport): RacerState {
  const a = logic.report!(fresh(), 0, r0)
  if ('error' in a) throw new Error(a.error)
  const b = logic.report!(a.state, 1, r1)
  if ('error' in b) throw new Error(b.error)
  return b.state
}

test('init picks the first course with no reports', () => {
  expect(fresh()).toEqual({ course: 'neon-1', reports: [null, null] })
})

test('turn-based actions are refused', () => {
  expect(logic.apply(fresh(), 0, {} as never, () => 0)).toEqual({ error: 'realtime_only' })
})

test('report accepts ticks in (0, RACE_SECONDS*TICK_HZ] or null', () => {
  const max = RACE_SECONDS * TICK_HZ
  for (const my of [0, -1, 1.5, max + 1, '10', undefined]) {
    expect(logic.report!(fresh(), 0, { my, opp: null })).toEqual({ error: 'bad_report' })
  }
  for (const opp of [0, 1.5, max + 1, 'x']) {
    expect(logic.report!(fresh(), 0, { my: 100, opp })).toEqual({ error: 'bad_report' })
  }
  expect(logic.report!(fresh(), 0, null)).toEqual({ error: 'bad_report' })
  expect('state' in logic.report!(fresh(), 0, { my: max, opp: 1 })).toBe(true)
  expect('state' in logic.report!(fresh(), 0, { my: null, opp: null })).toBe(true)
  // opp 생략은 모름(null)으로
  const r = logic.report!(fresh(), 1, { my: 10 })
  expect('state' in r && r.state.reports[1]).toEqual({ my: 10, opp: null })
})

test('second report from the same seat is refused', () => {
  const a = logic.report!(fresh(), 0, { my: 100, opp: null })
  if ('error' in a) throw new Error()
  expect(logic.report!(a.state, 0, { my: 90, opp: null })).toEqual({ error: 'already_reported' })
})

test('shorter time wins when both agree', () => {
  expect(logic.result(both({ my: 4300, opp: 4500 }, { my: 4500, opp: 4300 }))).toEqual({ over: true, winner: 0, scores: [4300, 4500] })
  expect(logic.result(both({ my: 4600, opp: 4500 }, { my: 4500, opp: 4600 }))).toEqual({ over: true, winner: 1, scores: [4600, 4500] })
})

test('equal times draw', () => {
  expect(logic.result(both({ my: 4300, opp: 4300 }, { my: 4300, opp: 4300 }))).toEqual({ over: true, winner: null, scores: [4300, 4300] })
})

test('a finisher beats a DNF', () => {
  expect(logic.result(both({ my: 4300, opp: null }, { my: null, opp: 4300 }))).toEqual({ over: true, winner: 0, scores: [4300, 0] })
})

test('cross-check mismatch voids', () => {
  expect(logic.result(both({ my: 4300, opp: 4500 }, { my: 4500, opp: 4400 }))).toEqual({ over: true, winner: null, void: true })
  // 상대 기록을 모르면(opp null) 맞춰 보지 않는다
  expect(logic.result(both({ my: 4300, opp: null }, { my: null, opp: null }))).toEqual({ over: true, winner: 0, scores: [4300, 0] })
})

test('unknown opp (null) skips the cross-check', () => {
  expect(logic.result(both({ my: 4300, opp: null }, { my: 4500, opp: null }))).toEqual({ over: true, winner: 0, scores: [4300, 4500] })
})

test('both DNF voids', () => {
  expect(logic.result(both({ my: null, opp: null }, { my: null, opp: null }))).toEqual({ over: true, winner: null, void: true })
})

test('reportTimeout is a DNF with unknown opp', () => {
  expect(logic.reportTimeout!(fresh())).toEqual({ my: null, opp: null })
})

test('result is not over until both seats reported', () => {
  expect(logic.result(fresh())).toEqual({ over: false })
  const a = logic.report!(fresh(), 1, { my: 100, opp: null })
  if ('error' in a) throw new Error()
  expect(logic.result(a.state)).toEqual({ over: false })
  expect(logic.turnNo(a.state)).toBe(1)
})

test('manifest turnSeconds is the single MATCH_SECONDS choice and realtime.startDelaySec is START_DELAY_SEC', () => {
  expect(MATCH_SECONDS).toBe(245)
  expect(manifest.duel?.turnSeconds).toEqual({ choices: [MATCH_SECONDS], default: MATCH_SECONDS })
  expect(manifest.duel?.realtime).toEqual({ raceSeconds: RACE_SECONDS, startDelaySec: START_DELAY_SEC })
  expect(manifest.category).toBe('duel')
  expect(manifest.hidden).toBe(true)
  expect(manifest.duel?.sameScreen).toBe(false)
  expect(manifest.modes).toEqual({ daily: false, contest: false, free: false })
  expect(logic.version).toBe(2)
})
