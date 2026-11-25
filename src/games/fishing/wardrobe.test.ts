import { describe, expect, test } from 'vitest'
import { AREAS, CHALLENGES, SPECIES } from './data.ts'
import {
  DEFAULT_OUTFIT, isShopItem, newlyEarned, ownsWear, unlockMet, unlockText, WEAR, WEAR_SLOTS, wearItem,
  type OwnFacts, type WearSlot,
} from './wardrobe.ts'

/** 지갑 설계 §4 기준 시간당 수입(gold.test와 같은 값) */
const REF = 20_500
const empty: OwnFacts = { wardrobe: [], legends: [], challenges: {}, dex: {} }

describe('catalog', () => {
  test('ids are unique per slot and slots are known', () => {
    for (const slot of WEAR_SLOTS) {
      const ids = WEAR.filter((w) => w.slot === slot).map((w) => w.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.length).toBeGreaterThanOrEqual(8)
    }
    for (const w of WEAR) expect(WEAR_SLOTS).toContain(w.slot)
    for (const w of WEAR) expect(w.id).toMatch(/^[a-z0-9-]+$/)
  })

  test('default outfit items exist and are free', () => {
    for (const slot of WEAR_SLOTS) {
      const it = wearItem(slot, DEFAULT_OUTFIT[slot])
      expect(it, slot).toBeTruthy()
      expect(it!.price).toBe(0)
      expect(it!.unlock).toBeUndefined()
    }
  })

  test('free defaults: two per slot, one rod skin', () => {
    const free = (slot: WearSlot) => WEAR.filter((w) => w.slot === slot && w.price === 0 && !w.unlock).length
    for (const slot of WEAR_SLOTS) expect(free(slot), slot).toBe(slot === 'rodSkin' ? 1 : 2)
  })

  test('achievement items cost nothing and reference real challenges', () => {
    const ach = WEAR.filter((w) => w.unlock)
    expect(ach.length).toBe(10)
    for (const w of ach) {
      expect(w.price).toBe(0)
      expect(isShopItem(w)).toBe(false)
      if (w.unlock!.kind === 'challenge') expect(CHALLENGES.map((c) => c.id)).toContain(w.unlock!.id)
      expect(unlockText(w.unlock!).length).toBeGreaterThan(0)
    }
  })

  test('shop total is REF × 55..75 (wallet §15: character half of 90+ days)', () => {
    const total = WEAR.filter(isShopItem).reduce((s, w) => s + w.price, 0)
    expect(total).toBe(1_340_000)
    expect(total).toBeGreaterThanOrEqual(REF * 55)
    expect(total).toBeLessThanOrEqual(REF * 75)
  })

  test('price ladder: most expensive ≥ 10× cheapest in every slot, prices in 1,000s', () => {
    for (const slot of WEAR_SLOTS) {
      const prices = WEAR.filter((w) => w.slot === slot && isShopItem(w)).map((w) => w.price)
      expect(Math.max(...prices)).toBeGreaterThanOrEqual(Math.min(...prices) * 10)
    }
    for (const w of WEAR) expect(w.price % 1000).toBe(0)
  })

  test('six football kits named by colour only, no club names anywhere', () => {
    const kits = WEAR.filter((w) => w.id.startsWith('kit-'))
    expect(kits.map((k) => k.id).sort()).toEqual(['kit-claret', 'kit-red', 'kit-redwhite', 'kit-royal', 'kit-stripes', 'kit-white'])
    for (const k of kits) {
      expect(k.slot).toBe('top')
      expect(k.price).toBeGreaterThanOrEqual(20_000)
      expect(k.price).toBeLessThanOrEqual(40_000)
    }
    const banned = /빌라|리버풀|맨유|맨체스터|유나이티드|토트넘|스퍼스|레스터|뉴캐슬|villa|liverpool|manchester|united|tottenham|spurs|leicester|newcastle|aston/i
    for (const w of WEAR) expect(`${w.id} ${w.name}`).not.toMatch(banned)
  })
})

describe('ownership', () => {
  test('free items are always owned, shop items only when bought', () => {
    expect(ownsWear(empty, 'hat', 'beanie')).toBe(true)
    expect(ownsWear(empty, 'hat', 'none')).toBe(true)
    expect(ownsWear(empty, 'hat', 'straw')).toBe(false)
    expect(ownsWear({ ...empty, wardrobe: ['hat:straw'] }, 'hat', 'straw')).toBe(true)
    // 다른 부위의 같은 id로는 가진 것이 아니다
    expect(ownsWear({ ...empty, wardrobe: ['top:black'] }, 'bottom', 'black')).toBe(false)
  })

  test('unknown slot or id is never owned', () => {
    expect(ownsWear(empty, 'hat', 'nope')).toBe(false)
    expect(ownsWear(empty, 'shoes' as WearSlot, 'beanie')).toBe(false)
    expect(ownsWear(empty, 'hat', '__proto__')).toBe(false)
  })

  test('achievement conditions (unlockMet / newlyEarned): legends, challenges, all challenges, area dex', () => {
    const met = (f: Partial<OwnFacts>, slot: WearSlot, id: string) => newlyEarned({ ...empty, ...f }).includes(`${slot}:${id}`)
    expect(met({}, 'hat', 'crown')).toBe(false)
    expect(met({ legends: ['grouper'] }, 'hat', 'crown')).toBe(true)
    expect(met({ legends: ['grouper', 'eel'] }, 'hairColor', 'gold')).toBe(false)
    expect(met({ legends: ['a', 'b', 'c'] }, 'hairColor', 'gold')).toBe(true)
    expect(met({ challenges: { 'cave-deep': { done: true } } }, 'top', 'lava-suit')).toBe(true)
    expect(met({ challenges: { 'cave-deep': { done: false } } }, 'top', 'lava-suit')).toBe(false)
    const all = Object.fromEntries(CHALLENGES.map((c) => [c.id, { done: true }]))
    expect(met({ challenges: all }, 'rodSkin', 'rainbow')).toBe(true)
    const five = Object.fromEntries(CHALLENGES.slice(1).map((c) => [c.id, { done: true }]))
    expect(met({ challenges: five }, 'rodSkin', 'rainbow')).toBe(false)
    const forest = Object.fromEntries(SPECIES.filter((s) => s.area === 'forest').map((s) => [s.id, { count: 1 }]))
    expect(met({ dex: forest }, 'hat', 'fish-hat')).toBe(true)
    const almost = Object.fromEntries(SPECIES.filter((s) => s.area === 'forest').slice(1).map((s) => [s.id, { count: 1 }]))
    expect(met({ dex: almost }, 'hat', 'fish-hat')).toBe(false)
    expect(unlockMet(empty, { kind: 'areaDex' })).toBe(false)
    // 이미 저장된 옷은 다시 주지 않는다
    expect(newlyEarned({ ...empty, legends: ['g'], wardrobe: ['hat:crown'] })).toEqual([])
    expect(AREAS.length).toBeGreaterThan(0)
  })

  test('achievement items are owned only once saved in the wardrobe (data growth cannot take them away)', () => {
    expect(ownsWear({ ...empty, legends: ['grouper'] }, 'hat', 'crown')).toBe(false)
    expect(ownsWear({ ...empty, wardrobe: ['hat:crown'] }, 'hat', 'crown')).toBe(true)
    const grown = { challenges: [...CHALLENGES, { id: 'new-7' }], species: SPECIES }
    const all = Object.fromEntries(CHALLENGES.map((c) => [c.id, { done: true }]))
    expect(unlockMet({ ...empty, challenges: all }, { kind: 'allChallenges' }, grown)).toBe(false)
    expect(ownsWear({ ...empty, challenges: all, wardrobe: ['rodSkin:rainbow'] }, 'rodSkin', 'rainbow')).toBe(true)
  })

  test('지역 도감 옷: 어종 확장(2026-11-25)으로 조건이 거짓이 돼도 wardrobe에 있으면 가진다', () => {
    const fishHat = WEAR.find((w) => w.unlock?.kind === 'areaDex')!
    const key = `${fishHat.slot}:${fishHat.id}`
    const oldForest = Object.fromEntries(SPECIES.slice(0, 94).filter((s) => s.area === 'forest').map((s) => [s.id, { count: 1 }]))
    expect(Object.keys(oldForest)).toHaveLength(8)
    const f: OwnFacts = { ...empty, dex: oldForest, wardrobe: [key] }
    expect(unlockMet(f, { kind: 'areaDex' })).toBe(false)
    expect(ownsWear(f, fishHat.slot, fishHat.id)).toBe(true)
    expect(newlyEarned(f)).not.toContain(key)
  })
})
