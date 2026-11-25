// 지속형 월드의 실시간 방(같은 지역 친구 보이기). 채널 world:<gameId>:<areaId>, 프레즌스로 인원, 브로드캐스트 'pos'로 위치.
// 게임 id로 분기하지 않는다. 실시간 연결이 실패해도 던지지 않는다(혼자 하는 게임은 그대로). 설계 2026-11-24-fishing-online-design.md
import { supabase } from '../../lib/supabase.ts'
import {
  markSent, newSendClock, parsePeerState, peersAt, prunePeers, receivePeer, shouldSend,
  type PeerBook, type PeerState, type ShownPeer,
} from './peers.ts'

export type WorldRoom = {
  /** 프레임마다 부른다. 보낼 때가 되면 브로드캐스트한다. now는 Date.now() 기준(받은 시각과 같은 시계) */
  tick(now: number, me: Omit<PeerState, 't'>): void
  /** 지금 그릴 친구들(나 제외) */
  peers(now: number): ShownPeer[]
  /** 방 인원(나 포함, 프레즌스 기준). 연결 전 1 */
  count(): number
  leave(): void
}

export const roomName = (gameId: string, areaId: string) => `world:${gameId}:${areaId}`

const sigOf = (m: Omit<PeerState, 't'>) => `${m.facing}|${m.moving ? 1 : 0}|${m.act}|${m.outfit}|${m.show ?? ''}`

export function joinWorldRoom(gameId: string, areaId: string, selfId: string): WorldRoom {
  const book: PeerBook = new Map()
  let present = new Set<string>([selfId])
  let clock = newSendClock()
  let left = false
  // 소켓이 붙어 있을 때만 보낸다. 끊긴 채 send하면 realtime-js가 매번 REST로 보내 사용량·지연이 생긴다
  let subscribed = false
  let channel: ReturnType<typeof supabase.channel> | null = null

  try {
    const ch = supabase.channel(roomName(gameId, areaId), {
      config: { presence: { key: selfId }, broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'pos' }, ({ payload }: { payload?: unknown }) => {
      const s = parsePeerState(payload)
      if (s) receivePeer(book, s, Date.now(), selfId)
    })
    ch.on('presence', { event: 'sync' }, () => {
      present = new Set([selfId, ...Object.keys(ch.presenceState())])
      prunePeers(book, Date.now(), present)
    })
    ch.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        subscribed = true
        void Promise.resolve(ch.track({ id: selfId })).catch(() => {})
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscribed = false
        present = new Set([selfId])
        if (status !== 'CLOSED') console.warn('world room: realtime', status)
      }
    })
    channel = ch
  } catch (e) {
    console.warn('world room: subscribe failed', e)
    channel = null
  }

  return {
    tick(now, me) {
      if (!channel || left || !subscribed) return
      // 시간 초과만 여기서 정리한다(프레즌스 반영이 위치 메시지보다 늦게 와도 새 친구가 깜빡이지 않게)
      prunePeers(book, Date.now(), new Set(book.keys()))
      const sig = sigOf(me)
      const n = present.size
      if (!shouldSend(clock, now, me.moving, sig, n)) return
      clock = markSent(clock, now, sig, n)
      try {
        void Promise.resolve(channel.send({ type: 'broadcast', event: 'pos', payload: { ...me, t: now } })).catch(() => {})
      } catch (e) {
        console.warn('world room: send failed', e)
      }
    },
    peers(now) {
      if (!channel || left) return []
      return peersAt(book, now)
    },
    count: () => present.size,
    leave() {
      if (left) return
      left = true
      book.clear()
      if (channel) void Promise.resolve(supabase.removeChannel(channel)).catch(() => {})
    },
  }
}
