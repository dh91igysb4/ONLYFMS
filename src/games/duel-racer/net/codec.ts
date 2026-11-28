// 대국 중 두 브라우저가 주고받는 패킷(레이싱 설계 §6.5). 작은 고정 길이 바이트로 보낸다.
// state: 출발 뒤 틱(race elapsed 기준) + 위치·자세·속도 + 니트로. hello: 로직 버전. finish: 완주 틱(미완주 null).
export type Vec3 = { x: number; y: number; z: number }
export type Quat = { x: number; y: number; z: number; w: number }
export type StatePacket = { kind: 'state'; tick: number; pos: Vec3; quat: Quat; vel: Vec3; nitro: boolean }
export type HelloPacket = { kind: 'hello'; version: number }
export type FinishPacket = { kind: 'finish'; ticks: number | null }
export type Packet = StatePacket | HelloPacket | FinishPacket

const K_STATE = 1
const K_HELLO = 2
const K_FINISH = 3
// 종류 1 + 틱 4 + 실수 10개 40 + 플래그 1
const STATE_LEN = 46
const HELLO_LEN = 5
const FINISH_LEN = 5

export function encode(p: Packet): ArrayBuffer {
  if (p.kind === 'state') {
    const b = new ArrayBuffer(STATE_LEN)
    const v = new DataView(b)
    v.setUint8(0, K_STATE)
    v.setUint32(1, Math.max(0, Math.floor(p.tick)) >>> 0)
    const f = [p.pos.x, p.pos.y, p.pos.z, p.quat.x, p.quat.y, p.quat.z, p.quat.w, p.vel.x, p.vel.y, p.vel.z]
    f.forEach((x, i) => v.setFloat32(5 + i * 4, x))
    v.setUint8(45, p.nitro ? 1 : 0)
    return b
  }
  const b = new ArrayBuffer(5)
  const v = new DataView(b)
  if (p.kind === 'hello') {
    v.setUint8(0, K_HELLO)
    v.setUint32(1, p.version >>> 0)
  } else {
    v.setUint8(0, K_FINISH)
    v.setInt32(1, p.ticks === null ? -1 : p.ticks)
  }
  return b
}

/** 모르는 종류·길이·깨진 값이면 null */
export function decode(b: ArrayBuffer): Packet | null {
  if (b.byteLength < 1) return null
  const v = new DataView(b)
  const k = v.getUint8(0)
  if (k === K_STATE && b.byteLength === STATE_LEN) {
    const f: number[] = []
    for (let i = 0; i < 10; i++) f.push(v.getFloat32(5 + i * 4))
    if (!f.every(Number.isFinite)) return null
    return {
      kind: 'state',
      tick: v.getUint32(1),
      pos: { x: f[0], y: f[1], z: f[2] },
      quat: { x: f[3], y: f[4], z: f[5], w: f[6] },
      vel: { x: f[7], y: f[8], z: f[9] },
      nitro: v.getUint8(45) === 1,
    }
  }
  if (k === K_HELLO && b.byteLength === HELLO_LEN) return { kind: 'hello', version: v.getUint32(1) }
  if (k === K_FINISH && b.byteLength === FINISH_LEN) {
    const t = v.getInt32(1)
    return { kind: 'finish', ticks: t < 0 ? null : t }
  }
  return null
}
