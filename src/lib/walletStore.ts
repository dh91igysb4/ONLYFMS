// 내 골드 잔액 저장소 (설계 docs/superpowers/specs/2026-11-23-wallet-design.md §5.5). React 없음.
// 채우는 길: 앱 로드 때 my_wallet(), world 응답의 최상위 gold, 자유 플레이·대전·대회 뒤 my_wallet().
// 실시간 구독은 하지 않는다.

export type WalletSnapshot = {
  /** 아직 모르면 null */
  balance: number | null
  /** 오늘(KST) 자유 플레이 게임별 줄기 전 합계 (my_wallet today) */
  today: Record<string, number>
  /** 오늘(KST) 사이트 하루 상한에 세는 실제 수입 합계 (my_wallet earned_today) */
  earnedToday: number
}

const EMPTY: WalletSnapshot = { balance: null, today: {}, earnedToday: 0 }
let snap: WalletSnapshot = EMPTY
/** 잔액을 바꿀 때마다 1씩. 늦게 도착한 my_wallet()이 더 새 world 잔액을 덮지 않게 비교한다 */
let version = 0
const listeners = new Set<() => void>()

function emit(next: WalletSnapshot) {
  version += 1
  snap = next
  for (const fn of listeners) {
    try { fn() } catch { /* 구독자 오류가 다른 구독자를 막지 않게 */ }
  }
}

export function getWallet(): WalletSnapshot {
  return snap
}

/** 지금 저장소 판 번호. 요청을 보내기 전에 읽어 두고, 응답이 왔을 때 바뀌었는지 본다 */
export function walletVersion(): number {
  return version
}

/** 잔액만 바꾼다(world 응답). today·earnedToday는 그대로 */
export function setBalance(n: number): void {
  if (snap.balance === n) return
  emit({ ...snap, balance: n })
}

export function setWallet(w: { balance: number; today: Record<string, number>; earnedToday: number }): void {
  emit({ balance: w.balance, today: { ...w.today }, earnedToday: w.earnedToday })
}

export function subscribeWallet(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 로그아웃·테스트 */
export function resetWallet(): void {
  emit(EMPTY)
}

// ---- 사이트 하루 상한 알림 (설계 §5.5) ----
// world 응답의 gold_capped를 플랫폼 화면(WorldPage)이 받는다. 게임 화면은 이 값을 몰라도 된다.
export type GoldCapped = { asked: number; got: number }
const cappedListeners = new Set<(c: GoldCapped) => void>()

export function notifyGoldCapped(c: GoldCapped): void {
  for (const fn of cappedListeners) {
    try { fn(c) } catch { /* 알림 실패는 무시 */ }
  }
}

export function subscribeGoldCapped(fn: (c: GoldCapped) => void): () => void {
  cappedListeners.add(fn)
  return () => { cappedListeners.delete(fn) }
}
