// 대회 참가비 화면 도우미 (지갑 설계 §10). 참가비는 만들 때 정하고 바꿀 수 없다. 모인 돈은 끝난 뒤
// 순위(행동 1번 이상)에 든 사람이 0명이면 전원 환불, 1~2명이면 1등 독식, 3명 이상이면 60/30/10(나머지 1등).
import { FEE_MAX } from '../../games/economy.ts'
import { ApiError } from '../../lib/api.ts'

const PRESETS = [0, 100, 500, 1000, 5000, 10000]

/** 대회 행의 참가비. 옛 DB라 열이 없으면 0 */
export function feeOf(c: { entry_fee?: number | null } | null | undefined): number {
  const f = c?.entry_fee
  return typeof f === 'number' && f > 0 ? f : 0
}

/** 입력 문자열 → 참가비. 빈칸은 0, 쉼표 허용. 정수가 아니면 null */
export function parseFee(s: string): number | null {
  const t = s.replace(/,/g, '').trim()
  if (t === '') return 0
  if (!/^\d+$/.test(t)) return null
  return Number(t)
}

/** 정할 수 있는 최대 참가비: min(내 잔액, FEE_MAX). 만든 사람도 내므로 잔액이 상한이다. 잔액을 모르면 FEE_MAX */
export function feeCap(balance: number | null): number {
  return balance === null ? FEE_MAX : Math.max(0, Math.min(balance, FEE_MAX))
}

export function feePresets(balance: number | null): number[] {
  const cap = feeCap(balance)
  return PRESETS.filter((p) => p <= cap)
}

/** 입력한 참가비의 문제(없으면 null). 잔액을 모르면 잔액 검사는 서버에 맡긴다 */
export function feeProblem(fee: number | null, balance: number | null): string | null {
  if (fee === null || fee < 0) return '참가비를 다시 적어 주세요'
  if (fee > FEE_MAX) return `참가비는 ${FEE_MAX.toLocaleString('ko-KR')} G까지예요`
  if (balance !== null && fee > balance) return '골드가 부족해요'
  return null
}

/** 모인 돈 분배(서버 _contest_payouts와 같은 규칙). ranked = 순위에 든 사람 수. 0명이면 [] (전원 환불) */
export function splitPool(pool: number, ranked: number): number[] {
  if (pool <= 0 || ranked <= 0) return []
  if (ranked <= 2) return [pool]
  const second = Math.floor((pool * 3) / 10)
  const third = Math.floor(pool / 10)
  return [pool - second - third, second, third]
}

/** fee_mismatch 오류가 알려 준 지금 참가비. 아니면 null */
export function mismatchFee(e: unknown): number | null {
  if (!(e instanceof ApiError) || e.code !== 'fee_mismatch') return null
  const d = (e.body as { details?: unknown } | undefined)?.details
  const n = typeof d === 'string' && /^\d+$/.test(d) ? Number(d) : typeof d === 'number' ? d : NaN
  return Number.isInteger(n) && n >= 0 ? n : null
}
