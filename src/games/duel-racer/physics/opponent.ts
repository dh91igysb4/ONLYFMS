// 상대 차(레이싱 설계 §4, §6.5). 3번 구조: 각자 자기 차만 물리로 돌리고, 상대 차는 받은 상태를 외삽한
// 센서 운동학 몸체(유령)로 내 세계에 둔다. 겹치면 같은 질량 충돌 공식으로 내 차에만 충격을 준다(상대 세계에서는
// 상대가 같은 일을 한다). 공식은 0단계 시험판(spike/duel.ts)의 placeGhost·resolve를 옮긴 것.
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat'
import {
  CAR_HALF, CAR_MASS, GHOST_EXTRAP_MAX_MS, GHOST_MARGIN, GHOST_STALE_TICKS, HIT_PUSH_OUT, HIT_RESTITUTION,
  SPIN_HIT_SPEED, SPIN_KICK, TICK_HZ,
} from '../constants.ts'
import type { StatePacket } from '../net/codec.ts'
import type { Pose } from '../race.ts'
import { carState, type Car } from './car.ts'
import type { PhysWorld } from './world.ts'

const TICK_MS = 1000 / TICK_HZ
const PARKED = { x: 0, y: -500, z: 0 }

export type Opponent = {
  pw: PhysWorld
  body: RigidBody
  collider: Collider
  latest: { p: StatePacket; atTick: number } | null
  /** 이번 틱 유령 자세·속도(충돌용). 소식이 끊기면 pos는 null */
  pos: Pose['pos'] | null
  quat: Pose['quat']
  vel: StatePacket['vel']
}

export type Contact = 'none' | 'touch' | 'hit' | 'spin'

export function createOpponent(pw: PhysWorld): Opponent {
  const R = pw.R
  const body = pw.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(PARKED.x, PARKED.y, PARKED.z))
  const collider = pw.world.createCollider(
    R.ColliderDesc.cuboid(CAR_HALF.x + GHOST_MARGIN, CAR_HALF.y + GHOST_MARGIN, CAR_HALF.z + GHOST_MARGIN).setSensor(true),
    body,
  )
  return { pw, body, collider, latest: null, pos: null, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 } }
}

/** 받은 상태. atTick: 받은 때 내 틱. 이미 받은 것보다 옛 틱이면 버린다(순서 없는 전송) */
export function receiveState(o: Opponent, p: StatePacket, atTick: number): void {
  if (o.latest && p.tick <= o.latest.p.tick) return
  o.latest = { p, atTick }
}

/**
 * 유령을 이번 틱 위치로 옮긴다. 받은 뒤 흐른 만큼(지금 - 받은 틱 + 1틱) 속도로 외삽하고 GHOST_EXTRAP_MAX_MS에서 멈춘다.
 * 보낸 틱은 쓰지 않는다: 두 기기의 서버 시각 추정이 수십 ms 어긋나면 보낸 쪽이 앞설 때 유령이 패킷 사이에 멈췄다
 * 튀었다(사용자 시험). 대신 편도 지연만큼(왕복 30ms면 약 15ms) 뒤처져 보인다. 소식이 GHOST_STALE_TICKS보다 오래 없으면 fresh=false: 그리기는 반투명,
 * 몸체는 치워서 충돌하지 않는다(보이지 않는 차에 부딪히지 않게).
 */
export function placeOpponent(o: Opponent, nowTick: number): { pose: Pose; fresh: boolean } | null {
  const l = o.latest
  if (!l) return null
  const m = l.p
  const ageMs = Math.min(GHOST_EXTRAP_MAX_MS, Math.max(1, nowTick - l.atTick + 1) * TICK_MS)
  const age = ageMs / 1000
  const pos = { x: m.pos.x + m.vel.x * age, y: m.pos.y + m.vel.y * age, z: m.pos.z + m.vel.z * age }
  const fresh = nowTick - l.atTick <= GHOST_STALE_TICKS
  if (fresh) {
    o.pos = pos
    o.quat = m.quat
    o.vel = m.vel
    o.body.setNextKinematicTranslation(pos)
    o.body.setNextKinematicRotation(m.quat)
  } else {
    o.pos = null
    o.body.setNextKinematicTranslation(PARKED)
  }
  return { pose: { pos, quat: m.quat }, fresh }
}

/**
 * 같은 질량 두 차의 충돌을 내 차에만 적용한다(시험판 resolve). world.step 뒤에 부른다.
 * 겹침은 지금 자세끼리 모양 대 모양으로 잰다: world.intersectionPair는 운동학 몸체가 옮겨진 다음 단계에야
 * 겹침을 알아서(한 틱 늦음), 소식이 끊겼다 다시 와 유령이 크게 뛸 때 첫 틱을 놓친다.
 */
export function resolveContact(o: Opponent, car: Car, _tick: number): Contact {
  if (!o.pos) return 'none'
  const carCol = car.body.collider(0)
  if (!carCol.intersectsShape(o.collider.shape, o.pos, o.quat)) return 'none'
  const s = carState(car)
  let nx = s.pos.x - o.pos.x
  let nz = s.pos.z - o.pos.z
  const nl = Math.hypot(nx, nz) || 1
  nx /= nl
  nz /= nl
  const rel = (s.vel.x - o.vel.x) * nx + (s.vel.z - o.vel.z) * nz
  const body = car.body
  let out: Contact = 'touch'
  if (rel < 0) {
    const j = (-(1 + HIT_RESTITUTION) / 2) * CAR_MASS * rel
    body.applyImpulse({ x: nx * j, y: 0, z: nz * j }, true)
    out = 'hit'
    // 옆을 세게 맞으면 돈다
    const q = s.quat
    const fx = 2 * (q.x * q.z + q.w * q.y)
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y)
    const fl = Math.hypot(fx, fz) || 1
    const sideHit = Math.abs((fx * nx + fz * nz) / fl) < 0.5
    if (sideHit && -rel > SPIN_HIT_SPEED) {
      const cross = (fz * nx - fx * nz) / fl
      const w0 = body.angvel()
      body.setAngvel({ x: w0.x, y: w0.y + Math.sign(cross || 1) * SPIN_KICK, z: w0.z }, true)
      out = 'spin'
    }
  }
  const t = body.translation()
  body.setTranslation({ x: t.x + nx * HIT_PUSH_OUT, y: t.y, z: t.z + nz * HIT_PUSH_OUT }, true)
  return out
}
