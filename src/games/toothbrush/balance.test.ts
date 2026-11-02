import { describe, expect, test } from 'vitest'
import { playBot, SCRIBBLE_DX, STILL_POINT, type BotKind } from './bots.ts'
import { CELL, FAST_D2, W } from './constants.ts'
import { isTooth } from './mask.ts'

const SEEDS = Array.from({ length: 20 }, (_, k) => new Uint8Array(16).fill(k + 1))

const cache = new Map<BotKind, number[]>()
function scores(kind: BotKind): number[] {
  let s = cache.get(kind)
  if (!s) {
    s = SEEDS.map((seed) => playBot(kind, seed))
    cache.set(kind, s)
  }
  return s
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('toothbrush balance', () => {
  test('bot_definitions', () => {
    // 낙서 봇은 빠름 기준보다 빠르게(틱당 x 이동 ⌈√FAST_D2⌉ + 5), 가만히 봇은 구역 0 치아 칸 위
    expect(SCRIBBLE_DX).toBe(35)
    expect(SCRIBBLE_DX * SCRIBBLE_DX).toBeGreaterThanOrEqual(FAST_D2)
    expect(isTooth(0, Math.floor(STILL_POINT[1] / CELL) * W + Math.floor(STILL_POINT[0] / CELL))).toBe(true)
  })

  test('aim_bot_strong_but_not_perfect', () => {
    const s = scores('aim')
    expect(avg(s)).toBeGreaterThanOrEqual(8.0)
    expect(avg(s)).toBeLessThanOrEqual(9.5)
    for (const v of s) expect(v).toBeLessThan(10)
  }, 60_000)

  test('sweep_below_aim', () => {
    expect(avg(scores('sweep'))).toBeLessThanOrEqual(avg(scores('aim')) - 0.5)
  }, 60_000)

  test('scribble_low', () => {
    expect(avg(scores('scribble'))).toBeLessThanOrEqual(3.0)
  }, 60_000)

  test('still_low', () => {
    expect(avg(scores('still'))).toBeLessThanOrEqual(1.0)
  }, 60_000)
})
