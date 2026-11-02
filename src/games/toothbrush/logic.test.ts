import { describe, expect, it } from 'vitest'
import { rngFromSeed } from '../../shared/rng.ts'
import type { Ctx } from '../types.ts'
import {
  DEC_FAST, DEC_OPT, DEC_SLOW, FAST_D2, H, R, SLOW_D2, SWITCH_TICKS, TOTAL_TICKS, W, ZONE_COUNT, ZONE_TOTAL,
} from './constants.ts'
import { toothCells } from './mask.ts'
import { generatePuzzle, puzzleKey, type Puzzle } from './generate.ts'
import { logic, MAX_SAMPLES, type Action, type State } from './logic.ts'

const ctx: Ctx = { now: 0, startedAt: 0, deadline: null }
const TOTAL = ZONE_TOTAL.reduce((a, b) => a + b, 0)

/** 모든 치아 칸 두께가 v인 퍼즐 */
function toothPuzzle(v: number): Puzzle {
  const zones: number[][] = []
  for (let z = 0; z < ZONE_COUNT; z++) {
    const a = new Array<number>(W * H).fill(0)
    for (const i of toothCells(z)) a[i] = v
    zones.push(a)
  }
  return { zones }
}
/** 격자 전체(치아 아닌 칸 포함)가 v인 퍼즐 — 가장자리 자르기 확인용 */
function fullPuzzle(v: number): Puzzle {
  return { zones: Array.from({ length: ZONE_COUNT }, () => new Array<number>(W * H).fill(v)) }
}

const runner = (p: Puzzle) => (s: State, a: unknown): State => {
  const r = logic.apply(p, s, a as Action, ctx)
  if ('error' in r) throw new Error(r.error)
  return r.state
}
const errOf = (p: Puzzle, s: State, a: unknown): string => {
  const r = logic.apply(p, s, a as Action, ctx)
  if (!('error' in r)) throw new Error('expected error')
  return r.error
}
const b = (...pts: [number, number][]) => ({ type: 'b' as const, s: pts.flat() })
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const idx = (c: number, r: number) => r * W + c

// 구역 0 왼쪽 위 가운데 앞니 끝(아랫니와 맞물린 곳) 칸 (20, 14)의 중심 (칫솔 29칸이 모두 치아 칸)
const X = 205
const Y = 145

/** 칸 (cx, cy) 칫솔 범위 칸 목록 (격자 안만) */
function footprint(cx: number, cy: number): number[] {
  const out: number[] = []
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R * R) continue
    const c = cx + dx, r = cy + dy
    if (c < 0 || c >= W || r < 0 || r >= H) continue
    out.push(idx(c, r))
  }
  return out
}

/** 1틱 닦고 구역 1로 옮긴 뒤 대기 30틱을 (X, Y)에서 끝낸 상태 (구역 1 확인은 격자 전체 퍼즐로) */
function afterCooldownAtCenter(p: Puzzle): State {
  const run = runner(p)
  let s = run(logic.initState(p, ctx), b([X, Y]))
  s = run(s, { type: 'z', zone: 1 })
  const pts: [number, number][] = []
  for (let k = 0; k < SWITCH_TICKS - 1; k++) pts.push(k % 2 === 0 ? [105, 165] : [305, 165])
  pts.push([X, Y])
  return run(s, b(...pts))
}

describe('toothbrush logic', () => {
  it('opt_band_removes_4_per_cell', () => {
    const p = toothPuzzle(100)
    const run = runner(p)
    const s0 = logic.initState(p, ctx)
    const s1 = run(s0, b([X, Y]))
    const s2 = run(s1, b([X + 3, Y])) // d² = 9
    const fp = footprint(20, 14)
    expect(fp.length).toBe(29)
    for (const i of fp) {
      expect(s1.zones[0][i]).toBe(100 - DEC_SLOW)
      expect(s2.zones[0][i]).toBe(100 - DEC_SLOW - DEC_OPT)
    }
    const removed1 = sum(s0.zones[0]) - sum(s1.zones[0])
    const removed2 = sum(s1.zones[0]) - sum(s2.zones[0])
    expect(removed1).toBe(29 * DEC_SLOW)
    expect(removed2).toBe(29 * DEC_OPT)
    expect(s2.removed).toBe(removed1 + removed2)
    expect(s2.gumTicks).toBe(0)
    expect(s2.ticks).toBe(2)
  })

  it('fast_band_counts_gum', () => {
    const p = toothPuzzle(100)
    const run = runner(p)
    const s0 = logic.initState(p, ctx)
    // d² = 900 = 30²
    const f = run(s0, b([X, Y], [X + 30, Y]))
    expect(FAST_D2).toBe(900)
    expect(f.gumTicks).toBe(1)
    expect(f.removed).toBe(29 * DEC_SLOW + 29 * DEC_FAST)
    // 899는 두 정수 제곱의 합이 아니므로, 900 미만에서 만들 수 있는 가장 큰 값 898 = 27² + 13²
    const o = run(s0, b([X, Y], [X + 27, Y + 13]))
    expect(o.gumTicks).toBe(0)
    expect(o.removed).toBe(29 * DEC_SLOW + 29 * DEC_OPT)
  })

  it('slow_band_boundary', () => {
    const p = toothPuzzle(100)
    const run = runner(p)
    const s0 = logic.initState(p, ctx)
    expect(SLOW_D2).toBe(4)
    // 3은 두 정수 제곱의 합이 아니므로 4 미만의 최대값 2 = 1² + 1²
    expect(run(s0, b([X, Y], [X + 1, Y + 1])).removed).toBe(29 * DEC_SLOW * 2)
    // d² = 4
    expect(run(s0, b([X, Y], [X + 2, Y])).removed).toBe(29 * DEC_SLOW + 29 * DEC_OPT)
  })

  it('no_contact_resets_prev', () => {
    const p = toothPuzzle(100)
    const run = runner(p)
    const s = run(logic.initState(p, ctx), b([X, Y], [-1, -1], [X + 20, Y]))
    expect(s.ticks).toBe(3)
    expect(s.removed).toBe(29 * DEC_SLOW * 2) // 셋째 틱은 d² = 0(느림)
    expect(s.gumTicks).toBe(0)
    expect(s.prev).toEqual([X + 20, Y])
    const s2 = run(s, b([-1, -1]))
    expect(s2.prev).toBeNull()
    expect(s2.removed).toBe(s.removed)
    expect(s2.ticks).toBe(4)
  })

  it('cooldown_updates_prev_without_cleaning', () => {
    const p = fullPuzzle(100)
    const run = runner(p)
    let s = run(logic.initState(p, ctx), b([X, Y]))
    s = run(s, { type: 'z', zone: 1 })
    expect(s.cooldown).toBe(SWITCH_TICKS)
    const before = structuredClone(s)
    const pts: [number, number][] = []
    for (let k = 0; k < SWITCH_TICKS - 1; k++) pts.push(k % 2 === 0 ? [105, 165] : [305, 165])
    const mid = run(s, b(...pts))
    expect(mid.cooldown).toBe(1)
    const end = run(mid, b([X, Y]))
    expect(end.cooldown).toBe(0)
    expect(end.zones).toEqual(before.zones)
    expect(end.gumTicks).toBe(before.gumTicks)
    expect(end.removed).toBe(before.removed)
    expect(end.ticks).toBe(before.ticks + SWITCH_TICKS)
    expect(end.prev).toEqual([X, Y])
    // 31번째 틱: 대기 마지막 틱의 prev 기준 d² = 4 → 최적
    const t31 = run(end, b([X + 2, Y]))
    expect(t31.removed - end.removed).toBe(29 * DEC_OPT)
    for (const i of footprint(20, 14)) expect(t31.zones[1][i]).toBe(100 - DEC_OPT)
  })

  it('clips_at_grid_edge', () => {
    const p = fullPuzzle(10)
    const run = runner(p)
    const s = run(logic.initState(p, ctx), b([5, 5]))
    expect(footprint(0, 0).length).toBe(11)
    expect(s.removed).toBe(11 * DEC_SLOW)
    const s2 = run(s, b([475, 315]))
    expect(s2.removed).toBe(22 * DEC_SLOW)
    expect(sum(s2.zones[0])).toBe(W * H * 10 - 22 * DEC_SLOW)
  })

  it('never_negative', () => {
    const p = fullPuzzle(2)
    const run = runner(p)
    const s = afterCooldownAtCenter(p)
    const t = run(s, b([X + 3, Y])) // 최적
    for (const i of footprint(20, 14)) expect(t.zones[1][i]).toBe(0)
    expect(t.removed - s.removed).toBe(29 * 2)
    expect(Math.min(...t.zones[1])).toBe(0)
  })

  it('finishes_at_3600_and_ignores_extra', () => {
    const p = toothPuzzle(255)
    const run = runner(p)
    const full = Array.from({ length: MAX_SAMPLES }, () => [X, Y] as [number, number])
    let s = logic.initState(p, ctx)
    const perAction = TOTAL_TICKS / MAX_SAMPLES
    for (let k = 0; k < perAction; k++) s = run(s, b(...full))
    expect(s.ticks).toBe(TOTAL_TICKS)
    expect(logic.isFinished(s, ctx)).toBe(true)
    expect(errOf(p, s, b([X, Y]))).toBe('이미 끝났어요')
    expect(errOf(p, s, { type: 'z', zone: 1 })).toBe('이미 끝났어요')
    expect(errOf(p, s, { type: 'give_up' })).toBe('이미 끝났어요')
    expect(errOf(p, s, { type: 'nope' })).toBe('이미 끝났어요')

    // 남은 틱 10일 때 30샘플: 앞 10개만
    let t = logic.initState(p, ctx)
    for (let k = 0; k < perAction - 1; k++) t = run(t, b(...full))
    t = run(t, b(...full.slice(0, MAX_SAMPLES - 10)))
    expect(TOTAL_TICKS - t.ticks).toBe(10)
    const pts: [number, number][] = []
    for (let k = 0; k < 10; k++) pts.push([X, Y])
    for (let k = 10; k < MAX_SAMPLES; k++) pts.push(k % 2 === 0 ? [405, 165] : [407, 165])
    const before = t
    const u = run(t, b(...pts))
    expect(u.ticks).toBe(TOTAL_TICKS)
    for (const i of footprint(40, 16)) expect(u.zones[0][i]).toBe(255)
    expect(u.removed - before.removed).toBe(sum(before.zones[0]) - sum(u.zones[0]))
    expect(u.prev).toEqual([X, Y])
  })

  it('full_clean_does_not_end_early', () => {
    const p = toothPuzzle(0)
    const s = runner(p)(logic.initState(p, ctx), b([X, Y]))
    expect(logic.isFinished(s, ctx)).toBe(false)
    expect(logic.score(s, ctx)).toBe(0)
  })

  it('give_up_ends', () => {
    const p = toothPuzzle(100)
    const run = runner(p)
    const s0 = logic.initState(p, ctx)
    expect(run(s0, { type: 'give_up' }).ticks).toBe(TOTAL_TICKS)
    const s1 = run(run(s0, b([X, Y])), { type: 'give_up' })
    expect(s1.ticks).toBe(TOTAL_TICKS)
    expect(logic.isFinished(s1, ctx)).toBe(true)
    expect(s1.removed).toBe(29 * DEC_SLOW)
  })

  it('zone_switch_rules', () => {
    const p = toothPuzzle(100)
    const run = runner(p)
    const s0 = logic.initState(p, ctx)
    expect(errOf(p, s0, { type: 'z', zone: 1 })).toBe('먼저 닦기 시작하세요')
    const s1 = run(s0, b([X, Y]))
    for (const zone of [0, -1, 6, 1.5, '1', undefined])
      expect(errOf(p, s1, { type: 'z', zone })).toBe('옮길 수 없는 구역이에요')
    const s2 = run(s1, { type: 'z', zone: 3 })
    expect(s2.zone).toBe(3)
    expect(s2.switches).toBe(s1.switches + 1)
    expect(s2.cooldown).toBe(SWITCH_TICKS)
    expect(s2.prev).toBeNull()
    expect(s2.ticks).toBe(s1.ticks)
    expect(s2.zones).toEqual(s1.zones)
    expect(logic.actionCount(s2)).toBe(1)
  })

  it('invalid_brush_actions', () => {
    const p = toothPuzzle(100)
    const s = runner(p)(logic.initState(p, ctx), b([X, Y]))
    const copy = structuredClone(s)
    const bad: unknown[] = [
      { type: 'b', s: [] },
      { type: 'b', s: new Array(2 * (MAX_SAMPLES + 1)).fill(5) },
      { type: 'b', s: [5, 5, 5] },
      { type: 'b', s: [480, 5] },
      { type: 'b', s: [5, -2] },
      { type: 'b', s: [-1, 5] },
      { type: 'b', s: [5, 320] },
      { type: 'b', s: [2.5, 5] },
      { type: 'b', s: ['5', 5] },
      { type: 'b', s: [NaN, 5] },
      { type: 'b' },
      { type: 'b', s: 'abc' },
      { type: 'x' },
    ]
    for (const a of bad) expect(errOf(p, s, a)).toBe('잘못된 입력이에요')
    expect(s).toEqual(copy)
    // 경계 안쪽 값은 허용
    expect(runner(p)(s, b([479, 319], [0, 0], [-1, -1])).ticks).toBe(s.ticks + 3)
    expect(runner(p)(s, { type: 'b', s: new Array(2 * MAX_SAMPLES).fill(5) }).ticks).toBe(s.ticks + MAX_SAMPLES)
  })

  it('apply_does_not_mutate_input', () => {
    const p = generatePuzzle(rngFromSeed(new Uint8Array(16).fill(3)))
    const pCopy = structuredClone(p)
    const s0 = logic.initState(p, ctx)
    expect(s0.zones).toEqual(p.zones)
    s0.zones[0][idx(20, 16)] = 999
    expect(p.zones[0][idx(20, 16)]).toBe(pCopy.zones[0][idx(20, 16)])
    const run = runner(p)
    const s = run(logic.initState(p, ctx), b([X, Y], [X + 3, Y]))
    const copy = structuredClone(s)
    const n1 = run(s, b([X + 6, Y], [X + 9, Y + 20]))
    const n2 = run(s, { type: 'z', zone: 2 })
    run(s, { type: 'give_up' })
    expect(s).toEqual(copy)
    expect(p).toEqual(pCopy)
    // 바뀌지 않은 구역 배열은 공유해도 되지만 바뀐 구역은 새 배열
    expect(n1.zones[0]).not.toBe(s.zones[0])
    expect(n1.zones).not.toBe(s.zones)
    expect(n2.zones).toEqual(s.zones)
  })

  it('score_formula', () => {
    const p = toothPuzzle(0)
    const base = logic.initState(p, ctx)
    const sc = (removed: number, gumTicks: number) => logic.score({ ...base, removed, gumTicks }, ctx)
    expect(sc(TOTAL, 0)).toBe(10)
    expect(sc(Math.floor(TOTAL / 2), 0)).toBe(5)
    // 0.01점 단위: ⌊(1000r + ⌊T/2⌋) / T⌋. 5.00이 되는 최소 removed: r ≥ ⌈(500T − ⌊T/2⌋) / 1000⌉
    const edge = Math.ceil((500 * TOTAL - Math.floor(TOTAL / 2)) / 1000)
    expect(sc(edge, 0)).toBe(5)
    expect(sc(edge - 1, 0)).toBe(4.99)
    // 소수 둘째 자리까지 나온다
    const r837 = Math.ceil((837 * TOTAL - Math.floor(TOTAL / 2)) / 1000)
    expect(sc(r837, 0)).toBe(8.37)
    // 잇몸: 1초(60틱)마다 0.1점
    expect(sc(TOTAL, 59)).toBe(10)
    expect(sc(TOTAL, 60)).toBe(9.9)
    expect(sc(r837, 120)).toBe(8.17)
    expect(sc(0, 600)).toBe(0)
    expect(sc(0, 0)).toBe(0)
  })

  it('clean_by_zone_floors', () => {
    const p = generatePuzzle(rngFromSeed(new Uint8Array(16).fill(1)))
    const s = logic.initState(p, ctx)
    const z0 = new Array<number>(W * H).fill(0)
    z0[toothCells(0)[0]] = 1
    const zones = [z0, ...s.zones.slice(1)]
    zones[2] = new Array<number>(W * H).fill(0)
    const ps = logic.publicState({ ...s, zones })
    expect(ps.cleanByZone[0]).toBe(Math.floor((100 * (ZONE_TOTAL[0] - 1)) / ZONE_TOTAL[0]))
    expect(ps.cleanByZone[0]).toBe(99)
    expect(ps.cleanByZone[1]).toBe(0)
    expect(ps.cleanByZone[2]).toBe(100)
  })

  it('public_state_shape', () => {
    const p = generatePuzzle(rngFromSeed(new Uint8Array(16).fill(2)))
    const s0 = logic.initState(p, ctx)
    const ps0 = logic.publicState(s0)
    expect(Object.keys(ps0).sort()).toEqual(
      ['cleanByZone', 'cooldown', 'gumTicks', 'started', 'ticksLeft', 'zone', 'zones'].sort(),
    )
    expect(ps0).toMatchObject({ zone: 0, ticksLeft: TOTAL_TICKS, cooldown: 0, gumTicks: 0, started: false })
    expect(ps0.cleanByZone).toEqual(new Array(ZONE_COUNT).fill(0))
    expect(ps0.zones).toEqual(p.zones)
    const s1 = runner(p)(s0, b([X, Y], [X + 2, Y]))
    const ps1 = logic.publicState(s1)
    expect(ps1.started).toBe(true)
    expect(ps1.ticksLeft).toBe(TOTAL_TICKS - 2)
  })

  it('contract_basics', () => {
    expect(logic.version).toBe(4)
    const p = logic.pickPuzzle(rngFromSeed(new Uint8Array(16).fill(4)), {})
    expect(p).toEqual(generatePuzzle(rngFromSeed(new Uint8Array(16).fill(4))))
    expect(logic.puzzleKey(p)).toBe(puzzleKey(p))
    expect(logic.reveal(p)).toBeNull()
    const s = logic.initState(p, ctx)
    expect(s).toMatchObject({ zone: 0, ticks: 0, cooldown: 0, prev: null, gumTicks: 0, switches: 0, removed: 0 })
    expect(logic.actionCount(s)).toBe(0)
  })

  it('deterministic_replay', () => {
    const p = generatePuzzle(rngFromSeed(new Uint8Array(16).fill(5)))
    const play = () => {
      const rng = rngFromSeed(new Uint8Array(16).fill(9))
      let s = logic.initState(p, ctx)
      for (let k = 0; k < 300; k++) {
        let a: Action
        if (rng() < 0.1) a = { type: 'z', zone: Math.floor(rng() * ZONE_COUNT) }
        else {
          const n = 1 + Math.floor(rng() * MAX_SAMPLES)
          const pts: number[] = []
          for (let j = 0; j < n; j++) {
            if (rng() < 0.05) pts.push(-1, -1)
            else pts.push(Math.floor(rng() * 480), Math.floor(rng() * 320))
          }
          a = { type: 'b', s: pts }
        }
        const r = logic.apply(p, s, a, ctx)
        if ('state' in r) s = r.state
      }
      return s
    }
    const a = play()
    const c = play()
    expect(a).toEqual(c)
    expect(a.ticks).toBeGreaterThan(0)
    expect(a.removed).toBeGreaterThan(0)
    let left = 0
    for (const z of a.zones) left += sum(z)
    expect(left + a.removed).toBe(TOTAL)
  })
})
