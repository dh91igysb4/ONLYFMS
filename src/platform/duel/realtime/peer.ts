// 실시간 대국 연결(레이싱 설계 §6.2). 두 브라우저가 Supabase Realtime 채널로 WebRTC 연결 정보를 주고받아
// DataChannel(순서 없음·재전송 없음)로 바이트를 보낸다. CONNECT_TIMEOUT_MS 안에 열리지 않으면 같은 채널의
// 브로드캐스트로 대신 보낸다(RELAY_HZ 상한, 넘친 것은 마지막 것만 다음 슬롯에). 나중에 열리면 직접 연결로 바꾼다.
// 게임은 내용을 모른다: 바이트만 나른다. 직접 연결은 재전송이 없고 대체 경로는 최신 것만 남기므로,
// 꼭 닿아야 하는 드문 메시지는 게임이 urgent로 되풀이해 보낸다.

/** 이 안에 DataChannel이 안 열리면 대체 경로 */
export const CONNECT_TIMEOUT_MS = 4000
/** 대체 경로 보내기 상한(초당). Supabase 무료 한도 초당 100건(낚시 80건)을 넘지 않게 */
export const RELAY_HZ = 10
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
/** 주소 모으기를 기다리는 최대 시간(ms). 넘으면 모은 데까지 보낸다 */
const GATHER_MAX_MS = 2000
const log = (...a: unknown[]) => console.info('duel rtc:', ...a)

export type LinkStatus = 'connecting' | 'direct' | 'relay' | 'closed'

export type RealtimeLink = {
  /** urgent: 대체 경로의 보내기 상한을 건너뛰고 바로 보낸다(드문 중요 메시지용, 기다리는 일반 패킷은 그대로) */
  send(data: ArrayBuffer, urgent?: boolean): void
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
  onicegatheringstatechange: (() => void) | null
  onconnectionstatechange: (() => void) | null
  readonly iceGatheringState: string
  readonly connectionState: string
  /** 주소 모으기가 끝난 뒤에는 후보가 모두 SDP 안에 들어 있다 */
  readonly localDescription: unknown
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

/**
 * 신호. hi: 링크마다 새 sid(새로고침하면 바뀐다). offer·answer는 offer id로 짝을 맞춰 옛 offer에 대한 답을 새 연결에
 * 넣지 않는다(최종 리뷰 I4). 후보(ICE)는 따로 보내지 않고, 주소 모으기가 끝난 설명(SDP) 안에 담아 보낸다:
 * 실제 브라우저 시험에서 따로 보낸 후보가 상대에 하나도 붙지 않아 연결이 바로 failed였다.
 */
type Sig =
  | { from: 0 | 1; kind: 'hi'; sid: string }
  | { from: 0 | 1; kind: 'offer' | 'answer'; id: string; data: unknown }

type SigBody = Sig extends infer T ? (T extends Sig ? Omit<T, 'from'> : never) : never

const newId = () => Math.random().toString(36).slice(2, 12)

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
  // 대체 경로 보내기 조절
  const gap = 1000 / RELAY_HZ
  let lastRelay = -Infinity
  let pending: ArrayBuffer | null = null
  let relayTimer: ReturnType<typeof setTimeout> | null = null

  const sid = newId()
  // 좌석 0: 지금 offer id, 그 offer에 답을 받았는지, 누구(sid)에게 냈는지. 좌석 1: 받아서 답한 offer id
  let offerId: string | null = null
  let answered = false
  let peerSid: string | null = null
  // 연결이 확실히 실패했다(다시 offer를 받아도 된다)
  let failed = false

  /** 주소 모으기가 끝나기를(최대 GATHER_MAX_MS) 기다린 뒤 후보가 든 설명을 돌려준다 */
  const gathered = (p: RTCPeerConnectionLike): Promise<unknown> =>
    new Promise((resolve) => {
      if (p.iceGatheringState === 'complete') return resolve(p.localDescription)
      const done = () => { clearTimeout(t); p.onicegatheringstatechange = null; resolve(p.localDescription) }
      const t = setTimeout(done, GATHER_MAX_MS)
      p.onicegatheringstatechange = () => { if (p.iceGatheringState === 'complete') done() }
    })

  const setStatus = (s: LinkStatus) => {
    if (status === s || status === 'closed') return
    status = s
    for (const cb of statusCbs) cb(s)
  }
  const deliver = (d: ArrayBuffer) => { for (const cb of msgCbs) cb(d) }
  const signal = (msg: SigBody) => {
    if (status === 'closed') return
    void channel.send({ type: 'broadcast', event: 'sig', payload: { ...msg, from: mySeat } }).catch(() => {})
  }

  const attach = (ch: DataChannelLike) => {
    dc = ch
    ch.binaryType = 'arraybuffer'
    ch.onmessage = (e) => { if (e.data instanceof ArrayBuffer) deliver(e.data) }
    ch.onopen = () => { if (dc === ch) { log('direct open'); failed = false; setStatus('direct') } }
    ch.onclose = () => {
      if (dc !== ch) return
      log('direct closed')
      dc = null
      failed = true
      setStatus('relay')
      // 좌석 1은 다시 연결해 달라고 인사한다(좌석 0이 새 offer를 낸다)
      if (mySeat === 1) signal({ kind: 'hi', sid })
    }
    if (ch.readyState === 'open') setStatus('direct')
  }

  const resetPc = (): RTCPeerConnectionLike | null => {
    // 내가 닫는 옛 연결의 닫힘 알림이 상태를 바꾸지 않게 먼저 떼어 낸다
    const oldDc = dc
    const oldPc = pc
    dc = null
    pc = null
    if (oldDc) { oldDc.onclose = null; oldDc.onopen = null; oldDc.onmessage = null; try { oldDc.close() } catch { /* ignore */ } }
    if (oldPc) { oldPc.onicecandidate = null; oldPc.ondatachannel = null; try { oldPc.close() } catch { /* ignore */ } }
    failed = false
    let p: RTCPeerConnectionLike
    try {
      p = makeRtc()
    } catch (e) {
      // WebRTC를 못 쓰는 브라우저: 바로 대체 경로
      console.warn('duel: rtc unavailable', e)
      setStatus('relay')
      return null
    }
    pc = p
    p.ondatachannel = (e) => { if (pc === p) attach(e.channel) }
    p.onconnectionstatechange = () => {
      if (pc !== p) return
      log('connection', p.connectionState)
      if (p.connectionState === 'failed') {
        failed = true
        // 좌석 1은 다시 해 보자고 인사한다(좌석 0이 새 offer)
        if (mySeat === 1) signal({ kind: 'hi', sid })
      }
    }
    return p
  }

  const offer = async () => {
    const id = newId()
    offerId = id
    answered = false
    const p = resetPc()
    if (!p) return
    attach(p.createDataChannel('race', { ordered: false, maxRetransmits: 0 }))
    const o = await p.createOffer()
    if (offerId !== id) return
    await p.setLocalDescription(o)
    const full = await gathered(p)
    if (offerId !== id || pc !== p) return
    log('offer sent')
    signal({ kind: 'offer', id, data: full })
  }

  const onSig = async (s: Sig) => {
    if (status === 'closed' || s.from === mySeat) return
    try {
      if (s.kind === 'hi') {
        if (mySeat === 0) {
          // 같은 상대(sid)와 이미 진행 중이거나 이어졌으면 그대로 둔다. 새로고침한 상대(sid가 다름)나 실패한 연결만 새 offer.
          // 열리는 데 걸리는 0.x초 동안 오는 인사로 연결을 갈아엎지 않는다
          if (s.sid === peerSid && !failed) return
          log('hi from seat 1, offering', s.sid === peerSid ? '(retry)' : '(new)')
          peerSid = s.sid
          await offer()
        } else if (!pc || failed) {
          // 좌석 1은 offer를 아직 못 받았거나 연결이 실패했을 때만 인사로 답한다
          signal({ kind: 'hi', sid })
        }
      } else if (s.kind === 'offer' && mySeat === 1) {
        log('offer received')
        const p = resetPc()
        if (!p) return
        await p.setRemoteDescription(s.data)
        if (pc !== p) return
        const a = await p.createAnswer()
        if (pc !== p) return
        await p.setLocalDescription(a)
        const full = await gathered(p)
        if (pc !== p) return
        log('answer sent')
        signal({ kind: 'answer', id: s.id, data: full })
      } else if (s.kind === 'answer' && mySeat === 0) {
        // 옛 offer에 대한 답은 버린다
        if (s.id !== offerId || answered || !pc) return
        log('answer received')
        answered = true
        await pc.setRemoteDescription(s.data)
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
    .subscribe((st) => { if (st === 'SUBSCRIBED') signal({ kind: 'hi', sid }) })

  const timeout = setTimeout(() => { if (status === 'connecting') setStatus('relay') }, CONNECT_TIMEOUT_MS)

  return {
    send(d, urgent = false) {
      if (status === 'closed') return
      if (status === 'direct' && dc && dc.readyState === 'open') {
        try { dc.send(d); return } catch { /* 닫히는 중이면 대체 경로로 */ }
      }
      if (status === 'connecting') return // 아직 아무 길도 없다: 상태는 곧 다시 보낸다
      if (urgent) {
        void channel.send({ type: 'broadcast', event: 's', payload: { from: mySeat, b: toB64(d) } }).catch(() => {})
        return
      }
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
