// 실시간 대국 연결(레이싱 설계 §6.2). 두 브라우저가 Supabase Realtime 채널로 WebRTC 연결 정보를 주고받아
// DataChannel(순서 없음·재전송 없음)로 바이트를 보낸다. CONNECT_TIMEOUT_MS 안에 열리지 않으면 같은 채널의
// 브로드캐스트로 대신 보낸다(RELAY_HZ 상한, 넘친 것은 마지막 것만 다음 슬롯에). 나중에 열리면 직접 연결로 바꾼다.
// 게임은 내용을 모른다: 바이트만 나른다. 대체 경로는 최신 것만 남기므로 꼭 닿아야 하는 메시지는 게임이 되풀이해 보낸다.

/** 이 안에 DataChannel이 안 열리면 대체 경로 */
export const CONNECT_TIMEOUT_MS = 4000
/** 대체 경로 보내기 상한(초당). Supabase 무료 한도 초당 100건(낚시 80건)을 넘지 않게 */
export const RELAY_HZ = 10
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

export type LinkStatus = 'connecting' | 'direct' | 'relay' | 'closed'

export type RealtimeLink = {
  send(data: ArrayBuffer): void
  onMessage(cb: (data: ArrayBuffer) => void): () => void
  status(): LinkStatus
  onStatus(cb: (s: LinkStatus) => void): () => void
  close(): void
}

/** Supabase RealtimeChannel에서 쓰는 부분만 */
export interface ChannelLike {
  on(type: 'broadcast', filter: { event: string }, cb: (msg: { payload: unknown }) => void): ChannelLike
  subscribe(cb?: (status: string) => void): ChannelLike
  send(msg: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>
  unsubscribe(): Promise<unknown>
}

export interface DataChannelLike {
  readyState: string
  binaryType: string
  onopen: (() => void) | null
  onclose: (() => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  send(data: ArrayBuffer): void
  close(): void
}

/** RTCPeerConnection에서 쓰는 부분만 */
export interface RTCPeerConnectionLike {
  onicecandidate: ((e: { candidate: unknown }) => void) | null
  ondatachannel: ((e: { channel: DataChannelLike }) => void) | null
  createDataChannel(label: string, opts: { ordered: boolean; maxRetransmits: number }): DataChannelLike
  createOffer(): Promise<unknown>
  createAnswer(): Promise<unknown>
  setLocalDescription(d: unknown): Promise<void>
  setRemoteDescription(d: unknown): Promise<void>
  addIceCandidate(c: unknown): Promise<void>
  close(): void
}

/** 채널 이름. 대국 상태 신호 채널(`duel:<id>`)과 겹치지 않게 따로 둔다 */
export const linkChannelName = (matchId: string) => `duel-rt:${matchId}`

export type LinkOpts = {
  matchId: string
  mySeat: 0 | 1
  channel: ChannelLike
  rtc?: () => RTCPeerConnectionLike
}

type Sig = { from: 0 | 1; kind: 'hi' | 'offer' | 'answer' | 'ice'; data?: unknown }

function toB64(buf: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s)
}
function fromB64(s: string): ArrayBuffer {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

const defaultRtc = () =>
  new RTCPeerConnection({ iceServers: ICE_SERVERS }) as unknown as RTCPeerConnectionLike

export function openLink(opts: LinkOpts): RealtimeLink {
  const { mySeat, channel } = opts
  const makeRtc = opts.rtc ?? defaultRtc
  let status: LinkStatus = 'connecting'
  const msgCbs = new Set<(d: ArrayBuffer) => void>()
  const statusCbs = new Set<(s: LinkStatus) => void>()
  let pc: RTCPeerConnectionLike | null = null
  let dc: DataChannelLike | null = null
  let pendingIce: unknown[] = []
  let remoteSet = false
  // 대체 경로 보내기 조절
  const gap = 1000 / RELAY_HZ
  let lastRelay = -Infinity
  let pending: ArrayBuffer | null = null
  let relayTimer: ReturnType<typeof setTimeout> | null = null

  const setStatus = (s: LinkStatus) => {
    if (status === s || status === 'closed') return
    status = s
    for (const cb of statusCbs) cb(s)
  }
  const deliver = (d: ArrayBuffer) => { for (const cb of msgCbs) cb(d) }
  const signal = (kind: Sig['kind'], data?: unknown) => {
    if (status === 'closed') return
    void channel.send({ type: 'broadcast', event: 'sig', payload: { from: mySeat, kind, data } satisfies Sig }).catch(() => {})
  }

  const attach = (ch: DataChannelLike) => {
    dc = ch
    ch.binaryType = 'arraybuffer'
    ch.onmessage = (e) => { if (e.data instanceof ArrayBuffer) deliver(e.data) }
    ch.onopen = () => setStatus('direct')
    ch.onclose = () => { if (dc === ch) { dc = null; setStatus('relay') } }
    if (ch.readyState === 'open') setStatus('direct')
  }

  const resetPc = (): RTCPeerConnectionLike | null => {
    try { dc?.close() } catch { /* ignore */ }
    try { pc?.close() } catch { /* ignore */ }
    dc = null
    pendingIce = []
    remoteSet = false
    try {
      pc = makeRtc()
    } catch (e) {
      // WebRTC를 못 쓰는 브라우저: 바로 대체 경로
      console.warn('duel: rtc unavailable', e)
      pc = null
      setStatus('relay')
      return null
    }
    pc.onicecandidate = (e) => { if (e.candidate) signal('ice', e.candidate) }
    pc.ondatachannel = (e) => attach(e.channel)
    return pc
  }

  const flushIce = async (p: RTCPeerConnectionLike) => {
    const list = pendingIce
    pendingIce = []
    for (const c of list) await p.addIceCandidate(c).catch(() => {})
  }

  const offer = async () => {
    const p = resetPc()
    if (!p) return
    attach(p.createDataChannel('race', { ordered: false, maxRetransmits: 0 }))
    const o = await p.createOffer()
    await p.setLocalDescription(o)
    signal('offer', o)
  }

  const onSig = async (s: Sig) => {
    if (status === 'closed' || s.from === mySeat) return
    try {
      if (s.kind === 'hi') {
        // 좌석 0이 연결을 연다. 좌석 1은 아직 offer를 못 받았으면 인사로 답한다(늦게 들어온 쪽을 위해)
        if (mySeat === 0) { if (status !== 'direct') await offer() }
        else if (!pc) signal('hi')
      } else if (s.kind === 'offer' && mySeat === 1) {
        const p = resetPc()
        if (!p) return
        await p.setRemoteDescription(s.data)
        remoteSet = true
        await flushIce(p)
        const a = await p.createAnswer()
        await p.setLocalDescription(a)
        signal('answer', a)
      } else if (s.kind === 'answer' && mySeat === 0 && pc) {
        await pc.setRemoteDescription(s.data)
        remoteSet = true
        await flushIce(pc)
      } else if (s.kind === 'ice') {
        if (pc && remoteSet) await pc.addIceCandidate(s.data).catch(() => {})
        else pendingIce.push(s.data)
      }
    } catch (e) {
      console.warn('duel: rtc signaling failed', e)
    }
  }

  const relayNow = (d: ArrayBuffer) => {
    lastRelay = Date.now()
    void channel.send({ type: 'broadcast', event: 's', payload: { from: mySeat, b: toB64(d) } }).catch(() => {})
  }

  channel
    .on('broadcast', { event: 'sig' }, (m) => { void onSig(m.payload as Sig) })
    .on('broadcast', { event: 's' }, (m) => {
      const p = m.payload as { from?: unknown; b?: unknown }
      if (status === 'closed' || p.from === mySeat || typeof p.b !== 'string') return
      try { deliver(fromB64(p.b)) } catch { /* 깨진 값은 버린다 */ }
    })
    .subscribe((s) => { if (s === 'SUBSCRIBED') signal('hi') })

  const timeout = setTimeout(() => { if (status === 'connecting') setStatus('relay') }, CONNECT_TIMEOUT_MS)

  return {
    send(d) {
      if (status === 'closed') return
      if (status === 'direct' && dc && dc.readyState === 'open') {
        try { dc.send(d); return } catch { /* 닫히는 중이면 대체 경로로 */ }
      }
      if (status === 'connecting') return // 아직 아무 길도 없다: 상태는 곧 다시 보낸다
      const wait = lastRelay + gap - Date.now()
      if (wait <= 0 && !relayTimer) { relayNow(d); return }
      pending = d
      if (!relayTimer) {
        relayTimer = setTimeout(() => {
          relayTimer = null
          if (pending && status !== 'closed') { const p = pending; pending = null; relayNow(p) }
        }, Math.max(0, wait))
      }
    },
    onMessage(cb) { msgCbs.add(cb); return () => { msgCbs.delete(cb) } },
    status: () => status,
    onStatus(cb) { statusCbs.add(cb); return () => { statusCbs.delete(cb) } },
    close() {
      if (status === 'closed') return
      status = 'closed'
      clearTimeout(timeout)
      if (relayTimer) clearTimeout(relayTimer)
      try { dc?.close() } catch { /* ignore */ }
      try { pc?.close() } catch { /* ignore */ }
      void channel.unsubscribe().catch(() => {})
      msgCbs.clear()
      statusCbs.clear()
    },
  }
}
