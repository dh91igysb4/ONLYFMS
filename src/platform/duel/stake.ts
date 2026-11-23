// 대전 판돈 화면 도우미 (지갑 설계 §9). 판돈은 한 사람이 맡기는 금액이고, 이긴 사람이 둘의 판돈을 모두 가진다.
import { STAKE_MAX } from '../../games/economy.ts'
import type { DuelView } from '../../lib/api.ts'

const PRESETS = [0, 100, 500, 1000, 5000, 10000]

/** 대국·목록 항목의 판돈. 옛 함수·옛 DB라 없으면 0 */
export function stakeOf(x: { stake?: number | null }): number {
  return typeof x.stake === 'number' && x.stake > 0 ? x.stake : 0
}

/** 입력 문자열 → 판돈. 빈칸은 0, 쉼표 허용. 정수가 아니면 null */
export function parseStake(s: string): number | null {
  const t = s.replace(/,/g, '').trim()
  if (t === '') return 0
  if (!/^\d+$/.test(t)) return null
  return Number(t)
}

/** 걸 수 있는 최대 판돈: min(내 잔액, STAKE_MAX). 잔액을 아직 모르면 STAKE_MAX(서버가 다시 검사) */
export function stakeCap(balance: number | null): number {
  return balance === null ? STAKE_MAX : Math.max(0, Math.min(balance, STAKE_MAX))
}

/** 빠른 선택 버튼. 상한 이하만 */
export function stakePresets(balance: number | null): number[] {
  const cap = stakeCap(balance)
  return PRESETS.filter((p) => p <= cap)
}

/** 입력한 판돈의 문제(없으면 null). 잔액을 모르면 잔액 검사는 서버에 맡긴다 */
export function stakeProblem(stake: number | null, balance: number | null): string | null {
  if (stake === null || stake < 0) return '판돈을 다시 적어 주세요'
  if (stake > STAKE_MAX) return `판돈은 ${STAKE_MAX.toLocaleString('ko-KR')} G까지예요`
  if (balance !== null && stake > balance) return '골드가 부족해요'
  return null
}

export type StakeOutcome = { kind: 'won' | 'lost' | 'refund'; amount: number }

/** 끝난 대국에서 내 판돈이 어떻게 됐나. 판돈 0·진행 중이면 null */
export function stakeOutcome(
  v: Pick<DuelView, 'status' | 'winner' | 'my_seat' | 'stake_settled'> & { stake?: number | null },
): StakeOutcome | null {
  const stake = stakeOf(v)
  if (stake === 0) return null
  // 새 함수는 내 장부 기준 실제 금액을 준다(계정 삭제로 판돈 일부가 사라진 경우까지 맞다)
  const g = v.stake_settled
  if (g && (v.status === 'finished' || v.status === 'void')) {
    if (g.payout > 0) return { kind: 'won', amount: g.payout }
    if (g.refund > 0) return { kind: 'refund', amount: g.refund }
    return g.staked > 0 ? { kind: 'lost', amount: g.staked } : null
  }
  // 옛 함수(stake_settled 없음): 대국 결과로 계산
  // 무효(대기 중 취소·만료 포함)는 맡긴 사람에게 돌려준다. 대기 중 만든 사람은 자리가 없어도 해당
  if (v.status === 'void') return { kind: 'refund', amount: stake }
  if (v.status !== 'finished' || v.my_seat === null) return null
  if (v.winner === null) return { kind: 'refund', amount: stake }
  return v.winner === v.my_seat ? { kind: 'won', amount: stake * 2 } : { kind: 'lost', amount: stake }
}
