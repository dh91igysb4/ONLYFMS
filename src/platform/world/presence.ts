// 게임 전체 프레즌스(다른 지역 친구 위치). 채널 world:<gameId>, 각자 { 지역, 하는 일, 칸 }을 올린다.
// 설계 docs/superpowers/specs/2026-11-24-fishing-online-2a-design.md. 게임 id로 분기하지 않고, 실패해도 던지지 않는다.
import { supabase } from '../../lib/supabase.ts'
import { MAX_HANDLE } from './peers.ts'

export type OnlinePeer = { id: string; handle: string; area: string; act: 'walk' | 'fish'; tx: number; ty: number }

/** 움직이는 동안 칸 위치를 다시 올리는 최소 간격(ms) */
export const PRESENCE_MOVE_MS = 10_000

const AREA_RE = /^[a-z0-9-]{1,32}$/
const isTile = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000

export function parseOnlinePeer(raw: unknown): OnlinePeer | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64) return null
  if (typeof r.handle !== 'string' || r.handle.length === 0 || r.handle.length > MAX_HANDLE) return null
  if (typeof r.area !== 'string' || !AREA_RE.test(r.area)) return null
  if (r.act !== 'walk' && r.act !== 'fish') return null
  if (!isTile(r.tx) || !isTile(r.ty)) return null
  return { id: r.id, handle: r.handle, area: r.area, act: r.act, tx: r.tx, ty: r.ty }
}

export function shouldTrack(prev: { s: OnlinePeer; at: number } | null, next: OnlinePeer, now: number): boolean {
  if (!prev) return true
  if (prev.s.area !== next.area || prev.s.act !== next.act) return true
  const moved = prev.s.tx !== next.tx || prev.s.ty !== next.ty
  return moved && now - prev.at >= PRESENCE_MOVE_MS
}

export type WorldPresence = {
  /** 내 상태(듣기 전용이면 아무것도 안 함). now는 Date.now() */
  update(me: OnlinePeer, now: number): void
  /** 나 제외, 아이디 가나다순 */
  peers(): OnlinePeer[]
  onChange(cb: () => void): () => void
  leave(): void
}

export const presenceName = (gameId: string) => `world:${gameId}`

export function joinWorldPresence(gameId: string, selfId: string, listenOnly: boolean): WorldPresence {
  let list: OnlinePeer[] = []
  const subs = new Set<() => void>()
  let subscribed = false
  let left = false
  let last: { s: OnlinePeer; at: number } | null = null
  let pending: OnlinePeer | null = null
  let channel: ReturnType<typeof supabase.channel> | null = null
  const notify = () => { for (const cb of subs) cb() }

  const send = (s: OnlinePeer, now: number) => {
    if (!channel) return
    const mine = { s, at: now }
    last = mine
    // realtime-js는 실패를 reject 대신 'timed out'·'error'로 돌려준다. 그대로 두면 멈춘 사람은 안 보인 채 남는다.
    const retry = () => { if (last === mine) last = null }
    try {
      void Promise.resolve(channel.track(s)).then((r) => { if (r !== 'ok') retry() }, retry)
    } catch (e) {
      console.warn('world presence: track failed', e)
    }
  }

  try {
    const ch = supabase.channel(presenceName(gameId), { config: { presence: { key: selfId } } })
    ch.on('presence', { event: 'sync' }, () => {
      const out: OnlinePeer[] = []
      for (const [key, metas] of Object.entries(ch.presenceState() as Record<string, unknown[]>)) {
        if (key === selfId || !Array.isArray(metas) || metas.length === 0) continue
        const p = parseOnlinePeer(metas[metas.length - 1])
        if (p && p.id === key) out.push(p)
      }
      list = out.sort((a, b) => a.handle.localeCompare(b.handle, 'ko'))
      notify()
    })
    ch.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        subscribed = true
        if (!listenOnly && pending) {
          send(pending, Date.now())
          pending = null
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscribed = false
        last = null
        list = []
        notify()
        if (status !== 'CLOSED') console.warn('world presence: realtime', status)
      }
    })
    channel = ch
  } catch (e) {
    console.warn('world presence: subscribe failed', e)
  }

  return {
    update(me, now) {
      if (listenOnly || left || !channel) return
      if (!subscribed) {
        pending = me
        return
      }
      if (shouldTrack(last, me, now)) send(me, now)
    },
    peers: () => (left ? [] : list),
    onChange(cb) {
      subs.add(cb)
      return () => { subs.delete(cb) }
    },
    leave() {
      if (left) return
      left = true
      subs.clear()
      list = []
      if (channel) void Promise.resolve(supabase.removeChannel(channel)).catch(() => {})
    },
  }
}
