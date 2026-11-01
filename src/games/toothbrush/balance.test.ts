import { describe, expect, test } from 'vitest'
import { playBot, type BotKind } from './bots.ts'

const SEEDS = Array.from({ length: 20 }, (_, k) => new Uint8Array(16).fill(k + 1))

const cache = new Map<BotKind, number[]>()
function scores(kind: BotKind): number[] {
  let s = cache.get(kind)
  if (!s) {
    s = SEEDS.map((seed) => playBot(kind, seed))
    cache.set(kind, s)
    const avg = s.reduce((a, b) => a + b, 0) / s.length
    console.log(`[balance] ${kind}: avg ${avg.toFixed(3)} min ${Math.min(...s)} max ${Math.max(...s)}`)
  }
  return s
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('toothbrush balance', () => {
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
