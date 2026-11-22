// 감독관 상태 기계. 정수만 쓰고, 난수는 rng.ts만 쓴다. 입력 객체는 바꾸지 않는다.
import { AISLE_X, FRONT_Z, ME_X, PROCTORS, ROW_Z, START_GRACE, SUSP_WATCH, WATCH_AISLE_X } from './constants.ts'
import { nextRng, rngInt } from './rng.ts'

export type Face = 0 | 1 | 2 | 3 // 0: −z(학생 쪽), 1: +z(칠판 쪽), 2: −x, 3: +x
export type Proctor = {
  x: number
  z: number
  face: Face
  mode: 'front' | 'walk' | 'look'
  dozing: boolean
  timer: number
  tx: number
  tz: number
  relooked: boolean
}

const FRONT_WAIT = 30 // 칠판 앞에 돌아온 뒤 처음 서 있는 틱

export function initProctor(): Proctor {
  return { x: 0, z: FRONT_Z, face: 0, mode: 'front', dozing: false, timer: START_GRACE, tx: 0, tz: FRONT_Z, relooked: false }
}

// 난수 한 번: r을 한 걸음 진행한 뒤 0..n-1을 뽑는다.
function draw(r: number, n: number): { v: number; r: number } {
  const next = nextRng(r)
  return { v: rngInt(next, n), r: next }
}

function drawRange(r: number, range: readonly [number, number]): { v: number; r: number } {
  const d = draw(r, range[1] - range[0] + 1)
  return { v: range[0] + d.v, r: d.r }
}

function stepToward(from: number, to: number, speed: number): number {
  const d = Math.abs(to - from)
  const m = Math.min(speed, d)
  return from < to ? from + m : from - m
}

function walk(p: Proctor, r: number, type: 0 | 1 | 2, susp: number): { p: Proctor; rng: number } {
  const spec = PROCTORS[type]
  let { x, z } = p
  let face: Face = p.face
  if (x === p.tx) {
    const nz = stepToward(z, p.tz, spec.speed)
    if (nz !== z) face = nz < z ? 0 : 1
    z = nz
  } else if (z === FRONT_Z) {
    const nx = stepToward(x, p.tx, spec.speed)
    face = nx < x ? 2 : 3
    x = nx
  } else {
    const nz = stepToward(z, FRONT_Z, spec.speed)
    face = nz < z ? 0 : 1
    z = nz
  }
  if (x !== p.tx || z !== p.tz) return { p: { ...p, x, z, face }, rng: r }

  // 도착
  if (p.tz === FRONT_Z) return { p: { ...p, x, z, mode: 'front', face: 0, dozing: false, timer: FRONT_WAIT }, rng: r }
  const t = drawRange(r, spec.lookT)
  r = t.r
  let lookFace: Face
  if (susp >= SUSP_WATCH || ((WATCH_AISLE_X as readonly number[]).includes(x) && p.tz === ROW_Z[0])) {
    lookFace = x < ME_X ? 3 : 2
  } else {
    const f = draw(r, 2)
    r = f.r
    lookFace = (2 + f.v) as Face
  }
  return { p: { ...p, x, z, mode: 'look', face: lookFace, timer: t.v }, rng: r }
}

export function stepProctor(p: Proctor, rng: number, type: 0 | 1 | 2, susp: number): { p: Proctor; rng: number } {
  if (p.mode === 'walk') return walk(p, rng, type, susp)

  const timer = p.timer - 1
  if (timer > 0) return { p: { ...p, timer }, rng }

  const spec = PROCTORS[type]
  let r = rng

  if (susp >= SUSP_WATCH) {
    if (p.mode === 'look' && p.z === ROW_Z[0] && (WATCH_AISLE_X as readonly number[]).includes(p.x)) {
      const t = drawRange(r, spec.lookT)
      return { p: { ...p, timer: t.v }, rng: t.r }
    }
    const a = draw(r, WATCH_AISLE_X.length)
    return { p: { ...p, timer, tx: WATCH_AISLE_X[a.v], tz: ROW_Z[0], mode: 'walk', dozing: false, relooked: false }, rng: a.r }
  }

  if (p.mode === 'look') {
    if (spec.relookOf > 0 && !p.relooked) {
      const d = draw(r, spec.relookOf)
      r = d.r
      if (d.v === 0) {
        const others = ROW_Z.filter((z) => z !== p.z)
        const o = draw(r, others.length)
        return { p: { ...p, timer, tx: p.x, tz: others[o.v], mode: 'walk', relooked: true }, rng: o.r }
      }
    }
    const a = draw(r, AISLE_X.length)
    return { p: { ...p, timer, tx: AISLE_X[a.v], tz: FRONT_Z, mode: 'walk' }, rng: a.r }
  }

  // front가 끝남
  const total = spec.wWatch + spec.wDoze + spec.wPatrol
  const d = draw(r, total)
  r = d.r
  if (d.v < spec.wWatch) {
    const t = drawRange(r, spec.watchT)
    return { p: { ...p, face: 0, dozing: false, timer: t.v }, rng: t.r }
  }
  if (d.v < spec.wWatch + spec.wDoze) {
    const t = drawRange(r, spec.dozeT)
    return { p: { ...p, dozing: true, timer: t.v }, rng: t.r }
  }
  const a = draw(r, AISLE_X.length)
  const row = draw(a.r, ROW_Z.length)
  return { p: { ...p, timer, tx: AISLE_X[a.v], tz: ROW_Z[row.v], mode: 'walk', dozing: false, relooked: false }, rng: row.r }
}
