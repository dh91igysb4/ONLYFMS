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
  /** 도전과제 보너스(%, my_wallet free_bonus_pct). 자유 플레이 골드 ×(100 + 이 값)/100. 모르면 0 */
  freeBonusPct: number
}

const EMPTY: WalletSnapshot = { balance: null, today: {}, earnedToday: 0, freeBonusPct: 0 }
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

export function setWallet(w: { balance: number; today: Record<string, number>; earnedToday: number; freeBonusPct?: number }): void {
  emit({ balance: w.balance, today: { ...w.today }, earnedToday: w.earnedToday, freeBonusPct: w.freeBonusPct ?? 0 })
}

export function subscribeWallet(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 로그아웃·테스트 */
export function resetWallet(): void {
  emit(EMPTY)
  setPrizes([])
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

// ---- 받은 상금 (지갑 3단계, 설계 §8) ----
// my_wallet()의 prizes(최근 3일 본인 장부 daily_prize·contest_prize)를 담는다. 잔액 스냅숏과 따로 두어
// 잔액만 쓰는 화면이 상금 목록 때문에 다시 그려지지 않게 한다.
export type Prize = {
  /** 장부 id. 알림 확인 기록은 확인한 가장 큰 id다 */
  id: number
  reason: 'daily_prize' | 'contest_prize'
  contestId: string
  gameId: string | null
  amount: number
  /** 'k등' */
  note: string | null
  at: string
}

let prizes: Prize[] = []
const prizeListeners = new Set<() => void>()

export function getPrizes(): Prize[] {
  return prizes
}

export function setPrizes(next: Prize[]): void {
  if (next.length === 0 && prizes.length === 0) return
  prizes = next
  for (const fn of prizeListeners) {
    try { fn() } catch { /* 구독자 오류가 다른 구독자를 막지 않게 */ }
  }
}

export function subscribePrizes(fn: () => void): () => void {
  prizeListeners.add(fn)
  return () => { prizeListeners.delete(fn) }
}

const seenKey = (uid: string) => `onlyfms:prize-seen:${uid}`

function seenId(uid: string): number {
  try {
    const n = Number(localStorage.getItem(seenKey(uid)))
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

/** 아직 확인하지 않은 상금(확인한 가장 큰 장부 id보다 큰 것) */
export function unseenPrizes(uid: string, list: Prize[]): Prize[] {
  const seen = seenId(uid)
  return list.filter((p) => p.id > seen)
}

/** 목록을 확인한 것으로 기록한다. 더 작은 id로 되돌리지 않는다. 저장에 실패해도 던지지 않는다 */
export function markPrizesSeen(uid: string, list: Prize[]): void {
  const max = Math.max(seenId(uid), ...list.map((p) => p.id))
  try {
    localStorage.setItem(seenKey(uid), String(max))
  } catch {
    /* 사파리 비공개 창 등: 이번 화면에서만 닫힌다 */
  }
}
