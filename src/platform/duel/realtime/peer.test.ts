import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  CONNECT_TIMEOUT_MS,
  RELAY_HZ,
  openLink,
  type ChannelLike,
  type DataChannelLike,
  type RTCPeerConnectionLike,
  type RealtimeLink,
} from './peer.ts'

// ---- 가짜 채널: 같은 hub의 다른 채널에만 브로드캐스트를 넘긴다(Supabase는 기본으로 자기에게 되돌리지 않는다)
type Listener = { event: string; cb: (msg: { payload: unknown }) => void }
function channelHub() {
  const all: FakeChannel[] = []
  const sent: { event: string; payload: unknown }[] = []
  class FakeChannel implements ChannelLike {
    listeners: Listener[] = []
    subscribed = false
    unsubscribed = false
    constructor() { all.push(this) }
    on(_type: 'broadcast', filter: { event: string }, cb: (msg: { payload: unknown }) => void) {
      this.listeners.push({ event: filter.event, cb })
      return this
    }
    subscribe(cb?: (status: string) => void) {
      queueMicrotask(() => { this.subscribed = true; cb?.('SUBSCRIBED') })
      return this
    }
    send(msg: { type: 'broadcast'; event: string; payload: unknown }) {
      sent.push({ event: msg.event, payload: msg.payload })
      for (const c of all) {
        if (c === this) continue
        for (const l of c.listeners) {
          if (l.event !== msg.event) continue
          // 받는 순간 구독 중인 채널에만(Supabase처럼 놓친 메시지는 다시 오지 않는다)
          queueMicrotask(() => { if (c.subscribed && !c.unsubscribed) l.cb({ payload: msg.payload }) })
        }
      }
      return Promise.resolve('ok')
    }
    unsubscribe() { this.unsubscribed = true; return Promise.resolve('ok') }
  }
  return { make: () => new FakeChannel(), sent }
}

// ---- 가짜 RTC: offer/answer가 둘 다 놓이면 DataChannel 한 쌍을 잇는다. works=false면 끝내 열리지 않는다
/** openDelayMs: 진짜 브라우저처럼 답을 놓은 뒤 연결이 열리기까지 걸리는 시간(가짜 타이머) */
function rtcHub(works = true, openDelayMs = 0) {
  const pcs: FakePC[] = []
  class FakeDC implements DataChannelLike {
    readyState: 'connecting' | 'open' | 'closed' = 'connecting'
    binaryType = 'blob'
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((e: { data: unknown }) => void) | null = null
    peer: FakeDC | null = null
    send(d: ArrayBuffer) {
      const p = this.peer
      if (this.readyState !== 'open' || !p) throw new Error('not open')
      queueMicrotask(() => p.onmessage?.({ data: d }))
    }
    close() {
      if (this.readyState === 'closed') return
      this.readyState = 'closed'
      this.onclose?.()
      // 한쪽이 닫히면 다른 쪽도 곧 닫힌다
      const p = this.peer
      if (p) queueMicrotask(() => p.close())
    }
  }
  let seq = 0
  // gathered: 주소 모으기가 끝난 뒤의 설명(후보가 SDP 안에 들어 있다). 진짜 브라우저의 localDescription처럼
  type Desc = { type: string; sdp: string; for?: string; gathered?: boolean }
  class FakePC implements RTCPeerConnectionLike {
    onicecandidate: ((e: { candidate: unknown }) => void) | null = null
    ondatachannel: ((e: { channel: DataChannelLike }) => void) | null = null
    onicegatheringstatechange: (() => void) | null = null
    onconnectionstatechange: (() => void) | null = null
    iceGatheringState = 'new'
    connectionState = 'new'
    get localDescription() { return this.local && (this.iceGatheringState === 'complete' ? { ...this.local, gathered: true } : this.local) }
    local: Desc | null = null
    remote: Desc | null = null
    dc: FakeDC | null = null
    closed = false
    opts: unknown
    constructor() { pcs.push(this) }
    createDataChannel(_label: string, opts: unknown) { this.opts = opts; this.dc = new FakeDC(); return this.dc }
    async createOffer() { return { type: 'offer', sdp: `o${++seq}` } }
    async createAnswer() { return { type: 'answer', sdp: `a${++seq}`, for: this.remote?.sdp } }
    async setLocalDescription(d: unknown) {
      this.local = d as Desc
      this.iceGatheringState = 'gathering'
      // 주소 모으기는 잠시 걸린다(가짜 타이머 30ms)
      setTimeout(() => {
        this.onicecandidate?.({ candidate: { c: 1 } })
        this.iceGatheringState = 'complete'
        this.onicegatheringstatechange?.()
        this.onicecandidate?.({ candidate: null })
      }, 30)
    }
    async setRemoteDescription(d: unknown) {
      const desc = d as Desc
      if (this.closed) throw new Error('InvalidStateError: closed')
      // 진짜 RTCPeerConnection처럼: 이미 답을 받았거나, 내 offer가 아닌 답이면 거절한다
      if (desc.type === 'answer' && (this.remote || this.local?.sdp !== desc.for)) throw new Error('InvalidStateError')
      this.remote = desc
      this.tryLink()
    }
    async addIceCandidate() {}
    close() { this.closed = true; if (this.dc) this.dc.close() }
    tryLink() {
      if (!works) return
      for (const offerer of pcs) {
        if (offerer.closed || !offerer.dc || !offerer.remote || offerer.dc.peer) continue
        const answerer = pcs.find((p) => !p.closed && !p.dc && p.local?.sdp === offerer.remote!.sdp)
        if (!answerer) continue
        // 따로 오는 후보 메시지를 쓰지 않으므로, 양쪽 설명이 모두 후보를 품고 있어야 열린다
        if (!offerer.remote.gathered || !answerer.remote?.gathered) continue
        const mine = offerer.dc
        const theirs = new FakeDC()
        mine.peer = theirs
        theirs.peer = mine
        const open = () => {
          if (offerer.closed || answerer.closed) return
          answerer.ondatachannel?.({ channel: theirs })
          mine.readyState = 'open'
          theirs.readyState = 'open'
          mine.onopen?.()
          theirs.onopen?.()
        }
        if (openDelayMs > 0) setTimeout(open, openDelayMs)
        else queueMicrotask(open)
      }
    }
  }
  return { make: () => new FakePC(), pcs }
}

const flush = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }
/** 마이크로태스크를 비우고, 주소 모으기(가짜 30ms)가 끝나도록 시간을 조금씩 흘린다(연결이 열리는 시험용) */
const settle = async (n = 20) => {
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < n; i++) await Promise.resolve()
    vi.advanceTimersByTime(40)
  }
  for (let i = 0; i < n; i++) await Promise.resolve()
}
const bytes = (...v: number[]) => new Uint8Array(v).buffer
const got = (link: RealtimeLink) => {
  const out: number[][] = []
  link.onMessage((d) => out.push(Array.from(new Uint8Array(d))))
  return out
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function pair(works = true) {
  const ch = channelHub()
  const rtc = rtcHub(works)
  const a = openLink({ matchId: 'm1', mySeat: 0, channel: ch.make(), rtc: rtc.make })
  const b = openLink({ matchId: 'm1', mySeat: 1, channel: ch.make(), rtc: rtc.make })
  return { a, b, ch, rtc }
}

test('seat 0 offers, seat 1 answers, both reach direct and exchange bytes', async () => {
  const { a, b, rtc, ch } = pair()
  expect(a.status()).toBe('connecting')
  await settle()
  expect(a.status()).toBe('direct')
  expect(b.status()).toBe('direct')
  // 좌석 0만 DataChannel을 만든다. 순서 없음·재전송 없음
  expect(rtc.pcs.filter((p) => p.dc).length).toBe(1)
  expect(rtc.pcs.find((p) => p.dc)!.opts).toEqual({ ordered: false, maxRetransmits: 0 })
  const fromA = got(b)
  const fromB = got(a)
  a.send(bytes(1, 2, 3))
  b.send(bytes(9))
  await settle()
  expect(fromA).toEqual([[1, 2, 3]])
  expect(fromB).toEqual([[9]])
  // 직접 연결 중에는 상태를 채널로 보내지 않는다
  expect(ch.sent.filter((s) => s.event === 's')).toEqual([])
})

test('falls back to relay after CONNECT_TIMEOUT_MS and still delivers', async () => {
  const { a, b } = pair(false)
  const statuses: string[] = []
  a.onStatus((s) => statuses.push(s))
  await flush()
  expect(a.status()).toBe('connecting')
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1)
  expect(a.status()).toBe('connecting')
  vi.advanceTimersByTime(1)
  expect(a.status()).toBe('relay')
  expect(b.status()).toBe('relay')
  expect(statuses).toEqual(['relay'])
  const fromA = got(b)
  a.send(bytes(7, 8))
  await flush()
  expect(fromA).toEqual([[7, 8]])
})

test('relay sends at most RELAY_HZ, keeping the latest packet', async () => {
  const { a, b, ch } = pair(false)
  await flush()
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS)
  const fromA = got(b)
  const gap = 1000 / RELAY_HZ
  a.send(bytes(1)) // 바로 나간다
  a.send(bytes(2)) // 다음 슬롯을 기다리다
  a.send(bytes(3)) // 2를 덮어쓴다
  await flush()
  expect(fromA).toEqual([[1]])
  vi.advanceTimersByTime(gap - 1)
  await flush()
  expect(fromA).toEqual([[1]])
  vi.advanceTimersByTime(1)
  await flush()
  expect(fromA).toEqual([[1], [3]])
  expect(ch.sent.filter((s) => s.event === 's').length).toBe(2)
  // 1초 동안 매 틱 보내도 RELAY_HZ번 남짓
  for (let i = 0; i < 60; i++) { a.send(bytes(i)); vi.advanceTimersByTime(1000 / 60) }
  await flush()
  expect(ch.sent.filter((s) => s.event === 's').length).toBeLessThanOrEqual(2 + RELAY_HZ + 1)
})

test('a late DataChannel upgrades relay to direct', async () => {
  const ch = channelHub()
  const rtc = rtcHub()
  const a = openLink({ matchId: 'm1', mySeat: 0, channel: ch.make(), rtc: rtc.make })
  await settle()
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS)
  expect(a.status()).toBe('relay') // 상대가 아직 안 들어옴
  const b = openLink({ matchId: 'm1', mySeat: 1, channel: ch.make(), rtc: rtc.make })
  await settle()
  expect(a.status()).toBe('direct')
  expect(b.status()).toBe('direct')
})

test('close unsubscribes the channel and closes the peer', async () => {
  const ch = channelHub()
  const rtc = rtcHub()
  const chan = ch.make()
  const a = openLink({ matchId: 'm1', mySeat: 0, channel: chan, rtc: rtc.make })
  await settle()
  a.close()
  expect(a.status()).toBe('closed')
  expect(chan.unsubscribed).toBe(true)
  expect(rtc.pcs.every((p) => p.closed)).toBe(true)
  a.send(bytes(1)) // 닫힌 뒤에는 조용히 무시
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS)
  expect(a.status()).toBe('closed')
})

test('urgent packets skip the relay limit and do not replace the pending one', async () => {
  const { a, b } = pair(false)
  await flush()
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS)
  const fromA = got(b)
  a.send(bytes(1))
  a.send(bytes(2)) // 다음 슬롯을 기다린다
  a.send(bytes(42), true) // 바로 나간다
  await flush()
  expect(fromA).toEqual([[1], [42]])
  vi.advanceTimersByTime(1000 / RELAY_HZ)
  await flush()
  expect(fromA).toEqual([[1], [42], [2]])
})

test('both sides subscribing at the same moment still reach direct (최종 리뷰 I4a)', async () => {
  const { a, b } = pair()
  await settle(60)
  expect(a.status()).toBe('direct')
  expect(b.status()).toBe('direct')
  const fromA = got(b)
  a.send(bytes(5))
  await settle()
  expect(fromA).toEqual([[5]])
})

test('a refreshed seat reconnects directly (최종 리뷰 I4b)', async () => {
  for (const seat of [0, 1] as const) {
    const ch = channelHub()
    const rtc = rtcHub()
    const links = [openLink({ matchId: 'm1', mySeat: 0, channel: ch.make(), rtc: rtc.make }), openLink({ matchId: 'm1', mySeat: 1, channel: ch.make(), rtc: rtc.make })]
    await settle(60)
    expect(links.map((l) => l.status())).toEqual(['direct', 'direct'])
    links[seat].close()
    const again = openLink({ matchId: 'm1', mySeat: seat, channel: ch.make(), rtc: rtc.make })
    await settle(80)
    const other = links[1 - seat]
    expect(again.status()).toBe('direct')
    expect(other.status()).toBe('direct')
    const got2 = got(again)
    other.send(bytes(seat + 1))
    await settle()
    expect(got2).toEqual([[seat + 1]])
  }
})

test('a hi that arrives while the connection is still opening does not restart it (실제 브라우저 시험: ICE가 바로 failed)', async () => {
  const ch = channelHub()
  const rtc = rtcHub(true, 300)
  const a = openLink({ matchId: 'm1', mySeat: 0, channel: ch.make(), rtc: rtc.make })
  const b = openLink({ matchId: 'm1', mySeat: 1, channel: ch.make(), rtc: rtc.make })
  await flush(60)
  // 열리는 동안 좌석 1이 인사를 또 보내도(예: 늦게 온 구독 인사·답 인사) 좌석 0은 offer를 다시 내지 않는다
  for (let i = 0; i < 5; i++) {
    vi.advanceTimersByTime(50)
    await flush(20)
  }
  vi.advanceTimersByTime(300)
  await flush(40)
  expect(rtc.pcs.filter((p) => p.dc).length).toBe(1)
  expect(a.status()).toBe('direct')
  expect(b.status()).toBe('direct')
})

test('offer and answer carry the gathered candidates; no separate ice messages', async () => {
  const { a, ch } = pair()
  await settle(40)
  expect(a.status()).toBe('direct')
  const sigs = ch.sent.filter((x) => x.event === 'sig').map((x) => x.payload as { kind: string; data?: { gathered?: boolean } })
  expect(sigs.some((x) => x.kind === 'ice')).toBe(false)
  for (const x of sigs.filter((y) => y.kind === 'offer' || y.kind === 'answer')) expect(x.data?.gathered).toBe(true)
})
