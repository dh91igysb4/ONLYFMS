// 낚시 경제 고정 검사. 데이터·가격이 바뀌어 진행 속도가 목표에서 벗어나면 실패한다.
// 목표(사용자 결정 2026-11-24, 지갑 설계 §4.1): 하루 1시간쯤 하는 사람이 낚시 장비·해금을 다 사는 데 약 한 달.
// 달력 기준이다: 지갑의 사이트 하루 상한(§5.6)을 넣고 하루 1시간씩 플레이해 약 30일(±20%).
// 기존 장비 가격은 그대로 두고 고급 장비(5·6단계 낚싯대, 50·60칸 가방)로 늘린다(사용자 결정 2026-11-24).
// 낚시 5부(설계 2026-11-24-fishing-world-5 §8): 새 지역 해금이 쓸 곳을 늘려 목표가 약 34일(M3 뒤)로 늘어난다.
// M3(산정 호수·난파선)까지 다 넣은 최종 목표는 하루 1시간 + 상한으로 약 34일(±20%, 27~41일).
import { describe, expect, it } from 'vitest'
import { BAGS, RODS, SPECIES, TACKLES, UNLOCKS, type AreaId, type TackleId } from './data.ts'
import { BUY_ORDER, buffsAt, hourlyIncome, openFraction, simulate, totalSinks } from './econSim.ts'
import { M1_FIXTURE, TMP_DEEP, TMP_FLAT, TMP_MYTH, withTempData } from './testFixtures.ts'

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
  it('고급 낚싯대가 필요한 곳: 난파선 어종·신화를 뺀 모든 어종은 4단계 이하, 난파선 어종은 5 이상, 용왕 6', () => {
    for (const s of SPECIES) if (s.rarity !== 'mythic' && s.area !== 'wreck') expect(s.minRod, s.id).toBeLessThanOrEqual(4)
    for (const s of SPECIES) if (s.area === 'wreck') expect(s.minRod, s.id).toBeGreaterThanOrEqual(5)
    expect(SPECIES.filter((s) => s.rarity === 'mythic').map((s) => [s.id, s.minRod])).toEqual([['imugi', 5], ['white-dragon', 5], ['dragon-king', 6]])
  })
  it('총액(낚싯대·가방·찌·해금, 순간이동 제외)', () => {
    // 기존 1,186,300 + 갯벌 30,000 + 늪지 60,000 + 산정 120,000 + 난파선 150,000
    expect(totalSinks()).toBe(1_546_300)
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
  it('상한이 없으면 전부 다 사기까지 약 16.6시간(±20%, 상한 없이 몰아서 하는 경우의 참고값)', () => {
    const h = plain[plain.length - 1].atHours
    expect(h).toBeGreaterThan(16.58 * 0.8)
    expect(h).toBeLessThan(16.58 * 1.2)
  })
  it('기존 품목 13개(유리섬유 … 가시 바늘)의 구매 시각은 낚시 5부 전과 같다(상한 없음·하루 1시간 상한)', () => {
    expect(plain.slice(0, 13).map((m) => +m.atHours.toFixed(2))).toEqual([0.14, 0.18, 0.4, 0.76, 0.82, 1.36, 1.46, 1.55, 2.2, 2.86, 2.88, 2.9, 2.92])
    expect(capped.slice(0, 13).map((m) => +m.atDay.toFixed(2))).toEqual([0.14, 0.18, 0.4, 0.76, 0.82, 1.36, 1.46, 1.55, 2.43, 3.84, 3.9, 4, 4.03])
    expect(plain[12].label).toBe('가시 바늘')
    expect(plain.slice(13, 15).map((m) => m.label)).toEqual(['갯벌 해금', '늪지 해금'])
  })
  it('고급 장비는 살 때마다 시간당 수입이 오른다(새 지역 해금은 오르거나 같다 — 버는 곳이 아니라 갈 곳이 늘어서)', () => {
    const i = plain.findIndex((m) => m.label === '가시 바늘')
    for (let k = i + 1; k < plain.length; k++) {
      if (plain[k].label.endsWith('해금')) expect(plain[k].incomeAfter, plain[k].label).toBeGreaterThanOrEqual(plain[k - 1].incomeAfter)
      else expect(plain[k].incomeAfter, plain[k].label).toBeGreaterThan(plain[k - 1].incomeAfter)
    }
  })
})

describe('하루 1시간 + 사이트 하루 상한(지갑 §5.6)', () => {
  it('전부 다 사기까지 약 34일(±20%, 27~41일 — 새 지역 해금 넷 포함)', () => {
    const d = capped[capped.length - 1].atDay
    expect(d).toBeGreaterThan(27)
    expect(d).toBeLessThan(41)
  })
  it('3주 안에 다 사지 못한다(지갑 실패 조건), 기존 장비는 일주일 안', () => {
    expect(capped[capped.length - 1].atDay).toBeGreaterThan(21)
    expect(at(capped, '가시 바늘').atDay).toBeLessThan(7)
  })
})

// 오래 하는 사람: 지금 상한 모양(하루 30,750 + 넘은 몫 20%)으로는 늦은 시간당 수입(76,000~89,000 G)의 20%만으로도
// 시간당 약 15,000 G가 들어와 하루 여러 시간이면 2주 안에 끝난다(지갑 §2 실패 조건 "하루 여러 시간 → 2주 안"에 걸린다).
// 장비 가격으로는 하루 1시간 한 달을 깨지 않고 고칠 수 없어 지갑 상한 모양(SOFT_CAP_RATE, 2단 상한 등)의 결정으로 남긴다.
// 아래 값은 지금 상태를 기록해 지갑 PR이 바꿀 때 보이게 한다(±10%).
describe('하루 여러 시간 + 사이트 하루 상한 (지금 값 기록)', () => {
  const daysFor = (hoursPerDay: number) => simulate(BUY_ORDER, { hoursPerDay, cap: DAILY_SOFT_CAP, rate: SOFT_CAP_RATE }).at(-1)!.atDay
  const near = (v: number, want: number) => expect(Math.abs(v - want) / want).toBeLessThan(0.1)
  it('하루 3시간: 약 18.1일', () => near(daysFor(3), 18.06))
  it('하루 5시간: 약 12.4일 (2주 안 — 지갑 상한 모양 결정 필요)', () => near(daysFor(5), 12.41))
  it('상한이 없으면(지갑 1단계 전) 하루 1시간: 약 16.6일', () => near(plain[plain.length - 1].atHours, 16.58))
})

// ---------------------------------------------------------------- 낚시 5부 M1: 물때 자리·지역 최소 낚싯대·신화 버프

describe('시뮬레이션 확장 (합성 지역)', () => {
  withTempData(M1_FIXTURE)
  const gear = { rodTier: 4 as const, bagTier: 3 as const, equipped: [] }

  it('물때 자리는 열린 비율(8/24)만 그 자리, 나머지는 같은 지역 첫 늘 열린 자리로 섞는다', () => {
    expect(openFraction(TMP_FLAT, 'gully')).toBeCloseTo(8 / 24, 6)
    expect(openFraction(TMP_FLAT, 'bank')).toBe(1)
    const mixed = hourlyIncome(TMP_FLAT, 'gully', gear)
    const bank = hourlyIncome(TMP_FLAT, 'bank', gear)
    expect(mixed).toBeGreaterThan(bank) // 갯골에는 더 비싼 짱뚱이가 있다
    // 갯골만 열린 시간에 섞이므로, 늘 갯골에 있는 것보다는 적게 번다: mixed = bank + 1/3 × (갯골 - bank)
    const gullyGain = (mixed - bank) / (8 / 24)
    expect(gullyGain).toBeGreaterThan(0)
    expect(mixed).toBeLessThan(bank + gullyGain * 0.5)
  })
  it('지역 최소 낚싯대보다 낮으면 수입 0', () => {
    expect(hourlyIncome(TMP_DEEP, 'abyss', gear)).toBe(0)
    expect(hourlyIncome(TMP_DEEP, 'abyss', { ...gear, rodTier: 5 })).toBeGreaterThan(0)
  })
  it('이무기의 비늘은 입질만큼, 용왕의 여의주는 판매가(×1.08)만큼 수입을 올린다; 백룡의 숨결은 그대로', () => {
    const base = hourlyIncome('village', 'shore', gear)
    expect(hourlyIncome('village', 'shore', { ...gear, buffs: ['dragon-pearl'] }) / base).toBeCloseTo(1.08, 6)
    expect(hourlyIncome('village', 'shore', { ...gear, buffs: ['imugi-scale'] })).toBeGreaterThan(base)
    expect(hourlyIncome('village', 'shore', { ...gear, buffs: ['dragon-breath'] })).toBe(base)
  })
  it('buffsAt: 신화 지역이 열리고 낚싯대가 신화 minRod 이상이면 얻었다고 본다(백룡의 숨결 제외)', () => {
    const base: AreaId[] = ['village', 'river', 'forest']
    expect(buffsAt(base, 6)).toEqual([])
    expect(buffsAt([...base, TMP_MYTH], 4)).toEqual([])
    expect(buffsAt([...base, TMP_MYTH], 5)).toEqual(['imugi-scale', 'dragon-pearl'])
  })
  it('기존 여섯 지역에는 신화가 없어 버프 없이 그대로(buffsAt 빈 목록)', () => {
    expect(buffsAt(['village', 'river', 'forest', 'lake', 'cave', 'island'], 6)).toEqual([])
  })
})

// ---------------------------------------------------------------- 낚시 5부 M2: 갯벌·늪지
describe('갯벌·늪지 수입 (40칸, 회전+호기심, 얻을 수 있는 신화 버프 포함)', () => {
  const gear = (rodTier: 4 | 5 | 6) => ({ rodTier, bagTier: 3 as const, equipped: ['spinner', 'curious'] as TackleId[], buffs: buffsAt(['cave', 'tideflat', 'swamp'], rodTier) })
  it.each([4, 5, 6] as const)('낚싯대 %i: 갯벌 갯골(물때 섞음) < 동굴 용암, 늪지 수렁 ≤ 동굴 용암', (rod) => {
    const lava = hourlyIncome('cave', 'cave3', gear(rod))
    expect(hourlyIncome('tideflat', 'creek', gear(rod))).toBeLessThan(lava)
    expect(hourlyIncome('swamp', 'bog', gear(rod))).toBeLessThanOrEqual(lava)
  })
  it('시험 계산과 같은 크기(±5%): 낚싯대 4에서 갯골 61,400 · 수렁 73,700', () => {
    const near = (v: number, want: number) => expect(Math.abs(v - want) / want).toBeLessThan(0.05)
    near(hourlyIncome('tideflat', 'creek', gear(4)), 61_400)
    near(hourlyIncome('swamp', 'bog', gear(4)), 73_700)
  })
  it('이무기의 비늘은 늪지와 백골 낚싯대가 있어야 얻었다고 본다', () => {
    expect(buffsAt(['swamp'], 4)).toEqual([])
    expect(buffsAt(['tideflat'], 6)).toEqual([])
    expect(buffsAt(['swamp'], 5)).toEqual(['imugi-scale'])
  })
})


// ---------------------------------------------------------------- 낚시 5부 M3: 산정 호수·난파선 (최종 고정)
describe('산정 호수·난파선 수입과 최종 진행 (40칸, 회전+호기심, 얻을 수 있는 신화 버프 포함)', () => {
  const ALL: AreaId[] = ['village', 'river', 'forest', 'lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck']
  const gear = (rodTier: 4 | 5 | 6) => ({ rodTier, bagTier: 3 as const, equipped: ['spinner', 'curious'] as TackleId[], buffs: buffsAt(ALL, rodTier) })
  it('낚싯대 5: 산정 얼음 구멍 ≈ 동굴 용암 × 1.0~1.4, 난파선 심해 ≈ × 1.3~1.9', () => {
    const lava = hourlyIncome('cave', 'cave3', gear(5))
    const ice = hourlyIncome('summit', 'ice', gear(5)) / lava
    const abyss = hourlyIncome('wreck', 'abyss', gear(5)) / lava
    expect(ice).toBeGreaterThanOrEqual(1.0)
    expect(ice).toBeLessThanOrEqual(1.4)
    expect(abyss).toBeGreaterThanOrEqual(1.3)
    expect(abyss).toBeLessThanOrEqual(1.9)
  })
  it('난파선은 낚싯대 4로는 수입 0(들어갈 수 없다), 신화 버프 셋 중 시뮬레이션에 넣는 것은 비늘·여의주뿐', () => {
    expect(hourlyIncome('wreck', 'abyss', gear(4))).toBe(0)
    expect(buffsAt(ALL, 4)).toEqual([])
    expect(buffsAt(ALL, 5)).toEqual(['imugi-scale'])
    expect(buffsAt(ALL, 6)).toEqual(['imugi-scale', 'dragon-pearl'])
  })
  it('구매 순서: 기존 13개 → 갯벌 → 늪지 → 백골 → 산정 → 50칸 → 난파선 → 용왕 → 60칸', () => {
    expect(plain.slice(13).map((m) => m.label)).toEqual(['갯벌 해금', '늪지 해금', '백골 낚싯대', '산정 호수 해금', '가방 50칸', '난파선 앞바다 해금', '용왕의 낚싯대', '가방 60칸'])
  })
  it('하루 1시간 + 상한 전부 다 사기 지금 값(34.3일)과 시험 계산(약 34일)이 ±5% 안', () => {
    const d = capped[capped.length - 1].atDay
    expect(Math.abs(d - 34) / 34).toBeLessThan(0.05)
  })
})
