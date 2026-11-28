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
        if (c === this || !c.subscribed || c.unsubscribed) continue
        for (const l of c.listeners) if (l.event === msg.event) queueMicrotask(() => l.cb({ payload: msg.payload }))
      }
      return Promise.resolve('ok')
    }
    unsubscribe() { this.unsubscribed = true; return Promise.resolve('ok') }
  }
  return { make: () => new FakeChannel(), sent }
}

// ---- 가짜 RTC: offer/answer가 둘 다 놓이면 DataChannel 한 쌍을 잇는다. works=false면 끝내 열리지 않는다
function rtcHub(works = true) {
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
    close() { this.readyState = 'closed'; this.onclose?.() }
  }
  class FakePC implements RTCPeerConnectionLike {
    onicecandidate: ((e: { candidate: unknown }) => void) | null = null
    ondatachannel: ((e: { channel: DataChannelLike }) => void) | null = null
    local: unknown = null
    remote: unknown = null
    dc: FakeDC | null = null
    closed = false
    opts: unknown
    constructor() { pcs.push(this) }
    createDataChannel(_label: string, opts: unknown) { this.opts = opts; this.dc = new FakeDC(); return this.dc }
    async createOffer() { return { type: 'offer', sdp: 'o' } }
    async createAnswer() { return { type: 'answer', sdp: 'a' } }
    async setLocalDescription(d: unknown) { this.local = d; queueMicrotask(() => this.onicecandidate?.({ candidate: { c: 1 } })) }
    async setRemoteDescription(d: unknown) { this.remote = d; this.tryLink() }
    async addIceCandidate() {}
    close() { this.closed = true }
    tryLink() {
      if (!works) return
      const offerer = pcs.find((p) => p.dc && p.remote)
      const answerer = pcs.find((p) => !p.dc && p.remote && p.local)
      if (!offerer || !answerer || offerer.dc!.peer) return
      const mine = offerer.dc!
      const theirs = new FakeDC()
      mine.peer = theirs
      theirs.peer = mine
      queueMicrotask(() => {
        answerer.ondatachannel?.({ channel: theirs })
        mine.readyState = 'open'
        theirs.readyState = 'open'
        mine.onopen?.()
        theirs.onopen?.()
      })
    }
  }
  return { make: () => new FakePC(), pcs }
}

const flush = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }
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
  await flush()
  expect(a.status()).toBe('direct')
  expect(b.status()).toBe('direct')
  // 좌석 0만 DataChannel을 만든다. 순서 없음·재전송 없음
  expect(rtc.pcs.filter((p) => p.dc).length).toBe(1)
  expect(rtc.pcs.find((p) => p.dc)!.opts).toEqual({ ordered: false, maxRetransmits: 0 })
  const fromA = got(b)
  const fromB = got(a)
  a.send(bytes(1, 2, 3))
  b.send(bytes(9))
  await flush()
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
  await flush()
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS)
  expect(a.status()).toBe('relay') // 상대가 아직 안 들어옴
  const b = openLink({ matchId: 'm1', mySeat: 1, channel: ch.make(), rtc: rtc.make })
  await flush()
  expect(a.status()).toBe('direct')
  expect(b.status()).toBe('direct')
})

test('close unsubscribes the channel and closes the peer', async () => {
  const ch = channelHub()
  const rtc = rtcHub()
  const chan = ch.make()
  const a = openLink({ matchId: 'm1', mySeat: 0, channel: chan, rtc: rtc.make })
  await flush()
  a.close()
  expect(a.status()).toBe('closed')
  expect(chan.unsubscribed).toBe(true)
  expect(rtc.pcs.every((p) => p.closed)).toBe(true)
  a.send(bytes(1)) // 닫힌 뒤에는 조용히 무시
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS)
  expect(a.status()).toBe('closed')
})
