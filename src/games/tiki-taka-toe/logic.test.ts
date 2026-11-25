import { describe, expect, test } from 'vitest'
import { logic } from './logic.ts'
import type { Action, Prepared, State } from './logic.ts'
import { manifest } from './manifest.ts'

const rng = () => 0.5
const hdr = (p: string, i: number) => ({ id: `${p}${i}`, kind: 'club', label: `${p}라벨${i}` })
const prepared: Prepared = {
  puzzle_id: 'pz1',
  rows: [0, 1, 2].map((i) => hdr('r', i)),
  cols: [0, 1, 2].map((i) => hdr('c', i)),
  answers: Array.from({ length: 9 }, (_, k) => [`P${k}`, `S${k}`, 'X']),
  examples: Array.from({ length: 9 }, (_, k) => [`예시${k}`]),
}
const fresh = () => logic.init(rng, { theme: 'eur' }, prepared)
const guess = (cell: number, playerId: string, extra: Partial<Action> = {}): Action =>
  ({ type: 'guess', cell, playerId, name: `N-${playerId}`, ...extra }) as Action
function step(s: State, seat: 0 | 1, a: Action): State {
  const r = logic.apply(s, seat, a, rng)
  if ('error' in r) throw new Error(r.error)
  return r.state
}
const err = (s: State, seat: 0 | 1, a: Action) => {
  const r = logic.apply(s, seat, a, rng)
  return 'error' in r ? r.error : null
}
const pass: Action = { type: 'pass' }

describe('tiki-taka-toe logic', () => {
  test('init throws without valid prepared', () => {
    expect(() => logic.init(rng, {}, undefined)).toThrow()
    expect(() => logic.init(rng, {}, { puzzle_id: 'x' })).toThrow()
    expect(() => logic.init(rng, {}, { ...prepared, answers: [] })).toThrow()
  })

  test('manifest', () => {
    expect(manifest.id).toBe('tiki-taka-toe')
    expect(manifest.hidden).toBe(true)
    expect(manifest.duel?.prepare).toBe('ttt_pick_puzzle')
  })

  test('correct_claims_and_passes_turn', () => {
    expect(logic.toMove(fresh())).toBe(0)
    const s = step(fresh(), 0, guess(0, 'P0'))
    const v = logic.view(s, 0)
    expect(v.cells[0]).toEqual({ owner: 0, name: 'N-P0' })
    expect(logic.toMove(s)).toBe(1)
    expect(v.last?.correct).toBe(true)
    expect(logic.turnNo(s)).toBe(1)
  })

  test('wrong_passes_turn', () => {
    const s = step(fresh(), 0, guess(0, 'P5'))
    const v = logic.view(s, 0)
    expect(v.cells[0].owner).toBeNull()
    expect(logic.toMove(s)).toBe(1)
    expect(v.last?.correct).toBe(false)
  })

  test('reuse_rejected', () => {
    let s = step(fresh(), 0, guess(0, 'X'))
    expect(err(s, 1, guess(1, 'X'))).not.toBeNull()
    expect(logic.toMove(s)).toBe(1)
    // 틀린 답으로 낸 선수는 다시 낼 수 있다
    s = step(fresh(), 0, guess(0, 'P5'))
    s = step(s, 1, guess(1, 'P5'))
    s = step(s, 0, guess(5, 'P5'))
    expect(logic.view(s, 0).cells[5].owner).toBe(0)
  })

  test('steal_counts', () => {
    let s = step(fresh(), 0, guess(0, 'P0'))
    expect(logic.view(s, 0).steals).toEqual([5, 6])
    s = step(s, 1, guess(0, 'S0'))
    let v = logic.view(s, 0)
    expect(v.cells[0]).toEqual({ owner: 1, name: 'N-S0' })
    expect(v.steals).toEqual([5, 5])
    expect(v.last?.steal).toBe(true)
    // 틀려도 소모
    s = step(s, 0, guess(0, 'P5'))
    v = logic.view(s, 0)
    expect(v.cells[0].owner).toBe(1)
    expect(v.steals).toEqual([4, 5])
  })

  test('invalid_moves', () => {
    let s = fresh()
    s.steals = [0, 0]
    s = step(s, 0, guess(0, 'P0'))
    const before = JSON.stringify(s)
    expect(err(s, 1, guess(0, 'S0'))).not.toBeNull() // 스틸 0
    expect(err(s, 1, guess(9, 'P0'))).not.toBeNull()
    expect(err(s, 1, guess(-1, 'P0'))).not.toBeNull()
    let t = step(fresh(), 0, guess(0, 'P0'))
    t = step(t, 1, pass)
    expect(err(t, 0, guess(0, 'S0'))).not.toBeNull() // 내 칸
    expect(err(t, 1, guess(1, 'P1'))).not.toBeNull() // 내 차례 아님
    expect(JSON.stringify(s)).toBe(before)
  })

  test('line_wins', () => {
    const play = (cells: number[]) => {
      let s = fresh()
      const others = [3, 5, 7, 8, 1, 0, 2, 4, 6].filter((c) => !cells.includes(c))
      for (let i = 0; i < cells.length; i++) {
        s = step(s, 0, guess(cells[i], `P${cells[i]}`))
        if (i < cells.length - 1) s = step(s, 1, pass)
      }
      void others
      return s
    }
    const r = logic.result(play([0, 1, 2]))
    expect(r).toMatchObject({ over: true, winner: 0 })
    expect(logic.result(play([2, 4, 6]))).toMatchObject({ over: true, winner: 0 })
    expect(logic.result(play([0, 1]))).toEqual({ over: false })
    expect(err(play([0, 1, 2]), 1, pass)).not.toBeNull()
  })

  test('full_board_draw', () => {
    // 줄 없이 9칸: 0 1 0 / 0 1 1 / 1 0 0 -> 확인: 좌석0 {0,2,3,7,8}, 좌석1 {1,4,5,6}
    const owners = [0, 1, 0, 0, 1, 1, 1, 0, 0]
    let s = fresh()
    // 번갈아 두되 좌석별 칸 순서를 맞춘다
    const q: [number[], number[]] = [[], []]
    owners.forEach((o, c) => q[o].push(c))
    // 좌석0 5칸, 좌석1 4칸: 0,1,0,1,... 순서
    for (let i = 0; i < 9; i++) {
      const seat = (i % 2) as 0 | 1
      const c = q[seat].shift()!
      s = step(s, seat, guess(c, `P${c}`))
    }
    expect(logic.view(s, 0).steals).toEqual([5, 6])
    expect(logic.result(s)).toEqual({ over: true, winner: null })
  })

  test('stalemate_six_quiet_turns', () => {
    let s = step(fresh(), 0, guess(0, 'P0')) // 소유 변화 -> quiet 0
    const seats: (0 | 1)[] = [1, 0, 1, 0, 1]
    for (const seat of seats) s = step(s, seat, pass)
    expect(logic.result(s)).toEqual({ over: false }) // 5번
    expect(logic.view(s, 0).quiet).toBe(5)
    s = step(s, 0, pass)
    expect(logic.result(s)).toEqual({ over: true, winner: 0 })
    // 같으면 무승부
    let t = fresh()
    t = step(t, 0, guess(0, 'P0'))
    t = step(t, 1, guess(1, 'P1'))
    for (const seat of [0, 1, 0, 1, 0, 1] as (0 | 1)[]) t = step(t, seat, pass)
    expect(logic.result(t)).toEqual({ over: true, winner: null })
  })

  test('draw_offer_rules', () => {
    let s = step(fresh(), 0, { type: 'pass', offerDraw: true })
    expect(logic.view(s, 1).drawOffer).toBe(0)
    expect(logic.result(step(s, 1, { type: 'acceptDraw' }))).toEqual({ over: true, winner: null })
    expect(err(fresh(), 0, { type: 'acceptDraw' })).not.toBeNull()
    // 내 자신 제안은 수락 못 함: 좌석 0 제안 뒤는 좌석 1 차례라 not_your_turn
    // 거절
    s = step(s, 1, pass)
    expect(logic.view(s, 0).drawOffer).toBeNull()
    expect(logic.view(s, 0).canOffer).toEqual([false, true])
    expect(err(s, 0, { type: 'pass', offerDraw: true })).not.toBeNull()
    expect(err(s, 0, guess(0, 'P0', { offerDraw: true }))).not.toBeNull()
    expect(err(s, 0, { type: 'acceptDraw' })).not.toBeNull()
    s = step(s, 0, pass)
    expect(logic.view(s, 0).canOffer).toEqual([true, true])
    s = step(s, 1, pass)
    s = step(s, 0, guess(0, 'P0', { offerDraw: true }))
    expect(logic.view(s, 0).drawOffer).toBe(0)
  })

  test('view_hides_answers_until_over', () => {
    let s = step(fresh(), 0, guess(0, 'P0', { name: '호날두' }))
    let v = logic.view(s, 1)
    expect(v.examples).toBeNull()
    expect(JSON.stringify(v)).not.toMatch(/P[0-9]|S[0-9]|"X"/)
    s = step(s, 1, { type: 'pass', offerDraw: true })
    s = step(s, 0, { type: 'acceptDraw' })
    v = logic.view(s, null)
    expect(v.examples).toEqual(prepared.examples)
  })

  test('timeout_is_pass', () => {
    const s = fresh()
    const a = logic.timeoutAction(s)
    expect(a).toEqual({ type: 'pass' })
    expect(logic.toMove(step(s, 0, a))).toBe(1)
  })
})
