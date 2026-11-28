import { expect, test } from 'vitest'
import { decode, encode, type StatePacket } from './codec.ts'

const st: StatePacket = {
  kind: 'state', tick: 12345,
  pos: { x: 1.25, y: -3.5, z: 1234.567 },
  quat: { x: 0.1, y: -0.2, z: 0.3, w: 0.927 },
  vel: { x: -12.3, y: 0.01, z: 49.9 },
  nitro: true,
}

test('state packet round-trips within float32 precision and is ≤ 57 bytes', () => {
  const b = encode(st)
  expect(b.byteLength).toBeLessThanOrEqual(57)
  const d = decode(b) as StatePacket
  expect(d.kind).toBe('state')
  expect(d.tick).toBe(12345)
  expect(d.nitro).toBe(true)
  for (const k of ['x', 'y', 'z'] as const) {
    expect(d.pos[k]).toBeCloseTo(st.pos[k], 3)
    expect(d.vel[k]).toBeCloseTo(st.vel[k], 4)
  }
  for (const k of ['x', 'y', 'z', 'w'] as const) expect(d.quat[k]).toBeCloseTo(st.quat[k], 6)
  expect((decode(encode({ ...st, nitro: false })) as StatePacket).nitro).toBe(false)
})

test('hello and finish round-trip; finish null means DNF', () => {
  expect(decode(encode({ kind: 'hello', version: 2 }))).toEqual({ kind: 'hello', version: 2 })
  expect(decode(encode({ kind: 'finish', ticks: 4321 }))).toEqual({ kind: 'finish', ticks: 4321 })
  expect(decode(encode({ kind: 'finish', ticks: null }))).toEqual({ kind: 'finish', ticks: null })
})

test('garbage or short buffers decode to null', () => {
  expect(decode(new ArrayBuffer(0))).toBeNull()
  expect(decode(new Uint8Array([99, 1, 2, 3, 4]).buffer)).toBeNull()
  expect(decode(encode(st).slice(0, 20))).toBeNull()
  expect(decode(encode({ kind: 'hello', version: 2 }).slice(0, 3))).toBeNull()
  // 길이가 더 길어도 받지 않는다(다른 버전의 형식)
  const long = new Uint8Array(encode({ kind: 'finish', ticks: 1 }).byteLength + 1)
  long[0] = new Uint8Array(encode({ kind: 'finish', ticks: 1 }))[0]
  expect(decode(long.buffer)).toBeNull()
  // NaN이 든 상태는 버린다
  const bad = encode({ ...st, pos: { x: NaN, y: 0, z: 0 } })
  expect(decode(bad)).toBeNull()
})
