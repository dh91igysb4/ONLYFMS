// 행동 하나의 전후 상태·행동·결과에서 사건을 뽑는다(데일리 과제·업적 설계 2026-11-28 §4). 순수 모듈.
// 기존 행동 함수는 건드리지 않는다. 판정은 서버가 이미 끝낸 결과(전후 상태 차이)만 본다.
import { bagSize, type AreaId } from './data.ts'
import type { Conditions } from './clock.ts'
import { POTION_IDS, type PotionId } from './gallery.ts'
import { kstDayOf, type GoalEvent } from './stats.ts'
import type { State } from './logic.ts'

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const matSum = (m: Partial<Record<string, number>>) => Object.values(m).reduce<number>((a, n) => a + (n ?? 0), 0)

export function goalEvents(prev: State, next: State, action: unknown, result: unknown, now: number): GoalEvent[] {
  if (!isObj(action)) return []
  const out: GoalEvent[] = []
  const r = isObj(result) ? result : {}
  switch (action.type) {
    case 'resolve': {
      const p = prev.pending
      const fish = isObj(r.caught) ? r.caught : null
      const cond = p && isObj(p.cond) && typeof p.cond.gameMinute === 'number' && typeof p.cond.season === 'string' ? p.cond : null
      // 던질 때 조건이 없는(비정상) 대기 상태는 과제·통계를 건너뛴다(도전과제 catchFacts와 같다)
      if (p && cond && fish && typeof fish.species === 'string' && typeof fish.sizeCm === 'number') {
        out.push({
          k: 'catch', species: fish.species, sizeCm: fish.sizeCm, perfect: fish.perfect === true,
          area: p.area as AreaId, spot: p.spot, cond: cond as unknown as Conditions,
          research: fish.origin === 'recatch',
          potion: POTION_IDS.some((id: PotionId) => (prev.gallery?.potions[id] ?? 0) > 0),
          bagFull: next.bag.length >= bagSize(next.bagTier),
          bagCap: bagSize(next.bagTier),
        })
      } else if (p && !fish) out.push({ k: 'miss' })
      break
    }
    case 'sell': {
      const n = prev.bag.length - next.bag.length
      const income = typeof r.earned === 'number' ? r.earned : 0
      const soldBefore = prev.sold.day === kstDayOf(now) ? prev.sold.n : 0
      if (n > 0) out.push({ k: 'sell', n, income, soldBefore })
      break
    }
    case 'gather':
      out.push({ k: 'gather' })
      break
    case 'teleport':
      out.push({ k: 'teleport' })
      break
    case 'discard':
    case 'discardMany':
      if (action.at === 'trash') out.push({ k: 'trash', n: prev.bag.length - next.bag.length })
      break
    case 'drink':
      out.push({ k: 'potion' })
      break
    case 'extract': {
      const n = matSum(next.gallery?.mats ?? {}) - matSum(prev.gallery?.mats ?? {})
      if (n > 0) out.push({ k: 'extract', n })
      break
    }
    case 'cast':
      if (next.pending?.target) out.push({ k: 'researchCast' })
      break
    default:
      break
  }
  // 어분이 늘었으면(어분 갈기·잡는 순간 자동 어분) 그 양
  const meal = (next.econ?.meal ?? 0) - (prev.econ?.meal ?? 0)
  if (meal > 0) out.push({ k: 'meal', n: meal })
  return out
}
