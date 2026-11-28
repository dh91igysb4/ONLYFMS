// 첫 코스 neon-1 (레이싱 설계 §5.4): 도시 위 고가 도로. 도로 밖은 허공이라 떨어지면 체크포인트로 복귀한다.
// 손으로 찍은 제어점을 Catmull-Rom으로 펴고, 길이를 목표 3,400m(85% 최고속으로 약 80초)에 맞춰 수평으로 늘린다.
// 점프대 3개(출발 직선, 시케인 뒤 직선, 헤어핀 뒤 넓은 직선), 시케인을 가로지르는 지름길 1개(점프대 + 착지대).
import type { Course, CourseBox, Vec3 } from './types.ts'

type Ctrl = [x: number, z: number, y: number, w: number]

// 지름길이 가로지르는 시케인의 들어가는 점·나오는 점(제어점 인덱스)
const CHICANE_IN = 11
const CHICANE_OUT = 14
// 점프대를 둘 제어점: 모두 직선 위(착지할 곳도 직선). 곡선·언덕 정상의 점프대는 코스 밖으로 날아가 버린다
const RAMP_AT = [3, 15, 21]

const CTRL: Ctrl[] = [
  [0, 0, 0, 14], [0, 150, 0, 14], [0, 350, 0, 14], [0, 550, 0, 14], [0, 700, 0, 14],
  [40, 820, 4, 12], [150, 900, 10, 12], [300, 930, 16, 12], [450, 900, 10, 12], [560, 800, 4, 12],
  [600, 650, 0, 12],
  [600, 550, 0, 12], [640, 490, 0, 12], [640, 410, 0, 12], [600, 350, 0, 12],
  [600, 250, 0, 12], [600, 100, 0, 12],
  [570, 10, 0, 11], [500, -30, 0, 11], [430, 10, 0, 11], [400, 100, 0, 11],
  [400, 300, 0, 14], [400, 450, 0, 14], [400, 600, 0, 14],
  [360, 700, 3, 12], [250, 740, 6, 12], [120, 720, 3, 12],
  [80, 600, 0, 12], [100, 400, 0, 14], [100, 250, 0, 14], [100, 150, 0, 14],
]

const TARGET_LENGTH = 3400
const STEP = 4
const CHECKPOINT_EVERY = 300

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

type Sample = { p: Vec3; w: number; ctrl: number }

function sample(ctrl: Ctrl[], scale: number): Sample[] {
  const P = ctrl.map(([x, z, y, w]) => ({ x: x * scale, z: z * scale, y, w }))
  const at = (i: number) => P[Math.max(0, Math.min(P.length - 1, i))]
  const out: Sample[] = []
  for (let i = 0; i < P.length - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    const len = Math.hypot(c.x - b.x, c.z - b.z, c.y - b.y)
    const k = Math.max(1, Math.ceil(len / STEP))
    for (let j = 0; j < k; j++) {
      const t = j / k
      out.push({
        p: { x: cr(a.x, b.x, c.x, d.x, t), y: cr(a.y, b.y, c.y, d.y, t), z: cr(a.z, b.z, c.z, d.z, t) },
        w: b.w + (c.w - b.w) * t,
        ctrl: i + t,
      })
    }
  }
  const last = P[P.length - 1]
  out.push({ p: { x: last.x, y: last.y, z: last.z }, w: last.w, ctrl: P.length - 1 })
  return out
}

function lengthOf(s: Sample[]): number {
  let l = 0
  for (let i = 1; i < s.length; i++) l += Math.hypot(s[i].p.x - s[i - 1].p.x, s[i].p.y - s[i - 1].p.y, s[i].p.z - s[i - 1].p.z)
  return l
}

// 길이를 목표에 맞춘다(수평 배율 한 번 보정 + 한 번 더 미세 보정)
function build(): Course {
  let scale = 1
  let s = sample(CTRL, scale)
  for (let k = 0; k < 2; k++) {
    scale *= TARGET_LENGTH / lengthOf(s)
    s = sample(CTRL, scale)
  }
  const centerline = s.map((q) => q.p)
  const width = s.map((q) => q.w)
  const bank = s.map(() => 0)
  const idxOfCtrl = (ci: number) => s.findIndex((q) => q.ctrl >= ci)
  const yawAt = (i: number) => {
    const a = centerline[Math.max(0, i - 1)]
    const b = centerline[Math.min(centerline.length - 1, i + 1)]
    return Math.atan2(b.x - a.x, b.z - a.z)
  }

  const boxes: CourseBox[] = []
  // 도로 위 점프대: 도로 폭 전체, 앞이 올라간다(pitch 음수 = 앞이 위). 뒤끝 윗면이 노면 높이.
  const RAMP_PITCH = -0.21
  const RH = { x: 0, y: 0.4, z: 5 }
  for (const ci of RAMP_AT) {
    const i = idxOfCtrl(ci)
    const yaw = yawAt(i)
    const p = centerline[i]
    const lift = -(RH.y * Math.cos(RAMP_PITCH) - RH.z * Math.abs(Math.sin(RAMP_PITCH)))
    boxes.push({ kind: 'ramp', center: { x: p.x, y: p.y + lift, z: p.z }, half: { ...RH, x: width[i] / 2 }, rot: { pitch: RAMP_PITCH, yaw, roll: 0 } })
  }

  // 지름길: 시케인 입구의 오른쪽 절반(시케인이 휘는 반대쪽)에 점프대, 입구→출구 직선 위에 긴 착지대.
  const a = idxOfCtrl(CHICANE_IN)
  const b = idxOfCtrl(CHICANE_OUT)
  const A = centerline[a]
  const B = centerline[b]
  const dir = { x: B.x - A.x, z: B.z - A.z }
  const dl = Math.hypot(dir.x, dir.z)
  const ux = dir.x / dl
  const uz = dir.z / dl
  const yawAB = Math.atan2(ux, uz)
  // 옆 방향(up × u) 반대쪽으로 3m: 시케인은 +옆으로 휘므로 반대쪽 절반
  const off = -3
  const KH = { x: 2.5, y: 0.3, z: 5 }
  const KP = -0.21
  const klift = -(KH.y * Math.cos(KP) - KH.z * Math.abs(Math.sin(KP)))
  boxes.push({ kind: 'shortcut', center: { x: A.x + uz * off, y: A.y + klift, z: A.z - ux * off }, half: KH, rot: { pitch: KP, yaw: yawAB, roll: 0 } })
  const from = 0.3
  const to = 0.97
  const mid = (from + to) / 2
  const PH = { x: 5, y: 0.5, z: (dl * (to - from)) / 2 }
  boxes.push({
    kind: 'shortcut',
    center: { x: A.x + ux * dl * mid + uz * off, y: A.y - PH.y, z: A.z + uz * dl * mid - ux * off },
    half: PH,
    rot: { pitch: 0, yaw: yawAB, roll: 0 },
  })

  // 체크포인트 300m마다, 도착은 끝에서 5점 앞
  const finish = centerline.length - 6
  const checkpoints = [0]
  let acc = 0
  for (let i = 1; i < finish; i++) {
    const p = centerline[i]
    const q = centerline[i - 1]
    acc += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
    if (acc >= CHECKPOINT_EVERY) {
      checkpoints.push(i)
      acc = 0
    }
  }

  const st = centerline[2]
  return {
    id: 'neon-1',
    centerline,
    width,
    bank,
    boxes,
    checkpoints,
    finish,
    start: { pos: { x: st.x, y: st.y + 0.8, z: st.z }, yaw: yawAt(2) },
    openWalls: [[a - 3, a + 15], [b - 15, b + 3]],
  }
}

export const neon1: Course = build()
