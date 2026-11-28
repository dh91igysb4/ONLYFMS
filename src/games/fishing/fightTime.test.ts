// 서버 싸움 시간 검사(경제 설계 §6.1, v27): 챈 뒤 MAX_FIGHT_MS 넘은 성공은 놓친 것, PERFECT_MAX_MS 넘은 퍼펙트는 일반 포획.
import { describe, expect, it } from 'vitest'
import { MAX_FIGHT_MS, MIN_FIGHT_MS, PERFECT_MAX_MS } from './data.ts'
import { logic, type State } from './logic.ts'
import { conditionsAt } from './clock.ts'

const T0 = Date.UTC(2026, 10, 28, 3)
const HOOK = T0 + 3000
const hooked = (): State => ({
  ...logic.init(),
  pending: { species: 'anchovy', sizeCm: 12, biteDelayMs: 3000, startedAt: T0, hookedAt: HOOK, area: 'village', spot: 'shore', cond: conditionsAt(T0), power: 0.5 },
})
const resolve = (at: number, perfect: boolean) =>
  logic.apply(hooked(), { type: 'resolve', success: true, perfect }, { now: at, rng: () => 0.5, gold: 0 }) as { state: State; result: { caught: { perfect: boolean } | null; rejected?: string } }

describe('서버 싸움 시간 검사', () => {
  it('상수: 성공 최소 2초, 퍼펙트 상한 12초, 성공 상한 180초', () => {
    expect([MIN_FIGHT_MS, PERFECT_MAX_MS, MAX_FIGHT_MS]).toEqual([2000, 12_000, 180_000])
  })
  it('2초~12초 퍼펙트는 그대로, 12초 넘으면 일반 포획으로 낮춘다', () => {
    expect(resolve(HOOK + MIN_FIGHT_MS, true).result.caught?.perfect).toBe(true)
    expect(resolve(HOOK + PERFECT_MAX_MS, true).result.caught?.perfect).toBe(true)
    const late = resolve(HOOK + PERFECT_MAX_MS + 1, true)
    expect(late.result.caught?.perfect).toBe(false)
    expect(late.state.bag.at(-1)?.perfect).toBe(false)
  })
  it('180초까지 성공은 잡히고, 넘으면 놓친 것(가방·도감 그대로, pending 정리)', () => {
    expect(resolve(HOOK + MAX_FIGHT_MS, false).result.caught).not.toBe(null)
    const r = resolve(HOOK + MAX_FIGHT_MS + 1, false)
    expect(r.result).toEqual({ caught: null, rejected: 'fight_time' })
    expect([r.state.pending, r.state.bag, r.state.dex]).toEqual([null, [], {}])
  })
})
