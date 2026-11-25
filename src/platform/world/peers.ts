// 지속형 월드 온라인(같은 지역 친구 보이기)의 순수 로직. 설계 docs/superpowers/specs/2026-11-24-fishing-online-design.md
// 메시지 검증, 보내기 간격 결정, 받은 위치 보간, 끊긴 친구 정리. React·supabase·DOM을 쓰지 않는다.

export type Facing = 'up' | 'down' | 'left' | 'right'
export type PeerAct = 'walk' | 'fish'
export type PeerState = {
  id: string; handle: string; x: number; y: number; facing: Facing; moving: boolean; act: PeerAct; outfit: string; t: number
  /** 게임이 해석하는 짧은 문자열(자랑·이모트 등). 플랫폼은 내용을 모른다 */
  show?: string
}

/** 멈춰 있을 때 보내는 간격(ms, 사용자 결정) */
export const IDLE_SEND_MS = 2500
/** 이만큼 소식이 없으면 지운다 */
export const PEER_TIMEOUT_MS = 10_000
export const MAX_HANDLE = 32
export const MAX_OUTFIT = 512
export const MAX_SHOW = 128

const FACINGS: readonly string[] = ['up', 'down', 'left', 'right']
const ACTS: readonly string[] = ['walk', 'fish']
const MIN_SPAN_MS = 100
const MAX_SPAN_MS = 1000

/**
 * 움직일 때 보내는 간격(ms). 방 인원 n(나 포함)이 많을수록 길다(사용자 결정: 동적).
 * 방 하나의 초당 메시지 ≈ n²·r 이고 r = min(4, 80/n²)이면 6명이 어떻게 나뉘어도 모든 방 합이 초당 80 이하.
 */
export function moveIntervalMs(n: number): number {
  return Math.max(250, Math.ceil((1000 * n * n) / 80))
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function parsePeerState(raw: unknown): PeerState | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64) return null
  if (typeof r.handle !== 'string' || r.handle.length === 0 || r.handle.length > MAX_HANDLE) return null
  if (!isFiniteNum(r.x) || !isFiniteNum(r.y) || !isFiniteNum(r.t)) return null
  if (typeof r.facing !== 'string' || !FACINGS.includes(r.facing)) return null
  if (typeof r.act !== 'string' || !ACTS.includes(r.act)) return null
  if (typeof r.moving !== 'boolean') return null
  if (typeof r.outfit !== 'string' || r.outfit.length > MAX_OUTFIT) return null
  const out: PeerState = {
    id: r.id, handle: r.handle, x: r.x, y: r.y, facing: r.facing as Facing, moving: r.moving, act: r.act as PeerAct,
    outfit: r.outfit, t: r.t,
  }
  // 잘못된 show는 그 칸만 버린다(위치는 받는다)
  if (typeof r.show === 'string' && r.show.length <= MAX_SHOW) out.show = r.show
  return out
}

export type SendClock = { lastAt: number; lastSig: string; lastN: number }
export const newSendClock = (): SendClock => ({ lastAt: -Infinity, lastSig: '', lastN: 0 })

export function shouldSend(c: SendClock, now: number, moving: boolean, sig: string, n: number): boolean {
  if (n < 2) return false
  if (n > c.lastN) return true
  const since = now - c.lastAt
  const move = moveIntervalMs(n)
  if (sig !== c.lastSig && since >= move) return true
  return since >= (moving ? move : IDLE_SEND_MS)
}

export function markSent(_c: SendClock, now: number, sig: string, n: number): SendClock {
  return { lastAt: now, lastSig: sig, lastN: n }
}

export type PeerEntry = { prev: { x: number; y: number }; cur: PeerState; recvAt: number; span: number }
export type PeerBook = Map<string, PeerEntry>
export type ShownPeer = Omit<PeerState, 't'>

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function shownXY(e: PeerEntry, now: number): { x: number; y: number } {
  const a = e.span === 0 ? 1 : clamp((now - e.recvAt) / e.span, 0, 1)
  return { x: e.prev.x + (e.cur.x - e.prev.x) * a, y: e.prev.y + (e.cur.y - e.prev.y) * a }
}

export function receivePeer(book: PeerBook, s: PeerState, now: number, selfId: string): void {
  if (s.id === selfId) return
  const e = book.get(s.id)
  if (!e) {
    book.set(s.id, { prev: { x: s.x, y: s.y }, cur: s, recvAt: now, span: 0 })
    return
  }
  if (s.t <= e.cur.t) return
  book.set(s.id, { prev: shownXY(e, now), cur: s, recvAt: now, span: clamp(s.t - e.cur.t, MIN_SPAN_MS, MAX_SPAN_MS) })
}

export function prunePeers(book: PeerBook, now: number, present: ReadonlySet<string>): void {
  for (const [id, e] of book) if (!present.has(id) || now - e.recvAt >= PEER_TIMEOUT_MS) book.delete(id)
}

export function peersAt(book: PeerBook, now: number): ShownPeer[] {
  const out: ShownPeer[] = []
  for (const e of book.values()) {
    const { x, y } = shownXY(e, now)
    const { t: _t, ...rest } = e.cur
    out.push({ ...rest, x, y })
  }
  return out.sort((a, b) => a.y - b.y)
}
