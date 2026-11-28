// 경제 기능 플래그가 꺼져 있으면 새 행동은 아무것도 바꾸지 않고 feature_off(끄는 길이 계속 동작하는지).
// 운영 값은 2026-11-28부터 모두 켜짐. 플래그만 끈 채로 모듈을 바꿔 끼워 검사한다.
import { describe, expect, it, vi } from 'vitest'
vi.mock('./research.ts', async (orig) => {
  const m = await orig<typeof import('./research.ts')>()
  const off = { bait: false, research: false, exhibit: false, alchemy: false } as const
  return { ...m, ECONOMY_FLAGS: off, featureOn: (f: keyof typeof off, flags: Record<string, boolean> = off) => flags[f] === true }
})
import { logic, type State } from './logic.ts'
import { newEcon } from './research.ts'

const ctx = { now: Date.UTC(2026, 10, 28, 3), rng: () => 0.5, gold: 1_000_000 }
const err = (r: unknown) => (r as { error?: string }).error

describe('경제 P1 플래그 꺼짐', () => {
  it('grind·makeBait·buyLicense·미끼 투척은 feature_off, 맨 낚시는 그대로', () => {
    const s: State = { ...logic.init(), rodTier: 3, legends: ['grouper'], econ: { ...newEcon(), meal: 5, license: true, baits: { attractor: 1, legend: 1, mythic: 0 } }, bag: [{ id: 1, origin: 'normal', species: 'anchovy', sizeCm: 10, perfect: false }], nextFishId: 2 }
    expect(err(logic.apply(s, { type: 'grind', items: [{ index: 0, id: 1 }] } as never, ctx))).toBe('feature_off')
    expect(err(logic.apply(s, { type: 'makeBait', kind: 'attractor', price: 50 } as never, ctx))).toBe('feature_off')
    expect(err(logic.apply(s, { type: 'buyLicense', price: 50_000 } as never, ctx))).toBe('feature_off')
    expect(err(logic.apply(s, { type: 'cast', area: 'village', spot: 'shore', power: 0.5, bait: 'attractor' } as never, ctx))).toBe('feature_off')
    expect(err(logic.apply(s, { type: 'cast', area: 'village', spot: 'pier', power: 0.95, bait: 'legend', target: 'grouper' } as never, ctx))).toBe('feature_off')
    for (const a of [{ type: 'donate', index: 0 }, { type: 'exhibit', species: 'grouper', price: 100_000 }, { type: 'extract', items: [{ index: 0 }] }, { type: 'brew', potion: 'luck', price: 6000 }, { type: 'expand', stage: 1, price: 90_000 }, { type: 'drink', potion: 'luck' }, { type: 'buyProject', id: 'sea-bg', price: 60_000 }, { type: 'setTheme', theme: null }]) {
      expect(err(logic.apply(s, a as never, ctx)), a.type).toBe('feature_off')
    }
    expect(err(logic.apply(s, { type: 'cast', area: 'village', spot: 'shore', power: 0.5 } as never, ctx))).toBeUndefined()
  })
})
