import { describe, expect, it } from 'vitest'
import { Sampler, TICK_MS, chunk } from './sampler'

function run(hz: number): number[] {
  const s = new Sampler()
  s.frame(0)
  s.down(0, 100)
  s.frame(0)
  // 정지 상태로 한 틱 내보내 보간 기준점을 (0,100)에 둔다.
  s.frame(TICK_MS)
  s.take()
  const step = 1000 / hz
  for (let k = 1; k <= hz; k++) {
    const t = k * step
    s.move(Math.round((300 * t) / 1000), 100)
    s.frame(TICK_MS + t)
  }
  return s.take()
}

describe('Sampler', () => {
  it('no_samples_before_first_down', () => {
    const s = new Sampler()
    for (let t = 0; t <= 1000; t += 16.6) s.frame(t)
    expect(s.take()).toEqual([])
    expect(s.started).toBe(false)
  })

  it('sixty_per_second', () => {
    const s = new Sampler()
    s.frame(0)
    s.down(10, 20)
    s.frame(5)
    for (let k = 1; k <= 60; k++) s.frame(5 + k * 16.6)
    s.frame(1005)
    expect(s.started).toBe(true)
    const out = s.take()
    expect(out.length / 2).toBe(60)
    expect(s.take()).toEqual([])
  })

  it('frame_rate_independent', () => {
    const a = run(30)
    const b = run(120)
    expect(a.length).toBe(b.length)
    expect(a.length / 2).toBe(60)
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(1)
  })

  it('interpolates_integer', () => {
    const s = new Sampler()
    s.down(0, 0)
    s.frame(0)
    s.frame(TICK_MS)
    expect(s.take()).toEqual([0, 0])
    s.move(10, 0)
    s.frame(3 * TICK_MS)
    expect(s.take()).toEqual([5, 0, 10, 0])
  })

  it('up_emits_no_contact', () => {
    const s = new Sampler()
    s.down(3, 4)
    s.frame(0)
    s.frame(TICK_MS)
    s.take()
    s.up()
    s.frame(3 * TICK_MS)
    expect(s.take()).toEqual([-1, -1, -1, -1])
  })

  it('contact_after_no_contact_is_not_interpolated', () => {
    const s = new Sampler()
    s.down(0, 0)
    s.frame(0)
    s.frame(TICK_MS)
    s.up()
    s.frame(2 * TICK_MS)
    s.take()
    s.down(100, 50)
    s.frame(4 * TICK_MS)
    expect(s.take()).toEqual([100, 50, 100, 50])
  })

  it('gap_drops_and_breaks', () => {
    const s = new Sampler()
    s.down(0, 0)
    s.frame(1000)
    s.frame(1000 + TICK_MS)
    s.take()
    s.move(200, 100)
    s.frame(1000 + TICK_MS + 400)
    expect(s.take()).toEqual([-1, -1])
    s.frame(1000 + TICK_MS + 400 + TICK_MS)
    expect(s.take()).toEqual([200, 100])
  })

  it('chunk_splits', () => {
    const flat = Array.from({ length: 140 }, (_, i) => i)
    const c = chunk(flat)
    expect(c.map((x) => x.length / 2)).toEqual([30, 30, 10])
    expect(c.flat()).toEqual(flat)
    expect(chunk([], 30)).toEqual([])
  })
})
