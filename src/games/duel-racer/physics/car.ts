// 아케이드 차량 (레이싱 설계 §5.1). Rapier 레이캐스트 차량 컨트롤러가 서스펜션·접지·바퀴 마찰을 맡고,
// 그 위에 손맛 보정을 직접 건다: 속도 곡선 구동력, 최고속 제한, 조향 보조 토크, 드리프트, 공중 회전, 착지 보정.
// 좌표 약속(course/types.ts): 차 로컬 +z가 앞, +y가 위. steer +1(오른쪽) = 월드 yaw 각속도 음수.
import type { DynamicRayCastVehicleController, RigidBody } from '@dimforge/rapier3d-compat'
import { ACCEL_TIME, CAR_HALF, CAR_MASS, DRIFT_REAR_GRIP, LANDING_ASSIST_MAX_DEG, NITRO_SPEED, TOP_SPEED } from '../constants.ts'
import type { Vec3 } from '../course/types.ts'
import type { Controls } from './controls.ts'
import { quatYPR, type PhysWorld } from './world.ts'

type Quat = { x: number; y: number; z: number; w: number }

export type CarState = {
  pos: Vec3
  quat: Quat
  vel: Vec3
  /** 월드 기준 각속도 */
  angVel: Vec3
  /** 차 로컬 기준 각속도 (x = 앞구르기 방향 +, y = 왼쪽 회전 +, z = 왼쪽으로 기울기 +) */
  localAngVel: Vec3
  /** 앞 방향 속도 성분 (m/s) */
  speed: number
  /** 바퀴 4개 중 2개 이상 접지 */
  grounded: boolean
  /** 수평 속도와 차 앞 방향 사이 각 (도, 느리면 0) */
  slipDeg: number
  up: Vec3
}

export type Car = {
  pw: PhysWorld
  body: RigidBody
  vc: DynamicRayCastVehicleController
  /** 직전 틱 접지 여부 */
  wasGrounded: boolean
  /** 착지 보정이 남은 시간 (s) */
  assistLeft: number
  /** 뒷바퀴 횡그립 배율 (핸드브레이크 뒤 서서히 회복) */
  rearGrip: number
  /** 정렬 모드 중인지(옆 그립을 뺀다) */
  spinning: boolean
  /** 정렬 모드: 맞출 수평 방향, 남은 시간, 속도 방향을 지킬지(착지) */
  align: { x: number; z: number; left: number; keepSpeed: boolean } | null
  /** 공중에 있던 마지막 틱의 수평 진행 방향 */
  lastAirDir: { x: number; z: number } | null
}

// ---- 조율값 (손맛) ----
const WHEEL_X = 0.9
const WHEEL_Z = 1.45
const WHEEL_Y = -0.3
const WHEEL_R = 0.35
const SUSP_REST = 0.4
const SIDE_STIFF = 1.6
const FRICTION_SLIP = 3.0
/** 정지 가속도 (m/s²): v(t) = Vmax(1 - e^{-kt}), 0.9·Vmax에 ACCEL_TIME → k = ln10 / T */
const K_ACCEL = Math.LN10 / ACCEL_TIME
const BRAKE_DECEL = 28
const REVERSE_SPEED = 10
const STEER_LOW = 0.5
const STEER_HIGH = 0.12
/** 조향 보조 yaw 각가속도 목표 (rad/s): 속도에 따라 */
const YAW_RATE_MAX = 1.9
const YAW_GAIN = 12
const DRIFT_YAW_BONUS = 1.5
const REAR_GRIP_RECOVER_SEC = 0.3
/** 이 각(rad)보다 크게 옆으로 미끄러지면 '돌고 있음'으로 보고 머리를 진행 방향으로 세운다 */
const SPIN_SLIP = 0.35
const SPIN_MIN_SPEED = 5
const ALIGN_RATE = 6
const ALIGN_GAIN = 8
/** 돌고 있을 때 옆 속도 제거 강도(1/s). 작아야 속도가 옆으로 꺾이지 않는다 */
const SPIN_SIDE_CANCEL = 0.6
/** 착지 때 머리와 진행 방향이 이만큼(rad) 어긋나면 정렬 모드 */
const LAND_ALIGN_MIN = 0.15
/** 이만큼(rad) 안으로 맞으면 정렬 끝 */
const ALIGN_DONE = 0.1
const ALIGN_MAX_SEC = 1.2
/** 돌고 있을 때 바퀴 옆 그립 배율 */
const SPIN_TIRE_GRIP = 0.08
const ROLL_DAMP = 6
const AIR_RATE = 4.5
const AIR_GAIN = 10
/** 공중에서 입력 없는 축의 회전 감쇠(1/s)와 수평 복원 강도 */
const AIR_HOLD_DAMP = 3
const AIR_HOLD_LEVEL = 4
const ASSIST_SEC = 0.3
const ASSIST_GAIN = 40
const ASSIST_DAMP = 8
const COS_ASSIST = Math.cos((LANDING_ASSIST_MAX_DEG * Math.PI) / 180)

function rot(q: Quat, v: Vec3): Vec3 {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y
  const iy = q.w * v.y + q.z * v.x - q.x * v.z
  const iz = q.w * v.z + q.x * v.y - q.y * v.x
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  }
}
const conj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w })
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })

/** 차 앞 방향(수평 길이 fh)과 단위 방향 (dx, dz) 사이 각 (rad, 0..π) */
function slipTo(fwd: Vec3, fh: number, dx: number, dz: number): number {
  const cross = (fwd.z * dx - fwd.x * dz) / fh
  const d = (fwd.x * dx + fwd.z * dz) / fh
  return Math.atan2(Math.abs(cross), d)
}

export function createCar(pw: PhysWorld, pose: { pos: Vec3; yaw: number }, roll = 0): Car {
  const { R, world } = pw
  const m = CAR_MASS
  const dx = CAR_HALF.x * 2
  const dy = CAR_HALF.y * 2
  const dz = CAR_HALF.z * 2
  const inertia = { x: (m / 12) * (dy * dy + dz * dz), y: (m / 12) * (dx * dx + dz * dz), z: (m / 12) * (dx * dx + dy * dy) * 1.6 }
  const desc = R.RigidBodyDesc.dynamic()
    .setTranslation(pose.pos.x, pose.pos.y, pose.pos.z)
    .setRotation(quatYPR(pose.yaw, 0, roll))
    .setAdditionalMassProperties(m, { x: 0, y: -0.35, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
    .setCanSleep(false)
    .setCcdEnabled(true)
  const body = world.createRigidBody(desc)
  world.createCollider(R.ColliderDesc.cuboid(CAR_HALF.x, CAR_HALF.y, CAR_HALF.z).setDensity(0).setFriction(0.3).setRestitution(0.1), body)
  const vc = world.createVehicleController(body)
  ;(vc as unknown as { setIndexForwardAxis: number }).setIndexForwardAxis = 2
  for (const [x, z] of [[WHEEL_X, WHEEL_Z], [-WHEEL_X, WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, -WHEEL_Z]]) {
    vc.addWheel({ x, y: WHEEL_Y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSP_REST, WHEEL_R)
  }
  for (let i = 0; i < 4; i++) {
    vc.setWheelSuspensionStiffness(i, 40)
    vc.setWheelSuspensionCompression(i, 4.0)
    vc.setWheelSuspensionRelaxation(i, 3.0)
    vc.setWheelMaxSuspensionTravel(i, 0.35)
    vc.setWheelMaxSuspensionForce(i, 1e5)
    vc.setWheelFrictionSlip(i, FRICTION_SLIP)
    vc.setWheelSideFrictionStiffness(i, SIDE_STIFF)
  }
  return { pw, body, vc, wasGrounded: false, assistLeft: 0, rearGrip: 1, spinning: false, align: null, lastAirDir: null }
}

export function resetCar(car: Car, pose: { pos: Vec3; yaw: number }): void {
  car.body.setTranslation(pose.pos, true)
  car.body.setRotation(quatYPR(pose.yaw, 0, 0), true)
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  car.assistLeft = 0
  car.rearGrip = 1
  car.align = null
  car.lastAirDir = null
}

function contacts(car: Car): number {
  let n = 0
  for (let i = 0; i < 4; i++) if (car.vc.wheelIsInContact(i)) n++
  return n
}

export function carState(car: Car): CarState {
  const t = car.body.translation()
  const q = car.body.rotation()
  const v = car.body.linvel()
  const w = car.body.angvel()
  const fwd = rot(q, { x: 0, y: 0, z: 1 })
  const up = rot(q, { x: 0, y: 1, z: 0 })
  const speed = dot(v, fwd)
  const hv = Math.hypot(v.x, v.z)
  const fh = Math.hypot(fwd.x, fwd.z)
  let slipDeg = 0
  if (hv > 2 && fh > 0.1) {
    const c = (v.x * fwd.x + v.z * fwd.z) / (hv * fh)
    slipDeg = (Math.acos(Math.max(-1, Math.min(1, Math.abs(c)))) * 180) / Math.PI
  }
  return {
    pos: { x: t.x, y: t.y, z: t.z },
    quat: { x: q.x, y: q.y, z: q.z, w: q.w },
    vel: { x: v.x, y: v.y, z: v.z },
    angVel: { x: w.x, y: w.y, z: w.z },
    localAngVel: rot(conj(q), w),
    speed,
    grounded: contacts(car) >= 2,
    slipDeg,
    up,
  }
}

/** 한 틱 힘을 걸고 컨트롤러를 갱신한다. 그다음 world.step()을 부른다. boost = 니트로 분사 중 */
export function stepCar(car: Car, c: Controls, boost: boolean, dt: number): void {
  const { body, vc } = car
  const s = carState(car)
  const m = CAR_MASS
  const q = s.quat
  const fwd = rot(q, { x: 0, y: 0, z: 1 })
  const right = rot(q, { x: -1, y: 0, z: 0 })
  const vmax = boost ? NITRO_SPEED : TOP_SPEED
  const v = s.speed

  // 정렬 모드(공중에서 돌고 착지, 벽에 맞고 돎): 바퀴 그립이 속도를 차 머리 쪽으로 꺾으면 도로 밖으로 날아간다.
  // 그래서 이 동안은 옆 그립을 빼고, 진행 방향(착지면 착지 직전 방향)을 지키며 머리를 그쪽으로 돌려 세운다.
  const hv = Math.hypot(s.vel.x, s.vel.z)
  const fh = Math.hypot(fwd.x, fwd.z) || 1
  const touchdown = s.grounded && !car.wasGrounded
  if (touchdown && hv > SPIN_MIN_SPEED && !c.handbrake) {
    const d = car.lastAirDir
    if (d && slipTo(fwd, fh, d.x, d.z) > LAND_ALIGN_MIN) car.align = { x: d.x, z: d.z, left: ALIGN_MAX_SEC, keepSpeed: true }
  }
  if (!car.align && s.grounded && !c.handbrake && hv > SPIN_MIN_SPEED && slipTo(fwd, fh, s.vel.x / hv, s.vel.z / hv) > SPIN_SLIP) {
    car.align = { x: s.vel.x / hv, z: s.vel.z / hv, left: ALIGN_MAX_SEC, keepSpeed: false }
  }
  let alignTarget: number | null = null
  if (car.align) {
    const a = car.align
    if (!a.keepSpeed && hv > 1) {
      a.x = s.vel.x / hv
      a.z = s.vel.z / hv
    }
    const err = slipTo(fwd, fh, a.x, a.z)
    a.left -= dt
    if (err < ALIGN_DONE || a.left <= 0 || c.handbrake || !s.grounded) {
      car.align = null
    } else {
      const crossY = (fwd.z * a.x - fwd.x * a.z) / fh
      alignTarget = Math.sign(crossY) * Math.min(ALIGN_RATE, err * ALIGN_GAIN)
      if (a.keepSpeed && hv > 1) {
        // 착지 직전 진행 방향을 지킨다(크기는 그대로)
        body.setLinvel({ x: a.x * hv, y: s.vel.y, z: a.z * hv }, true)
      }
    }
  }
  const spinning = car.align !== null
  car.spinning = spinning
  if (!s.grounded && hv > 1) car.lastAirDir = { x: s.vel.x / hv, z: s.vel.z / hv }
  // 조향: 앞바퀴 각(오른쪽 = 음수). 고속일수록 작게.
  const k = Math.min(1, Math.max(0, v / TOP_SPEED))
  const steerAngle = c.steer * (STEER_LOW + (STEER_HIGH - STEER_LOW) * k)
  vc.setWheelSteering(0, -steerAngle)
  vc.setWheelSteering(1, -steerAngle)
  // 드리프트: 뒷바퀴 횡그립
  if (c.handbrake && s.grounded) car.rearGrip = DRIFT_REAR_GRIP
  else car.rearGrip = Math.min(1, car.rearGrip + ((1 - DRIFT_REAR_GRIP) * dt) / REAR_GRIP_RECOVER_SEC)
  // 크게 돌고 있으면(아래 spinning) 바퀴 옆 그립도 낮춰 속도가 옆으로 꺾이지 않게 한다
  const spinGrip = car.spinning ? SPIN_TIRE_GRIP : 1
  vc.setWheelSideFrictionStiffness(0, SIDE_STIFF * spinGrip)
  vc.setWheelSideFrictionStiffness(1, SIDE_STIFF * spinGrip)
  vc.setWheelSideFrictionStiffness(2, SIDE_STIFF * car.rearGrip * spinGrip)
  vc.setWheelSideFrictionStiffness(3, SIDE_STIFF * car.rearGrip * spinGrip)
  for (let i = 0; i < 4; i++) {
    vc.setWheelEngineForce(i, 0)
    vc.setWheelBrake(i, 0)
  }

  const lw = s.localAngVel
  if (s.grounded) {
    // 구동: 지면 방향 앞쪽 힘. 최고속 위면 제동.
    let a = 0
    if (c.throttle > 0) a = v < vmax ? c.throttle * K_ACCEL * (vmax - Math.max(0, v)) : -K_ACCEL * (v - vmax)
    if (c.brake > 0) a += v > 1 ? -c.brake * BRAKE_DECEL : v > -REVERSE_SPEED ? -c.brake * 8 : 0
    if (c.throttle === 0 && c.brake === 0) a = -Math.sign(v) * Math.min(Math.abs(v) / dt, 2)
    if (v > vmax && c.throttle === 0) a = Math.min(a, -K_ACCEL * (v - vmax))
    body.applyImpulse(scale(fwd, m * a * dt), true)

    // 조향 보조: 원하는 yaw 각속도로 끌어당긴다(오른쪽 = 로컬 y 음수)
    const speedK = Math.min(1, Math.abs(v) / 8)
    const target = alignTarget !== null
      ? alignTarget
      : -c.steer * YAW_RATE_MAX * speedK * Math.sign(v || 1) * (c.handbrake ? DRIFT_YAW_BONUS : 1)
    const yawErr = target - lw.y
    const upW = rot(q, { x: 0, y: 1, z: 0 })
    if (spinning || c.steer !== 0 || Math.abs(lw.y) > 0.01) {
      const gain = spinning || c.steer !== 0 ? YAW_GAIN : YAW_GAIN * 0.5
      body.applyTorqueImpulse(scale(upW, 2336 * yawErr * gain * dt), true)
    }
    // 드리프트 뒤 회복: 그립이 돌아오면 미끄러짐(옆 속도)을 줄인다
    const side = dot(s.vel, right)
    if (!c.handbrake) {
      const cancel = car.rearGrip * (spinning ? SPIN_SIDE_CANCEL : 6) * dt
      body.applyImpulse(scale(right, -side * m * Math.min(1, cancel)), true)
    }
    // 지상 롤 안정
    const fw = rot(q, { x: 0, y: 0, z: 1 })
    body.applyTorqueImpulse(scale(fw, -lw.z * ROLL_DAMP * 900 * dt), true)
  } else {
    // 공중 회전: 입력 각속도로 끌어당긴다
    const want = { x: c.pitch * AIR_RATE, y: -c.yaw * AIR_RATE, z: -c.roll * AIR_RATE }
    const err = { x: want.x - lw.x, y: want.y - lw.y, z: want.z - lw.z }
    const active = { x: c.pitch !== 0, y: c.yaw !== 0, z: c.roll !== 0 }
    // 입력이 없는 축은 자세를 지킨다: 회전을 줄이고 수평 쪽으로 천천히 되돌린다(점프대에서 앞이 처박히지 않게)
    const upL = rot(conj(q), { x: 0, y: 1, z: 0 })
    const level = { x: upL.z, z: -upL.x }
    const tl = {
      x: active.x ? err.x * AIR_GAIN * 2080 * dt : (-lw.x * AIR_HOLD_DAMP + level.x * AIR_HOLD_LEVEL) * 2080 * dt,
      y: active.y ? err.y * AIR_GAIN * 2336 * dt : -lw.y * AIR_HOLD_DAMP * 0.5 * 2336 * dt,
      z: active.z ? err.z * AIR_GAIN * 900 * dt : (-lw.z * AIR_HOLD_DAMP + level.z * AIR_HOLD_LEVEL) * 900 * dt,
    }
    body.applyTorqueImpulse(rot(q, tl), true)
  }

  // 착지 보정: 바퀴가 대략 아래를 향한 채 닿으면 잠깐 바로 세운다
  if (s.grounded && !car.wasGrounded && s.up.y >= COS_ASSIST) car.assistLeft = ASSIST_SEC
  if (car.assistLeft > 0) {
    car.assistLeft -= dt
    const up = s.up
    // 회전축 = up × (0,1,0) = (-up.z, 0, up.x), 크기 = 기울기의 sin
    const axis = { x: -up.z, y: 0, z: up.x }
    const w = s.angVel
    body.applyTorqueImpulse(
      { x: (axis.x * ASSIST_GAIN - w.x * ASSIST_DAMP) * 2080 * dt, y: 0, z: (axis.z * ASSIST_GAIN - w.z * ASSIST_DAMP) * 2080 * dt },
      true,
    )
  }
  car.wasGrounded = s.grounded
  vc.updateVehicle(dt)
}
