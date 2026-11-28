// 0단계 시험판(버리는 코드, 머지 금지): 3번 구조(각자 자기 차 권위 + 충돌 각자 처리)의 몸싸움 손맛을 지연별로 본다.
// 내 쪽과 봇 쪽이 각자 물리 세계를 돌리고, 서로의 상태를 20Hz로 '지연'을 거쳐 받는다.
// 상대 차는 내 세계에 센서 몸체(유령)로 들어가고, 겹치면 같은 질량 충돌 공식으로 내 차에만 충격을 준다.
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat'
import { CAR_HALF, CAR_MASS, TICK_HZ } from '../constants.ts'
import { progressAt } from '../course/index.ts'
import { tangentAt } from '../course/road.ts'
import { carState, resetCar, type CarState } from '../physics/car.ts'
import { NO_CONTROLS, type Controls } from '../physics/controls.ts'
import type { Rapier } from '../physics/rapier.ts'
import { advance, createRace, snapshot, type Race } from '../race.ts'

const TICK_MS = 1000 / TICK_HZ
const SEND_EVERY = 3 // 20Hz
const EXTRAP_MAX_MS = 250
const RESTITUTION = 0.35
const PUSH_OUT = 0.04
const SPIN_HIT_SPEED = 5
const SPIN_KICK = 3.2
/** 유령 몸체를 이만큼 키워 맞는 쪽도 접촉을 느끼게 한다(때린 쪽은 자기 세계에서 먼저 튕겨 나가므로) */
const GHOST_MARGIN = 0.35
/** 이만큼 떨어져 있다 다시 닿아야 새 충돌로 센다 (틱) */
const HIT_GAP_TICKS = 18

type Msg = { at: number; sentTick: number; pos: CarState['pos']; quat: CarState['quat']; vel: CarState['vel'] }

type Side = {
  race: Race
  ghost: RigidBody
  ghostCol: Collider
  carCol: Collider
  inbox: Msg[]
  latest: Msg | null
  ghostPos: CarState['pos'] | null
  /** 직전 틱 유령 위치(그리기 보간용) */
  ghostPrev: CarState['pos'] | null
  ghostVel: CarState['vel']
  hitTicks: number[]
  touching: boolean
  lastTouch: number
}

export type SpikeDuel = {
  me: Side
  bot: Side
  tick: number
  acc: number
  rttMs: number
  hits: { me: number; bot: number; mismatched: number }
}

function makeSide(R: Rapier, lateral: number): Side {
  const race = createRace(R, 'neon-1')
  const c = race.course
  const p = c.centerline[2]
  const t = tangentAt(c, 2)
  // 옆 방향(up × t)으로 비켜 세운다
  resetCar(race.car, { pos: { x: p.x + t.z * lateral, y: p.y + 1.2, z: p.z - t.x * lateral }, yaw: Math.atan2(t.x, t.z) })
  const w = race.pw.world
  const ghost = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500, 0))
  const ghostCol = w.createCollider(R.ColliderDesc.cuboid(CAR_HALF.x + GHOST_MARGIN, CAR_HALF.y + GHOST_MARGIN, CAR_HALF.z + GHOST_MARGIN).setSensor(true), ghost)
  return {
    race, ghost, ghostCol, carCol: race.car.body.collider(0), inbox: [], latest: null, ghostPos: null, ghostPrev: null,
    ghostVel: { x: 0, y: 0, z: 0 }, hitTicks: [], touching: false, lastTouch: -1e9,
  }
}

export function createSpike(R: Rapier): SpikeDuel {
  return { me: makeSide(R, 3), bot: makeSide(R, -3), tick: 0, acc: 0, rttMs: 0, hits: { me: 0, bot: 0, mismatched: 0 } }
}

function send(from: Side, to: Side, d: SpikeDuel) {
  const s = carState(from.race.car)
  to.inbox.push({ at: d.tick * TICK_MS + d.rttMs / 2, sentTick: d.tick, pos: s.pos, quat: s.quat, vel: s.vel })
}

/** 받은 상태를 지연만큼 외삽해 유령을 다음 위치로 옮긴다(충돌에는 외삽 위치를 쓴다, 설계 §6.5) */
function placeGhost(side: Side, d: SpikeDuel) {
  const now = d.tick * TICK_MS
  while (side.inbox.length && side.inbox[0].at <= now) side.latest = side.inbox.shift()!
  const m = side.latest
  if (!m) return
  // 보낸 상태는 그 틱 물리 전이므로 한 틱 더 앞으로
  const age = Math.min(EXTRAP_MAX_MS, now - m.sentTick * TICK_MS + TICK_MS) / 1000
  const pos = { x: m.pos.x + m.vel.x * age, y: m.pos.y + m.vel.y * age, z: m.pos.z + m.vel.z * age }
  side.ghostPrev = side.ghostPos ?? pos
  side.ghostPos = pos
  side.ghostVel = m.vel
  side.ghost.setNextKinematicTranslation(pos)
  side.ghost.setNextKinematicRotation(m.quat)
}

/** 같은 질량 두 차의 충돌을 내 차에만 적용한다 */
function resolve(side: Side, d: SpikeDuel): boolean {
  const w = side.race.pw.world
  if (!side.ghostPos || !w.intersectionPair(side.carCol, side.ghostCol)) {
    side.touching = false
    return false
  }
  const s = carState(side.race.car)
  let nx = s.pos.x - side.ghostPos.x
  let nz = s.pos.z - side.ghostPos.z
  const nl = Math.hypot(nx, nz) || 1
  nx /= nl
  nz /= nl
  const rel = (s.vel.x - side.ghostVel.x) * nx + (s.vel.z - side.ghostVel.z) * nz
  const body = side.race.car.body
  let hit = false
  if (rel < 0) {
    const j = (-(1 + RESTITUTION) / 2) * CAR_MASS * rel
    body.applyImpulse({ x: nx * j, y: 0, z: nz * j }, true)
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
    }
    if (d.tick - side.lastTouch > HIT_GAP_TICKS) hit = true
  }
  side.lastTouch = d.tick
  const t = body.translation()
  body.setTranslation({ x: t.x + nx * PUSH_OUT, y: t.y, z: t.z + nz * PUSH_OUT }, true)
  side.touching = true
  if (hit) side.hitTicks.push(d.tick)
  return hit
}

/** 봇: 중심선을 따라가다 내 유령이 가까우면 들이받으러 간다 */
export function botControls(d: SpikeDuel): Controls {
  const side = d.bot
  const s = snapshot(side.race)
  const c = side.race.course
  const p = progressAt(c, s.car.pos, side.race.progressIndex)
  let target = c.centerline[Math.min(c.centerline.length - 1, p.index + 8)]
  const g = side.ghostPos
  if (g) {
    const dx = g.x - s.car.pos.x
    const dz = g.z - s.car.pos.z
    if (Math.hypot(dx, dz) < 25) target = { x: g.x, y: g.y, z: g.z }
  }
  const q = s.car.quat
  const fx = 2 * (q.x * q.z + q.w * q.y)
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y)
  const cross = fz * (target.x - s.car.pos.x) - fx * (target.z - s.car.pos.z)
  return { ...NO_CONTROLS, throttle: 1, steer: Math.max(-1, Math.min(1, -cross / 4)), nitro: s.nitro.gauge > 0.6 }
}

/** 두 쪽을 ms만큼 진행한다. 내 조작은 controls */
export function stepSpike(d: SpikeDuel, ms: number, controls: Controls): void {
  d.acc += (ms * TICK_HZ) / 1000
  while (d.acc >= 1 - 1e-6) {
    d.acc -= 1
    if (d.tick % SEND_EVERY === 0) {
      send(d.me, d.bot, d)
      send(d.bot, d.me, d)
    }
    placeGhost(d.me, d)
    placeGhost(d.bot, d)
    const bc = botControls(d)
    advance(d.me.race, TICK_MS, controls)
    advance(d.bot.race, TICK_MS, bc)
    const a = resolve(d.me, d)
    const b = resolve(d.bot, d)
    if (a) d.hits.me++
    if (b) d.hits.bot++
    d.tick++
    // 한쪽만 부딪힌 사건: 0.3초 안에 다른 쪽이 못 느끼면 어긋남으로 센다
    const W = Math.round(0.3 * TICK_HZ)
    for (const [x, y] of [[d.me, d.bot], [d.bot, d.me]] as const) {
      while (x.hitTicks.length && x.hitTicks[0] < d.tick - W) {
        const t = x.hitTicks.shift()!
        const i = y.hitTicks.findIndex((u) => Math.abs(u - t) <= W)
        if (i >= 0) y.hitTicks.splice(i, 1)
        else d.hits.mismatched++
      }
    }
  }
}
