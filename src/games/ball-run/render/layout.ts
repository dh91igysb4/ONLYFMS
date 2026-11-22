// 장면 배치 계산(설계 §6.2). three를 쓰지 않는 순수 함수. 길이는 mm.
import { BLOCK_H, GATE_H, COL_MAX, COL_MIN, G, R, ROW, TICK_HZ, X_LIMIT } from '../constants.ts'
import { decorRandom } from '../course.ts'
import type { Course, SegmentInfo } from '../course.ts'
import { moverX } from '../mover.ts'
import type { Mover } from '../mover.ts'
import { floorAt } from '../sim.ts'

// cx·cy·cz는 상자 중심. 바닥 상자의 slope = h1 - h0이고, cy는 칸 가운데 바닥 높이에서 두께 절반 아래.
// bank는 기운 판(바닥 상자만). lintel은 같은 행 문 기둥(G) 둘 사이 위를 잇는 화면용 가로대(충돌 없음).
// pad는 점프대 칸 위에 살짝 얹은 판(행에서 이어진 점프대 칸마다 하나), track은 왕복 블록이 오가는 자리의 바닥 선(v4, 충돌 없음).
export type Box = {
  kind: 'floor' | 'block' | 'lintel' | 'pad' | 'track'
  cx: number
  cy: number
  cz: number
  w: number
  h: number
  d: number
  slope: number
  bank?: -1 | 1
}
// 건물 바닥 높이는 장면이 조각 base 기준으로 정한다(h는 그 기준 위 높이).
export type Building = { cx: number; cz: number; w: number; d: number; h: number }

export const FLOOR_T = 200

// 칸마다 상자 하나(인접 칸 병합 없음). 구멍은 상자가 없다. 블록 높이는 칸의 blockH(기둥·문), 없으면 BLOCK_H.
// 문 기둥(blockH === GATE_H로 표시된 칸, 1 m 큐브)은 한 행에서 왼쪽부터 둘씩 짝지어, 짝 사이 칸 위에 가로대를 둔다.
// 가로대는 기둥 꼭대기부터 LINTEL_H 위까지 솟은 남색 상자다(녹화 27.0 s: 마젠타 큐브 둘 사이 문 위의 더 높은 남색 상자).
export const LINTEL_H = 1000

// 점프대 판 두께(바닥 위, mm). 공(바닥 + R)이 거의 묻히지 않게 얇게 둔다. 칸 가장자리에서 PAD_INSET만큼 들여 바닥 격자선이 비친다.
export const PAD_T = 40
const PAD_INSET = 80
// 점프대 판은 화면에서 앞쪽 끝이 PAD_RISE만큼 솟은 쐐기(발판)로 그린다. 낮은 카메라에서 얇은 판은 한 줄로 보여 멀리서 안 읽히고,
// 카메라 쪽으로 기운 윗면은 잘 보인다. 시뮬 바닥은 평평하다: 공은 점프대 칸에 들어서는 틱에 뜨고 다음 틱 JUMP_VY − G만큼 오르는데,
// 최고 속도에서 한 틱 동안 지나는 쐐기 높이(PAD_RISE × V_MAX / ROW)가 그보다 낮아 공이 쐐기에 묻혀 보이지 않는다.
export const PAD_RISE = 180
// 왕복 블록 바닥 선: 폭(앞뒤) TRACK_D, 두께 TRACK_T. 오가는 칸 전체 너비.
export const TRACK_D = 300
const TRACK_T = 20

export function segmentBoxes(course: Course, info: SegmentInfo): Box[] {
  const out: Box[] = []
  for (let row = info.startRow; row < info.startRow + info.length; row++) {
    const cz = row * ROW + ROW / 2
    const m = course.moverAt(row)
    if (m !== null) {
      out.push({
        kind: 'track', cx: (m.x0 + m.x1) / 2, cy: m.h + TRACK_T / 2, cz, w: Math.abs(m.x1 - m.x0) + 1000, h: TRACK_T, d: TRACK_D,
        slope: 0,
      })
    }
    // 점프대: 같은 높이로 이어진 점프대 칸을 한 판으로.
    for (let col = COL_MIN; col <= COL_MAX; col++) {
      const c = course.cell(col, row)
      if (c.pad !== true || c.floor === null || course.cell(col - 1, row).pad === true) continue
      let hi = col
      while (hi + 1 <= COL_MAX && course.cell(hi + 1, row).pad === true) hi++
      out.push({
        kind: 'pad', cx: ((col + hi) * 1000) / 2, cy: c.floor.h0 + PAD_T / 2, cz, w: (hi - col + 1) * 1000 - PAD_INSET, h: PAD_T,
        d: ROW - PAD_INSET, slope: 0,
      })
    }
    const gates: { col: number; base: number; top: number }[] = []
    for (let col = COL_MIN; col <= COL_MAX; col++) {
      const c = course.cell(col, row)
      if (c.floor === null) continue
      const { h0, h1 } = c.floor
      const cx = col * 1000
      const floor: Box = { kind: 'floor', cx, cy: (h0 + h1) / 2 - FLOOR_T / 2, cz, w: 1000, h: FLOOR_T, d: ROW, slope: h1 - h0 }
      if (c.bank !== undefined) floor.bank = c.bank
      out.push(floor)
      if (c.block) {
        const h = c.blockH ?? BLOCK_H
        const base = Math.max(h0, h1)
        out.push({ kind: 'block', cx, cy: base + h / 2, cz, w: 1000, h, d: ROW, slope: 0 })
        if (c.blockH === GATE_H) gates.push({ col, base, top: base + h })
      }
    }
    for (let i = 0; i + 1 < gates.length; i += 2) {
      const a = gates[i]
      const b = gates[i + 1]
      if (b.col - a.col < 2) continue
      const bottom = Math.max(a.top, b.top)
      const top = bottom + LINTEL_H
      out.push({
        kind: 'lintel', cx: ((a.col + b.col) * 1000) / 2, cy: (bottom + top) / 2, cz,
        w: (b.col - a.col - 1) * 1000, h: top - bottom, d: ROW, slope: 0,
      })
    }
  }
  return out
}

// 조각 안 왕복 블록 큐브(1 m). x는 프레임마다 moverSceneX로 정한다.
export type MoverBox = { row: number; mover: Mover; cy: number; cz: number }
export function moverBoxes(course: Course, info: SegmentInfo): MoverBox[] {
  const out: MoverBox[] = []
  for (let row = info.startRow; row < info.startRow + info.length; row++) {
    const mover = course.moverAt(row)
    if (mover !== null) out.push({ row, mover, cy: mover.h + BLOCK_H / 2, cz: row * ROW + ROW / 2 })
  }
  return out
}

// 화면의 큐브 x(mm): 시뮬과 같은 moverX를 직전 틱·지금 틱에서 구해 공과 같은 alpha로 보간한다.
export function moverSceneX(m: Mover, prevTick: number, curTick: number, alpha: number): number {
  const a = moverX(m, prevTick)
  if (curTick === prevTick) return a
  return a + (moverX(m, curTick) - a) * alpha
}

// 카메라(mm). 카메라는 공 뒤 CAM_BACK(내리막에서는 CAM_BACK_FAR 쪽으로), x는 공 x. 눈 목표는 공 위 CAM_UP이고, 급경사·단차에서 카메라와 공 사이(공의 열)
// 바닥이 더 높으면 그 바닥 기준으로 올린다(판 속에 묻히지 않게). 앞 바닥은 보지 않는다(가장자리를 넘을 때 계단이 생겨서).
// 시선 각은 눈→공 방향에서 고정 각만큼 위라 공이 늘 화면 위에서 BALL_FRAC에 온다. 눈이 뒤처져 높이 떠 있으면 더 숙인다.
export const CAM_UP = 850
export const CAM_BACK = 4200
export const VFOV = 42 // 세로 시야각(°). 9:14 무대에서 공 지름이 화면 폭의 약 1/3.
export const BALL_FRAC = 0.62
export const EYE_RATE_DOWN = 3.5 // 눈이 내려갈 때 지수 보간(1/s). 단차·급경사에서 높이 떠 내려다본다.
export const EYE_RATE_UP = 14 // 눈이 올라갈 때(오르막·착지 뒤 아래로 처졌을 때)는 빨리 따라간다.
export const EYE_LAG_MAX = 3000 // 눈이 목표보다 이만큼 넘게 높이 남지 않는다.
const EYE_PROBE = 500
const EYE_CLEAR = 300 // 카메라~공 사이 바닥 위 최소 여유

// 내리막 카메라(녹화 f_045·f_047·f_064·f_069·f_092): 내리막과 터널 직후에는 카메라가 더 뒤·위로 물러나 공이 화면 폭의 약 1/5로
// 작아지고 좁은 능선과 그 아래 낙차가 보인다. 0(평지 리그)~1(먼 리그) "내리막 정도"로 뒤 거리·눈 높이·최소 숙임 각을 섞는다.
export const CAM_BACK_FAR = 7000
export const CAM_UP_FAR = 3000
export const MIN_DOWN_FAR = (20 * Math.PI) / 180 // 먼 리그의 최소 숙임 각(rad, 세계 기준)
const DESCENT_BEHIND = 3000 // 공 뒤 이 거리까지의 가장 높은 바닥과
const DESCENT_AHEAD = 6000 // 공 앞 이 거리까지의 가장 낮은 바닥의 차이로 내리막 정도를 잰다.
const DESCENT_FULL = 3000 // 이만큼 내려가면 1(급경사 '!' 6 m)
const DESCENT_RATE_UP = 3 // 1/s, 내리막에 들어서면 약 0.5초에 대부분 물러난다
const DESCENT_RATE_DOWN = 0.8 // 1/s, 내리막 뒤 능선에서는 천천히 돌아온다
export const BOOST_PULL = 0.6 // 가속 직후 물러나는 정도(내리막보다 덜)
export const BOOST_PULL_S = 2.5 // 가속 뒤 이 시간 동안 선형으로 줄어든다

// 공 열의 바닥으로 잰 내리막 정도(0..1). 구멍 위면 0. 프레임마다 smoothDescent로 보간해 쓴다(앞 바닥을 보므로 계단이 생긴다).
export function descentTarget(course: Course, ball: { x: number; z: number }): number {
  let hi = -Infinity
  let lo = Infinity
  for (let dz = -DESCENT_BEHIND; dz <= DESCENT_AHEAD; dz += EYE_PROBE) {
    const f = floorAt(course, ball.x, ball.z + dz)
    if (f === null) continue
    if (dz <= 0 && f > hi) hi = f
    if (dz >= 0 && f < lo) lo = f
  }
  if (hi === -Infinity || lo === Infinity) return 0
  return Math.min(1, Math.max(0, (hi - lo) / DESCENT_FULL))
}

export function smoothDescent(cur: number, target: number, dt: number): number {
  const rate = target > cur ? DESCENT_RATE_UP : DESCENT_RATE_DOWN
  return cur + (target - cur) * (1 - Math.exp(-dt * rate))
}

// 가속(속도 단계 상승) 뒤 sinceS초의 물러남. 시작 터널(단계 1)은 당기지 않는다(녹화 f_016은 가까운 리그).
export function boostPull(sinceS: number, level: number): number {
  if (level <= 1 || !(sinceS >= 0) || sinceS >= BOOST_PULL_S) return 0
  return BOOST_PULL * (1 - sinceS / BOOST_PULL_S)
}

export type CameraRig = { back: number; up: number; minDown: number }
export function cameraRig(f: number): CameraRig {
  const k = Math.min(1, Math.max(0, f))
  if (k === 0) return { back: CAM_BACK, up: CAM_UP, minDown: 0 }
  return { back: CAM_BACK + (CAM_BACK_FAR - CAM_BACK) * k, up: CAM_UP + (CAM_UP_FAR - CAM_UP) * k, minDown: MIN_DOWN_FAR * k }
}

const FLAT_RIG: CameraRig = cameraRig(0)

export function cameraTarget(
  course: Course,
  ball: { x: number; y: number; z: number },
  rig: CameraRig = FLAT_RIG,
): { eyeY: number; minEyeY: number } {
  let base = ball.y
  let floorMax = -Infinity
  for (let dz = EYE_PROBE; dz < rig.back + EYE_PROBE; dz += EYE_PROBE) {
    const f = floorAt(course, ball.x, ball.z - Math.min(dz, rig.back))
    if (f === null) continue
    if (f + R > base) base = f + R
    if (f > floorMax) floorMax = f
  }
  const eyeY = base + rig.up
  return { eyeY, minEyeY: Math.min(eyeY, floorMax + EYE_CLEAR) }
}

// v7: 시선이 내다볼 점 — 공 열의 LOOK_AHEAD_S초 앞(LOOK_AHEAD_MIN..MAX) 바닥 위 블록 꼭대기. 급경사를 내려온 직후 눈이 높이
// 남아(EYE_RATE_DOWN) 공을 BALL_FRAC에 두려고 40° 가까이 숙이면 앞 길이 화면 위로 잘려 블록이 0.4초 앞에야 보였다.
// lookPitch가 이 점을 화면 위 끝 LOOK_TOP_MARGIN 안에 두도록 덜 숙인다(공은 그만큼 화면 아래로 내려간다).
export const LOOK_AHEAD_S = 1.2
export const LOOK_AHEAD_MIN = 20000
export const LOOK_AHEAD_MAX = 60000
export function lookAheadPoint(course: Course, ball: { x: number; y: number; z: number; vz: number }): { y: number; z: number } {
  const d = Math.min(LOOK_AHEAD_MAX, Math.max(LOOK_AHEAD_MIN, ball.vz * TICK_HZ * LOOK_AHEAD_S))
  const f = floorAt(course, ball.x, ball.z + d)
  return { y: (f ?? ball.y - R) + BLOCK_H, z: ball.z + d }
}
const DEG = Math.PI / 180
const HALF_FOV = (VFOV / 2) * DEG
export const LOOK_TOP_MARGIN = 2 * DEG // 내다볼 점은 화면 위 끝에서 이만큼 아래
export const BALL_BOTTOM_MARGIN = 6 * DEG // 공 가운데는 화면 아래 끝에서 이만큼 위(공이 우선)

// 시선 각(rad, 음수면 아래). eye·ball은 (y, z) mm, z는 앞쪽이 +. minDown(rad)이 있으면 적어도 그만큼 숙인다(세계 기준).
const BALL_OFF = Math.atan((BALL_FRAC - 0.5) * 2 * Math.tan(((VFOV / 2) * Math.PI) / 180))
// ahead(lookAheadPoint)가 있으면 그 점이 화면 위로 잘리지 않을 만큼만 숙인다(최소 숙임보다 우선). 공은 화면 아래 끝 여유 안에 남긴다.
export function lookPitch(
  eye: { y: number; z: number },
  ball: { y: number; z: number },
  minDown = 0,
  ahead: { y: number; z: number } | null = null,
): number {
  const toBall = Math.atan2(ball.y - eye.y, ball.z - eye.z)
  let p = toBall + BALL_OFF
  if (minDown > 0) p = Math.min(p, -minDown)
  if (ahead !== null) {
    p = Math.max(p, Math.atan2(ahead.y - eye.y, ahead.z - eye.z) + LOOK_TOP_MARGIN - HALF_FOV)
    p = Math.min(p, toBall + HALF_FOV - BALL_BOTTOM_MARGIN)
  }
  return p
}

// 카메라 한 프레임(장면 render가 쓰는 순서 그대로, 순수 함수). desc·eyeY가 NaN이면 첫 프레임(목표로 바로 둔다).
// descWant: 이번 프레임 내리막 정도 목표(내리막·가속 중 큰 쪽). null이면 desc를 그대로 둔다(부딪혀 죽은 뒤).
// ball.y는 그린 공 높이(기운 판 보정 포함), vz는 시선이 내다볼 거리를 정하는 전진 속도(mm/틱).
export type CamState = { desc: number; eyeY: number }
export function cameraStep(
  course: Course,
  cam: CamState,
  ball: { x: number; y: number; z: number; vz: number },
  descWant: number | null,
  dt: number,
): CamState & { back: number; pitch: number } {
  const first = Number.isNaN(cam.eyeY)
  const desc = descWant === null ? cam.desc : first ? descWant : smoothDescent(cam.desc, descWant, dt)
  const rig = cameraRig(desc)
  const t = cameraTarget(course, ball, rig)
  let eyeY = first ? t.eyeY : smoothEye(cam.eyeY, t.eyeY, t.minEyeY, dt)
  const ahead = lookAheadPoint(course, ball)
  const ez = ball.z - rig.back
  // 공과 내다볼 점이 한 화면(여유 빼고)에 들어가지 않을 만큼 눈이 높이 남았으면 들어갈 때까지 눈을 내린다(목표 높이까지만).
  const fits = (e: number): boolean =>
    Math.atan2(ahead.y - e, ahead.z - ez) - Math.atan2(ball.y - e, ball.z - ez) <= 2 * HALF_FOV - LOOK_TOP_MARGIN - BALL_BOTTOM_MARGIN
  if (eyeY > t.eyeY && !fits(eyeY)) {
    let lo = t.eyeY
    let hi = eyeY
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    eyeY = lo
  }
  const pitch = lookPitch({ y: eyeY, z: ez }, ball, rig.minDown, ahead)
  return { desc, eyeY, back: rig.back, pitch }
}

// 눈 높이 한 프레임 보간(mm). 내려갈 때는 천천히, 올라갈 때는 빨리. 목표보다 EYE_LAG_MAX 넘게 높지 않고 minEye 아래로 가지 않는다.
export function smoothEye(cur: number, target: number, minEye: number, dt: number): number {
  const rate = target < cur ? EYE_RATE_DOWN : EYE_RATE_UP
  let y = cur + (target - cur) * (1 - Math.exp(-dt * rate))
  if (y > target + EYE_LAG_MAX) y = target + EYE_LAG_MAX
  return Math.max(minEye, y)
}

// 기운 판 위 공 높이 보정(mm) 한 프레임. 판 면(target)이 공보다 내려가면 시뮬 중력(G)으로 떨어지되 면 위 BANK_FLOAT_MAX
// 넘게 뜨지 않고(판 이음에서 내려가는 첫 프레임들을 부드럽게, 그러나 허공에 뜬 공으로 보이지 않게), 올라가면 면을 그대로
// 따라간다(면 속에 묻히지 않게). vy는 mm/s.
export const BANK_FLOAT_MAX = 100
const BANK_G = G * TICK_HZ * TICK_HZ
export function bankFollow(st: { dy: number; vy: number }, target: number, dt: number): { dy: number; vy: number } {
  if (target >= st.dy) return { dy: target, vy: 0 }
  const vy = st.vy - BANK_G * dt
  const dy = Math.min(st.dy + vy * dt, target + BANK_FLOAT_MAX)
  return dy <= target ? { dy: target, vy: 0 } : { dy, vy }
}

// 기운 판은 같은 행에서 이어진 같은 방향 칸들을 한 판으로 보고 판 윗면 가운데를 축으로 굴려 그린다. 같은 칸 범위·방향의 판이
// 이어지는 행 묶음의 처음·끝 BANK_EASE 안에서는 굴림을 0까지 줄여(판을 비틀어) 평평한 이웃 행과 이음매 높이를 맞춘다.
export const BANK_ANGLE = (20 * Math.PI) / 180
export const BANK_EASE = 1000

export type Plank = { lo: number; hi: number; bank: -1 | 1; h: number; r0: number; r1: number }

function plankInRow(course: Course, col: number, row: number): { lo: number; hi: number; bank: -1 | 1; h: number } | null {
  const c = course.cell(col, row)
  if (c.bank === undefined || c.floor === null) return null
  const h = c.floor.h0
  const bank = c.bank
  const same = (k: number): boolean => {
    const o = course.cell(k, row)
    return o.bank === bank && o.floor !== null && o.floor.h0 === h
  }
  let lo = col
  let hi = col
  while (lo - 1 >= COL_MIN && same(lo - 1)) lo--
  while (hi + 1 <= COL_MAX && same(hi + 1)) hi++
  return { lo, hi, bank, h }
}

// (col, row) 칸이 속한 판과 그 판이 이어지는 행 범위 [r0, r1). 기운 칸이 아니면 null.
export function plankAt(course: Course, col: number, row: number): Plank | null {
  const p = plankInRow(course, col, row)
  if (p === null) return null
  const same = (r: number): boolean => {
    const q = plankInRow(course, p.lo, r)
    return q !== null && q.lo === p.lo && q.hi === p.hi && q.bank === p.bank && q.h === p.h
  }
  let r0 = row
  let r1 = row + 1
  while (r0 - 1 >= 0 && same(r0 - 1)) r0--
  while (same(r1)) r1++
  return { ...p, r0, r1 }
}

// 판 묶음 안 z에서 굴림 비율(0..1). 선형이라 비튼 구간의 칸 선이 거의 곧게 보인다(smoothstep은 S자로 휘어 보였다).
export function plankEase(p: Plank, z: number): number {
  const d = Math.min(z - p.r0 * ROW, p.r1 * ROW - z)
  return Math.min(1, Math.max(0, d / BANK_EASE))
}

export function bankEase(course: Course, col: number, z: number): number {
  const p = plankAt(course, col, Math.floor(z / ROW))
  return p === null ? 0 : plankEase(p, z)
}

// 공 x에서 굴린 면이 칸 높이(시뮬 바닥)보다 얼마나 높은지(mm, 낮으면 음수). 기운 판이 아니면 0.
export function bankOffset(course: Course, x: number, z: number): number {
  const p = plankAt(course, Math.floor((x + 500) / 1000), Math.floor(z / ROW))
  if (p === null) return 0
  const pc = ((p.lo + p.hi) * 1000) / 2
  return -p.bank * (x - pc) * Math.tan(BANK_ANGLE * plankEase(p, z))
}

// 건물은 z를 LOT 길이 구획으로 나눠 구획마다 양옆에 앞뒤 두 줄로 둔다(원작처럼 트랙 가까이 빽빽한 고층 건물 숲).
// 구획마다 난수를 같은 개수만 뽑으므로 어느 범위로 나눠 불러도 결과가 같고, 구획 중심(cz)이 속한 범위에서만 돌려줘 겹치지 않는다.
const LOT = 6000
const MIN_GAP = X_LIMIT + 1300 // 트랙 끝에서 건물 안쪽 면까지 최소 거리(X_LIMIT + 1000보다 넓게)

export function buildingsFor(seed: string, fromRow: number, toRow: number): Building[] {
  const fromZ = fromRow * ROW
  const toZ = toRow * ROW
  const out: Building[] = []
  if (toZ <= fromZ) return out
  const next = decorRandom(seed)
  for (let k = 0; k * LOT + LOT / 2 < toZ; k++) {
    const cz = k * LOT + LOT / 2
    for (const side of [-1, 1]) {
      // 앞줄
      const w = 3000 + (next() % 5000)
      const d = LOT - 2500 + (next() % 2000)
      const h = 9000 + (next() % 30000)
      const gap = MIN_GAP + (next() % 3000)
      // 뒷줄(앞줄 뒤, 더 높게)
      const w2 = 5000 + (next() % 6000)
      const h2 = 18000 + (next() % 45000)
      const gap2 = gap + w + 1500 + (next() % 4000)
      if (cz < fromZ) continue
      out.push({ cx: side * (gap + w / 2), cz, w, d, h })
      out.push({ cx: side * (gap2 + w2 / 2), cz, w: w2, d: d - 1000, h: h2 })
    }
  }
  return out
}

// 굴러가는 공(v3): 한 프레임 동안 공 중심이 (dx, dz) mm(시뮬 좌표) 옮겨 갔을 때 미끄러짐 없이 구른 회전을 장면 좌표(x = 시뮬 x,
// z = -시뮬 z)의 세계 기준 사원수 [x, y, z, w]로 out에 쓴다. 각속도 = 위(0, 1, 0) × 장면 속도(dx, 0, -dz) / R
// = (-dz, 0, -dx) / R, 회전각 = 거리 / R. 앞으로는 x축, 옆으로는 z축으로 구른다. 장면은 기존 자세에 왼쪽에서 곱한다.
// 매 프레임 부르므로 새 배열을 만들지 않는다.
// 회전각은 프레임당 ROLL_MAX_ANGLE까지만(최고 속도 한 틱 794 mm = 2.27 rad를 그대로 돌리면 60 Hz에서 무늬가 거꾸로 도는 듯
// 깜박인다). 작은 변위는 그대로 d / R이다.
export const ROLL_MAX_ANGLE = 1
export function rollQuat(dx: number, dz: number, out: number[]): number[] {
  const d = Math.hypot(dx, dz)
  if (d === 0) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    out[3] = 1
    return out
  }
  const half = Math.min(d / R, ROLL_MAX_ANGLE) / 2
  const k = Math.sin(half) / d
  out[0] = -dz * k
  out[1] = 0
  out[2] = -dx * k
  out[3] = Math.cos(half)
  return out
}
