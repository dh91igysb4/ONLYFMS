// 지갑 RPC 데이터 계층 (설계 §5.3·§5.4). 잔액 쓰기는 서버 함수만 한다.
import { rpc } from '../../lib/api.ts'
import { setWallet } from '../../lib/walletStore.ts'

export type MyWallet = { balance: number; today: Record<string, number>; earnedToday: number }

export type LedgerReason =
  | 'migrate' | 'world' | 'free' | 'daily_prize' | 'duel_stake' | 'duel_payout' | 'duel_refund'
  | 'contest_fee' | 'contest_prize' | 'contest_refund' | 'admin'

export type LedgerRow = {
  id: number
  handle: string | null
  delta: number
  balanceAfter: number
  reason: LedgerReason
  ref: string
  gameId: string | null
  note: string | null
  /** 사이트 하루 상한으로 줄기 전 금액. 안 줄었으면 null */
  rawDelta: number | null
  createdAt: string
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0))

/** my_wallet() → 저장소를 채우고 돌려준다 */
export async function fetchMyWallet(): Promise<MyWallet> {
  const d = await rpc<{ balance: number | string; today?: Record<string, number | string>; earned_today?: number | string }>('my_wallet')
  const today: Record<string, number> = {}
  for (const [k, v] of Object.entries(d?.today ?? {})) today[k] = num(v)
  const w = { balance: num(d?.balance), today, earnedToday: num(d?.earned_today) }
  setWallet(w)
  return w
}

/** 프로필용 잔액. 승인된 대상이 아니면 null */
export async function fetchUserWallet(handle: string): Promise<number | null> {
  const v = await rpc<number | string | null>('user_wallet', { p_handle: handle })
  return v === null || v === undefined ? null : num(v)
}

type RawLedger = {
  id: number | string; handle: string | null; delta: number | string; balance_after: number | string
  reason: LedgerReason; ref: string; game_id: string | null; note: string | null
  raw_delta: number | string | null; created_at: string
}

export async function adminGoldLedger(limit = 50): Promise<LedgerRow[]> {
  const rows = await rpc<RawLedger[] | null>('admin_gold_ledger', { p_limit: limit })
  return (rows ?? []).map((r) => ({
    id: num(r.id),
    handle: r.handle,
    delta: num(r.delta),
    balanceAfter: num(r.balance_after),
    reason: r.reason,
    ref: r.ref,
    gameId: r.game_id,
    note: r.note,
    rawDelta: r.raw_delta === null ? null : num(r.raw_delta),
    createdAt: r.created_at,
  }))
}

/** 관리자 조정. 새 잔액을 돌려준다. 오류 코드: forbidden · not_found · note_invalid · not_enough_gold */
export async function adminGoldAdjust(handle: string, delta: number, note: string): Promise<number> {
  return num(await rpc<number | string>('admin_gold_adjust', { p_handle: handle, p_delta: delta, p_note: note }))
}
