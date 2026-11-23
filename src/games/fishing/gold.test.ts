// 낚시 경제 고정 검사. 데이터·가격이 바뀌어 진행 속도가 목표에서 벗어나면 실패한다.
// 목표(사용자 결정 2026-11-24, 지갑 설계 §4.1): 하루 1시간쯤 하는 사람이 낚시 장비·해금을 다 사는 데 약 한 달.
// 달력 기준이다: 지갑의 사이트 하루 상한(§5.6)을 넣고 하루 1시간씩 플레이해 약 30일(±20%).
// 기존 장비 가격은 그대로 두고 고급 장비(5·6단계 낚싯대, 50·60칸 가방)로 늘린다(사용자 결정 2026-11-24).
import { describe, expect, it } from 'vitest'
import { BAGS, RODS, SPECIES, TACKLES, UNLOCKS } from './data.ts'
import { BUY_ORDER, hourlyIncome, simulate, totalSinks } from './econSim.ts'

/** 지갑 설계 §4의 기준 시간당 수입(2단계 낚싯대·마을 물가·20칸). 지갑 1단계에서 src/games/economy.ts로 옮긴다 */
const REF = 20_500
/** 지갑 설계 §5.6 사이트 하루 상한(지갑 1단계에서 구현 예정). 하루 1시간 진행 속도를 재는 데 쓴다 */
const DAILY_SOFT_CAP = REF * 1.5
const SOFT_CAP_RATE = 0.2

const plain = simulate()
const capped = simulate(BUY_ORDER, { hoursPerDay: 1, cap: DAILY_SOFT_CAP, rate: SOFT_CAP_RATE })
const at = (ms: typeof plain, label: string) => ms.find((m) => m.label === label)!

describe('REF (지갑 설계 §4)', () => {
  it('2단계 낚싯대·마을 물가·20칸 기대 수입이 REF ±25% (계산값 20,515)', () => {
    const v = hourlyIncome('village', 'shore', { rodTier: 2, bagTier: 1, equipped: [] })
    expect(Math.abs(v - 20_515) / 20_515).toBeLessThan(0.01)
    expect(Math.abs(v - REF) / REF).toBeLessThan(0.25)
  })
})

describe('장비 가격', () => {
  it('기존 장비·해금 가격은 그대로다', () => {
    expect(RODS.filter((r) => r.tier <= 4).map((r) => r.price)).toEqual([0, 1500, 8000, 40000])
    expect(BAGS.filter((b) => b.tier <= 3).map((b) => b.price)).toEqual([0, 800, 5000])
    expect(TACKLES.map((t) => [t.id, t.price])).toEqual([['cork', 1000], ['trap', 1500], ['barbed', 2000], ['spinner', 1500], ['curious', 5000]])
    expect(UNLOCKS.lake!.price).toBe(5000)
    expect(UNLOCKS.cave!.price).toBe(15000)
    expect(UNLOCKS.island!.price).toBe(50000)
  })
  it('고급 장비: 5·6단계 낚싯대, 50·60칸 가방. 단계가 오를수록 비싸고 효과는 조금씩만 는다', () => {
    expect(RODS.map((r) => r.tier)).toEqual([1, 2, 3, 4, 5, 6])
    expect(BAGS.map((b) => b.size)).toEqual([20, 30, 40, 50, 60])
    for (let i = 1; i < RODS.length; i++) {
      expect(RODS[i].price).toBeGreaterThan(RODS[i - 1].price)
      expect(RODS[i].barBonus).toBeGreaterThan(RODS[i - 1].barBonus)
      expect(RODS[i].biteScale).toBeLessThanOrEqual(RODS[i - 1].biteScale)
    }
    // 바는 미니게임 균형을 깨지 않게 거의 늘리지 않는다(4단계 0.45에서 +0.05까지)
    expect(RODS[5].barBonus).toBeLessThanOrEqual(0.5)
  })
  it('새 장비는 어떤 어종에도 필요 없다: 모든 어종이 4단계 낚싯대로 낚인다', () => {
    for (const s of SPECIES) expect(s.minRod, s.id).toBeLessThanOrEqual(4)
  })
  it('총액(낚싯대·가방·찌·해금, 순간이동 제외)', () => {
    expect(totalSinks()).toBe(1_186_300)
  })
})

describe('진행 시뮬레이션 (상한 없음)', () => {
  it('BUY_ORDER는 모든 품목을 한 번씩 산다', () => {
    expect(plain).toHaveLength(RODS.length - 1 + BAGS.length - 1 + TACKLES.length + Object.keys(UNLOCKS).length)
    expect(plain.reduce((a, m) => a + m.price, 0)).toBe(totalSinks())
  })
  it('첫 업그레이드는 1시간 안', () => {
    expect(plain[0].atHours).toBeLessThan(1)
  })
  it('기존 장비·해금은 지금 속도 그대로(4시간 안에 다 산다)', () => {
    expect(at(plain, '가시 바늘').atHours).toBeLessThan(4)
  })
  it('상한이 없으면 전부 다 사기까지 약 16시간(±20%, 상한 없이 몰아서 하는 경우의 참고값)', () => {
    const h = plain[plain.length - 1].atHours
    expect(h).toBeGreaterThan(15.86 * 0.8)
    expect(h).toBeLessThan(15.86 * 1.2)
  })
  it('고급 장비는 살 때마다 시간당 수입이 오른다', () => {
    const i = plain.findIndex((m) => m.label === '가시 바늘')
    for (let k = i + 1; k < plain.length; k++) expect(plain[k].incomeAfter, plain[k].label).toBeGreaterThan(plain[k - 1].incomeAfter)
  })
})

describe('하루 1시간 + 사이트 하루 상한(지갑 §5.6)', () => {
  it('전부 다 사기까지 약 30일(±20%)', () => {
    const d = capped[capped.length - 1].atDay
    expect(d).toBeGreaterThan(24)
    expect(d).toBeLessThan(36)
  })
  it('3주 안에 다 사지 못한다(지갑 실패 조건), 기존 장비는 일주일 안', () => {
    expect(capped[capped.length - 1].atDay).toBeGreaterThan(21)
    expect(at(capped, '가시 바늘').atDay).toBeLessThan(7)
  })
})
