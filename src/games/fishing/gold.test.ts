// 낚시 경제 고정 검사. 데이터·가격이 바뀌어 진행 속도가 목표에서 벗어나면 실패한다.
// 목표(사용자 결정 2026-11-24, 지갑 설계 §4.1): 하루 1시간쯤 하는 사람이 낚시 장비·해금을 다 사는 데 약 한 달.
// 달력 기준이다: 지갑의 사이트 하루 상한(§5.6)을 넣고 하루 1시간씩 플레이해 약 30일(±20%).
// 기존 장비 가격은 그대로 두고 고급 장비(5·6단계 낚싯대, 50·60칸 가방)로 늘린다(사용자 결정 2026-11-24).
// 낚시 5부(설계 2026-11-24-fishing-world-5 §8): 새 지역 해금이 쓸 곳을 늘려 목표가 약 34일(M3 뒤)로 늘어난다.
// M3(산정 호수·난파선)까지 다 넣은 최종 목표는 하루 1시간 + 상한으로 약 34일(±20%, 27~41일).
// 지갑 Task 4(낚시 logic.version 14)부터 상한은 실제 사이트 상한(economy.ts SOFT_CAP_TIERS, 2단)으로 잰다.
// 2단 상한(들어간 합계 41,000 위는 4%)은 하루 1시간 하는 사람의 끝 무렵(시간당 수입 80,000 G 이상)도 조금 늦춰
// 하루 1시간 값이 34.3일(옛 1단 상한) → 37.3일이 된다. 목표 범위(27~41일) 안이라 가격은 그대로 둔다
// (34일에 더 붙이려면 낚시 5부 설계 §판단 8의 산정·난파선 해금 가격을 내린다).
import { describe, expect, it } from 'vitest'
import { DAILY_SOFT_CAP, REF, SOFT_CAP_RATE, softCap } from '../economy.ts'
import { AREAS, BAGS, CHALLENGES, DEFAULT_AREAS, RODS, SPECIES, TACKLES, UNLOCKS, type AreaId, type TackleId } from './data.ts'
import { BUY_ORDER, buffsAt, cappedIncome, hourlyIncome, openFraction, simulate, totalSinks, type CapTiers } from './econSim.ts'
import { M1_FIXTURE, TMP_DEEP, TMP_FLAT, TMP_MYTH, withTempData } from './testFixtures.ts'

/** 지갑 2단 상한 개정 전의 1단 상한(30,750 + 넘은 몫 20%). 기록 값 검산용 */
const ONE_TIER: CapTiers = [
  [DAILY_SOFT_CAP, 1],
  [Infinity, SOFT_CAP_RATE],
]

const plain = simulate()
/** 하루 1시간 + 실제 사이트 하루 상한(SOFT_CAP_TIERS) */
const capped = simulate(BUY_ORDER, { hoursPerDay: 1 })
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

// 오래 하는 사람: 옛 1단 상한(하루 30,750 + 넘은 몫 20%)으로는 늦은 시간당 수입의 20%만으로도 하루 여러 시간이면
// 2주 안에 끝났다(지갑 §2 실패 조건). 지갑 2단 상한(SOFT_CAP_TIERS, 들어간 합계 41,000 위는 4%)이 이것을 고쳤다.
// 사용자 기준(2026-11-24): 하루 3시간 ≥ 약 18일, 하루 5시간 ≥ 약 21일. economyPace.test.ts도 같은 시뮬레이션으로 본다.
describe('하루 여러 시간 + 사이트 하루 상한 (기록, ±10%)', () => {
  const memo = new Map<string, number>()
  const daysFor = (hoursPerDay: number, tiers?: CapTiers) => {
    const key = `${hoursPerDay}|${JSON.stringify(tiers ?? null)}`
    if (!memo.has(key)) memo.set(key, simulate(BUY_ORDER, { hoursPerDay, tiers }).at(-1)!.atDay)
    return memo.get(key)!
  }
  const near = (v: number, want: number) => expect(Math.abs(v - want) / want).toBeLessThan(0.1)
  it('실제 2단 상한: 하루 3시간 약 30.2일, 5시간 약 26.0일 (3시간 ≥ 18, 5시간 ≥ 21)', () => {
    near(daysFor(3), 30.18)
    near(daysFor(5), 26.03)
    expect(daysFor(3)).toBeGreaterThanOrEqual(18)
    expect(daysFor(5)).toBeGreaterThanOrEqual(21)
  })
  it('옛 1단 상한(검산): 하루 3시간 약 18.1일, 5시간 약 12.4일', () => {
    near(daysFor(3, ONE_TIER), 18.06)
    near(daysFor(5, ONE_TIER), 12.41)
  })
  it('상한이 없으면 하루 1시간: 약 16.6일', () => near(plain[plain.length - 1].atHours, 16.58))
})

describe('시뮬레이션 상한 = 실제 사이트 상한(economy.softCap)', () => {
  it('cappedIncome(내림 없음)과 softCap(정수 내림)이 1 G 안에서 같다(오늘 합계·금액 여러 값)', () => {
    for (const s of [0, 10_000, 30_000, 30_750, 35_000, 40_999, 41_000, 60_000]) {
      for (const d of [1, 500, 5_000, 20_000, 80_000, 300_000]) {
        const want = softCap(d, s)
        const got = cappedIncome(d, s)
        expect(got - want, `s ${s} d ${d}`).toBeGreaterThan(-1e-6)
        expect(got - want, `s ${s} d ${d}`).toBeLessThan(1)
      }
    }
  })
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
  it('하루 1시간 + 옛 1단 상한 전부 다 사기(34.3일)는 시험 계산(약 34일)과 ±5% 안 — 설계 표의 값', () => {
    const d = simulate(BUY_ORDER, { hoursPerDay: 1, tiers: ONE_TIER }).at(-1)!.atDay
    expect(Math.abs(d - 34) / 34).toBeLessThan(0.05)
  })
  it('하루 1시간 + 실제 2단 상한 전부 다 사기 지금 값 약 37.3일(±5%), 목표 범위 27~41일 안', () => {
    const d = capped[capped.length - 1].atDay
    expect(Math.abs(d - 37.26) / 37.26).toBeLessThan(0.05)
    expect(d).toBeGreaterThan(27)
    expect(d).toBeLessThan(41)
  })
})

// ---------------------------------------------------------------- 도전과제 보너스가 낚시 수입 곡선을 따른다 (지갑 설계 §7.5)
// 사용자 요구(2026-11-24): 미니게임 골드도 낚시처럼 자란다 — 도전과제 열 개를 다 깨면 ×5, 지역 가중.
// 비교: 지역 해금 시점마다 (1) 낚시 시간당 수입 / 처음 수입, (2) 그때까지 열린 지역의 과제를 다 깼다고 본 배율.
// 낚시는 끝에 약 ×13.7까지 자라고 보너스는 ×5에서 멈추므로 곱셈 성장을 로그로 정규화해 비교한다:
//   f = ln(낚시 비율) / ln(낚시 최종 비율), m = ln(배율) / ln(5). 해금 시점마다 |m − f| ≤ 0.15 (지금 최대 0.12, 낚시 데이터가 조금 바뀌어도 깨지지 않게 여유).
// 사용자 초안(마을·강·숲 20, 호수·동굴 40, 섬·갯벌·늪지 40, 산정·난파선 70)은 최대 차이 0.18(산 호수에서 앞섬)이라
// 호수 20 / 동굴 60, 산정 60 / 난파선 80으로 옮겨 0.12로 맞췄다(합 400 그대로).
describe('도전과제 보너스 = 낚시 수입 곡선 (로그 정규화)', () => {
  // 처음(대나무·20칸·기본 지역)의 가장 좋은 자리 수입. simulate는 구매 뒤 값만 주므로 따로 잰다(약 11,500)
  const start = Math.max(...DEFAULT_AREAS.flatMap((a) => AREAS.find((x) => x.id === a)!.spots.map((spot) => hourlyIncome(a, spot, { rodTier: 1, bagTier: 1, equipped: [] }))))
  const final = plain[plain.length - 1].incomeAfter
  const pctOf = (area: AreaId) => CHALLENGES.find((c) => c.area === area)!.freeBonusPct
  const unlocks = plain.filter((m) => m.label.endsWith(' 해금'))
  const areaOfLabel = (label: string) => (Object.entries(UNLOCKS) as [AreaId, { name: string }][]).find(([id]) => label === `${AREAS.find((a) => a.id === id)!.name} 해금`)?.[0]

  it('해금 지점 일곱 곳을 모두 찾는다(지역 이름 = 라벨), 처음 수입 약 11,500', () => {
    expect(Math.abs(start - 11_499) / 11_499).toBeLessThan(0.01)
    expect(unlocks.map((m) => areaOfLabel(m.label))).toEqual(['lake', 'cave', 'island', 'tideflat', 'swamp', 'summit', 'wreck'])
  })
  it('해금 지점마다 |ln(배율)/ln 5 − ln(낚시 비율)/ln(최종 비율)| ≤ 0.15, 다 깨면 ×5', () => {
    let pct = DEFAULT_AREAS.reduce((a, id) => a + pctOf(id), 0)
    expect(pct).toBe(60)
    const rows: [string, number, number][] = []
    for (const m of unlocks) {
      pct += pctOf(areaOfLabel(m.label)!)
      const f = Math.log(m.incomeAfter / start) / Math.log(final / start)
      const g = Math.log((100 + pct) / 100) / Math.log(5)
      rows.push([m.label, +f.toFixed(3), +g.toFixed(3)])
    }
    expect(pct).toBe(400)
    for (const [label, f, g] of rows) expect(Math.abs(g - f), `${label}: 배율 ${g} vs 낚시 ${f}`).toBeLessThanOrEqual(0.15)
  })
  it('낚시 성장과 같은 방향: 동굴(낚시가 가장 크게 뛰는 곳)이 산 호수보다, 난파선이 산정보다 크다', () => {
    expect(pctOf('cave')).toBeGreaterThan(pctOf('lake'))
    expect(pctOf('wreck')).toBeGreaterThan(pctOf('summit'))
    expect(pctOf('village') + pctOf('river') + pctOf('forest')).toBe(60)
  })
})
