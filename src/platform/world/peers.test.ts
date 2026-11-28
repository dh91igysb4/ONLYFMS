import { describe, expect, test } from 'vitest'
import {
  IDLE_SEND_MS, MAX_HANDLE, MAX_OUTFIT, MAX_SHOW, MAX_TAG, PEER_TIMEOUT_MS, markSent, moveIntervalMs, newSendClock, parsePeerState,
  peersAt, prunePeers, receivePeer, shouldSend, type PeerBook, type PeerState,
} from './peers.ts'

const st = (over: Partial<PeerState> = {}): PeerState => ({
  id: 'a', handle: 'kane', x: 100, y: 200, facing: 'down', moving: false, act: 'walk', outfit: '{}', t: 1000, ...over,
})

describe('moveIntervalMs', () => {
  test('인원별 간격', () => {
    expect([2, 3, 4, 5, 6].map(moveIntervalMs)).toEqual([250, 250, 250, 313, 450])
  })
})

describe('parsePeerState', () => {
  test('정상 메시지는 그대로', () => {
    expect(parsePeerState(st())).toEqual(st())
  })
  test('깨진 메시지는 null', () => {
    const bad: unknown[] = [
      st({ facing: 'north' as never }), st({ x: NaN }), st({ y: Infinity }), st({ handle: '' }),
      st({ handle: 'x'.repeat(MAX_HANDLE + 1) }), st({ outfit: 'x'.repeat(MAX_OUTFIT + 1) }), st({ act: 'run' as never }),
      st({ moving: 'yes' as never }), st({ t: NaN }), { ...st(), id: undefined }, null, 'pos', 42,
    ]
    for (const b of bad) expect(parsePeerState(b), JSON.stringify(b)).toBeNull()
  })
  test('꼬리표(tag): 짧은 문자열만 받고, 잘못되면 그 칸만 버린다', () => {
    expect(parsePeerState(st({ tag: '용을 낚은 자' }))).toEqual(st({ tag: '용을 낚은 자' }))
    expect(parsePeerState(st({ tag: 'x'.repeat(MAX_TAG + 1) }))).toEqual(st())
    expect(parsePeerState({ ...st(), tag: 3 })).toEqual(st())
    expect(parsePeerState(st({ tag: '' }))).toEqual(st())
  })
})

describe('shouldSend', () => {
  test('혼자면 보내지 않는다', () => {
    expect(shouldSend(newSendClock(), 0, true, 's', 1)).toBe(false)
  })
  test('들어간 직후 한 번', () => {
    expect(shouldSend(newSendClock(), 0, false, 's', 2)).toBe(true)
  })
  test('멈춤: 2.5초마다', () => {
    const c = markSent(newSendClock(), 1000, 's', 2)
    expect(IDLE_SEND_MS).toBe(2500)
    expect(shouldSend(c, 1000 + 2499, false, 's', 2)).toBe(false)
    expect(shouldSend(c, 1000 + 2500, false, 's', 2)).toBe(true)
  })
  test('움직임: 인원에 따른 간격', () => {
    const c6 = markSent(newSendClock(), 0, 's', 6)
    expect(shouldSend(c6, 449, true, 's', 6)).toBe(false)
    expect(shouldSend(c6, 450, true, 's', 6)).toBe(true)
    const c2 = markSent(newSendClock(), 0, 's', 2)
    expect(shouldSend(c2, 250, true, 's', 2)).toBe(true)
  })
  test('상태가 바뀌면 바로, 단 움직임 간격보다 자주는 아님', () => {
    const c = markSent(newSendClock(), 0, 's', 2)
    expect(shouldSend(c, 100, false, 's2', 2)).toBe(false)
    expect(shouldSend(c, 250, false, 's2', 2)).toBe(true)
  })
  test('인원이 늘면 바로 한 번', () => {
    const c = markSent(newSendClock(), 0, 's', 2)
    expect(shouldSend(c, 10, false, 's', 3)).toBe(true)
  })
})

describe('peer book', () => {
  test('내 메시지와 오래된 메시지는 무시', () => {
    const b: PeerBook = new Map()
    receivePeer(b, st({ id: 'me' }), 0, 'me')
    expect(b.size).toBe(0)
    receivePeer(b, st({ t: 1000, x: 10 }), 0, 'me')
    receivePeer(b, st({ t: 1000, x: 99 }), 10, 'me')
    receivePeer(b, st({ t: 900, x: 99 }), 20, 'me')
    expect(peersAt(b, 20)[0].x).toBe(10)
  })

  test('두 메시지 사이를 이어 그린다', () => {
    const b: PeerBook = new Map()
    receivePeer(b, st({ t: 1000, x: 100 }), 0, 'me')
    expect(peersAt(b, 0)[0].x).toBe(100)
    receivePeer(b, st({ t: 1400, x: 140 }), 1000, 'me')
    expect(peersAt(b, 1200)[0].x).toBe(120)
    expect(peersAt(b, 1400)[0].x).toBe(140)
    expect(peersAt(b, 5000)[0].x).toBe(140)
  })

  test('10초 소식 없거나 프레즌스에서 빠지면 지운다', () => {
    const b: PeerBook = new Map()
    receivePeer(b, st({ id: 'a' }), 0, 'me')
    receivePeer(b, st({ id: 'b' }), 0, 'me')
    prunePeers(b, PEER_TIMEOUT_MS - 1, new Set(['a', 'b']))
    expect(b.size).toBe(2)
    prunePeers(b, PEER_TIMEOUT_MS - 1, new Set(['a']))
    expect([...b.keys()]).toEqual(['a'])
    prunePeers(b, PEER_TIMEOUT_MS, new Set(['a']))
    expect(b.size).toBe(0)
  })

  test('y 오름차순', () => {
    const b: PeerBook = new Map()
    receivePeer(b, st({ id: 'a', y: 300 }), 0, 'me')
    receivePeer(b, st({ id: 'b', y: 100 }), 0, 'me')
    expect(peersAt(b, 0).map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('show (게임이 해석하는 짧은 문자열, 설계 2026-11-25-fishing-brag-discard)', () => {
  test('없으면 없는 그대로, 128자 이하 문자열은 유지', () => {
    expect(parsePeerState(st())).not.toHaveProperty('show')
    expect(parsePeerState({ ...st(), show: 'e:like' })?.show).toBe('e:like')
    expect(parsePeerState({ ...st(), show: 'x'.repeat(MAX_SHOW) })?.show).toHaveLength(MAX_SHOW)
  })
  test('잘못된 show는 그 칸만 버리고 위치는 받는다', () => {
    for (const bad of [5, null, 'x'.repeat(MAX_SHOW + 1), { a: 1 }]) {
      const p = parsePeerState({ ...st(), show: bad })
      expect(p, JSON.stringify(bad)).not.toBeNull()
      expect(p).not.toHaveProperty('show')
    }
  })
  test('peersAt가 show를 그대로 내보낸다', () => {
    const book: PeerBook = new Map()
    receivePeer(book, { ...st(), show: 'e:wow' }, 1000, 'me')
    expect(peersAt(book, 1000)[0].show).toBe('e:wow')
  })
})
