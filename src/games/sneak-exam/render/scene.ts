// 몰래 수능 Three.js 교실 장면(설계 §3.2, §6). React를 쓰지 않는다. 시뮬은 읽기만 한다.
// 좌표: 시뮬 (x, z) mm → 장면 (x, y, -z) m. 카메라가 장면 -z(칠판 쪽)를 보므로 시뮬 +x가 화면 오른쪽이다.
// 모델은 모두 상자 조합(로우폴리). 장면 내부 색은 theme 토큰 규칙의 승인된 예외다.
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COL_X, FRONT_Z, ME_X, ME_Z, N_CHOICE, N_Q, PROG_MAX, ROW_Z } from '../constants.ts'
import type { SimState } from '../sim.ts'
import { CAM } from './view.ts'

const M = 1 / 1000
const MAX_DPR = 2
const BG = '#1b1712'
// 카메라 아래로 숙인 각. 책상 위 답안지가 화면 아래에 걸리고, 옆 통로 (0|1800, 3800)에 선 감독관이 머리까지 화면 안에 든다.
// 숙일수록 위쪽 점이 가까워져 화면 가장자리로 밀리므로 그 감독관의 어깨가 잘리지 않는 만큼만 숙인다.
const PITCH = (-12 * Math.PI) / 180

// 교실 크기(m)
const WALL_X = 4.2
const BACK_Z = -0.3 // 장면 z. 시뮬 z = 300 쯤(카메라 뒤)
const FRONT_WALL_Z = -9.6
const ROOM_H = 3.0
// 책상·의자: 줄 중심(학생 몸) 기준. 책상은 앞(+시뮬 z)으로 DESK_AHEAD만큼.
const DESK_AHEAD = 0.4
const DESK_W = 0.62
const DESK_D = 0.46
const DESK_H = 0.72
const SEAT_H = 0.44
const UPPER_S = 0.86 // 앉은 학생 상체 비율

// 감독관
const SWING = 0.5 // 걸을 때 다리 흔들림(rad)
const STEP_HZ = 1.7
const DOZE_NOD = 0.85 // 졸 때 고개 숙임(rad)
const DOZE_SLUMP = 0.08 // 졸 때 몸이 앞으로 기우는 각(rad)
const TURN_RATE = 10 // 방향 전환 보간 속도(1/s)
const CAUGHT_MS = 600
const CAUGHT_DIST = 1.15 // 적발 때 카메라 앞 거리(m). 몸과 팔이 화면 폭을 거의 채운다.
const CAUGHT_PITCH = (14 * Math.PI) / 180 // 적발 때 카메라가 올려다보는 각(감독관 얼굴이 보이게)

// 휴대폰 빛
const PHONE_COLOR = '#7fd8ff'
const PHONE_LIGHT = 2.5
const GLOW_D = 0.1 // 화면 빛 판까지 거리(m)
const GLOW_H = 0.5 // 화면 빛이 덮는 아래쪽 높이 비율
const GLOW_OPACITY = 0.4 // 손에 든 휴대폰이 보이므로 번지는 빛은 약하게
// 손에 든 휴대폰(카메라에 붙인 판 몇 장): 책상 아래에서 슬쩍 올라온다.
const PH_D = 0.4 // 카메라에서 거리(m)
const PH_H = 0.26 // 휴대폰 높이(m). 화면 높이의 40%쯤
const PH_X = -0.55 // 화면 반폭 대비 가로 위치(왼쪽 아래)
const PH_RATE = 9 // 꺼내고 넣는 속도(1/s)
const PH_BODY = '#15171c'
const PH_W = 128
const PH_PX = 256
const CIRCLED = ['①', '②', '③', '④', '⑤']

// 정점 색을 칠한 상자. (x, y, z)는 상자 중심, 장면 m.
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, rx = 0, ry = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d)
  if (rx !== 0) g.rotateX(rx)
  if (ry !== 0) g.rotateY(ry)
  g.translate(x, y, z)
  const c = new Color(color)
  const n = g.getAttribute('position').count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  return g
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!g) throw new Error('장면 도형을 합치지 못했어요')
  return g
}

// 상자들을 행렬로 옮겨 붙인다(앉은 학생의 기울인 머리처럼 부분 회전에 쓴다).
function transformed(parts: BufferGeometry[], m: Matrix4): BufferGeometry[] {
  for (const p of parts) p.applyMatrix4(m)
  return parts
}

// ---- 교실 고정 도형(조명 받는 것)
const FLOOR = '#b48a5a'
const FLOOR_LINE = '#9c7448'
const WALL = '#e9e2cf'
const WAINSCOT = '#8fa48a'
const DESK_TOP = '#d9b77f'
const METAL = '#5b6068'
const CHAIR = '#c79a5e'
const SKIN = '#f0c9a0'
const HAIR = ['#1d1915', '#2b2119', '#3a2a1e']
const CLOTHES = ['#2c3a5c', '#e8e6df', '#3d4b3a', '#6b6f78', '#24324d', '#8a3b3b', '#d9d2c0']
const PANTS = ['#2a2d36', '#3a3c44', '#26304a']

function classroomParts(): BufferGeometry[] {
  const p: BufferGeometry[] = []
  const len = BACK_Z - FRONT_WALL_Z
  const midZ = (BACK_Z + FRONT_WALL_Z) / 2
  // 바닥 + 마루 줄
  p.push(box(WALL_X * 2, 0.02, len, 0, -0.01, midZ, FLOOR))
  for (let x = -WALL_X + 0.6; x < WALL_X; x += 0.6) p.push(box(0.012, 0.004, len, x, 0.001, midZ, FLOOR_LINE))
  // 세 벽(왼쪽·오른쪽·앞) + 아래 징두리
  p.push(box(0.1, ROOM_H, len, -WALL_X - 0.05, ROOM_H / 2, midZ, WALL))
  p.push(box(0.1, ROOM_H, len, WALL_X + 0.05, ROOM_H / 2, midZ, WALL))
  p.push(box(WALL_X * 2, ROOM_H, 0.1, 0, ROOM_H / 2, FRONT_WALL_Z - 0.05, WALL))
  p.push(box(0.02, 0.9, len, -WALL_X + 0.01, 0.45, midZ, WAINSCOT))
  p.push(box(0.02, 0.9, len, WALL_X - 0.01, 0.45, midZ, WAINSCOT))
  p.push(box(WALL_X * 2, 0.9, 0.02, 0, 0.45, FRONT_WALL_Z + 0.01, WAINSCOT))
  // 칠판 틀·분필 받침(판은 텍스처 메시)
  p.push(box(4.64, 1.38, 0.05, 0, 1.55, FRONT_WALL_Z + 0.03, '#7a5a38'))
  p.push(box(4.5, 0.04, 0.1, 0, 0.84, FRONT_WALL_Z + 0.07, '#7a5a38'))
  p.push(box(0.12, 0.03, 0.03, 1.4, 0.875, FRONT_WALL_Z + 0.08, '#ffffff'))
  // 시계(칠판 위)
  p.push(box(0.36, 0.36, 0.04, 0, 2.62, FRONT_WALL_Z + 0.02, '#2f2f2f'))
  p.push(box(0.3, 0.3, 0.02, 0, 2.62, FRONT_WALL_Z + 0.04, '#f7f4ea'))
  p.push(box(0.02, 0.12, 0.01, 0, 2.66, FRONT_WALL_Z + 0.055, '#222222'))
  p.push(box(0.09, 0.02, 0.01, 0.04, 2.62, FRONT_WALL_Z + 0.055, '#222222'))
  // 앞쪽 교단·교탁(0, 8800)
  p.push(box(WALL_X * 2, 0.12, 1.4, 0, 0.06, FRONT_WALL_Z + 0.7, '#8d6a43'))
  const tz = -8.8
  p.push(box(0.95, 1.0, 0.55, 0, 0.62, tz, '#7b5634'))
  p.push(box(1.02, 0.05, 0.62, 0, 1.145, tz, '#5e4126'))
  p.push(box(0.6, 0.5, 0.01, 0, 0.7, tz + 0.28, '#8f6942'))
  // 창틀(왼쪽 벽). 유리는 조명 없는 메시.
  for (let i = 0; i < 4; i++) {
    const z = -1.6 - i * 2.0
    p.push(box(0.06, 0.06, 1.7, -WALL_X + 0.03, 1.0, z, '#f8f6f0'))
    p.push(box(0.06, 0.06, 1.7, -WALL_X + 0.03, 2.4, z, '#f8f6f0'))
    p.push(box(0.06, 1.46, 0.06, -WALL_X + 0.03, 1.7, z - 0.85, '#f8f6f0'))
    p.push(box(0.06, 1.46, 0.06, -WALL_X + 0.03, 1.7, z + 0.85, '#f8f6f0'))
    p.push(box(0.06, 1.46, 0.04, -WALL_X + 0.03, 1.7, z, '#f8f6f0'))
  }
  // 책상·의자 20개, 내 자리와 바로 앞 빈자리를 뺀 18명
  let k = 0
  for (let r = 0; r < ROW_Z.length; r++) {
    for (let c = 0; c < COL_X.length; c++) {
      const x = COL_X[c] * M
      const z = -ROW_Z[r] * M
      deskParts(p, x, z - DESK_AHEAD)
      if (COL_X[c] === ME_X && ROW_Z[r] === ME_Z) continue
      chairParts(p, x, z)
      // 바로 앞자리는 결시생(빈자리): 세로 화면 가운데로 칠판·앞 통로·감독관 전신이 보인다.
      if (COL_X[c] === ME_X && r === 1) continue
      studentParts(p, x, z, k++)
    }
  }
  return p
}

// 책상: 장면 (x, z) 중심.
function deskParts(p: BufferGeometry[], x: number, z: number): void {
  p.push(box(DESK_W, 0.03, DESK_D, x, DESK_H - 0.015, z, DESK_TOP))
  p.push(box(DESK_W - 0.04, 0.12, DESK_D - 0.06, x, DESK_H - 0.1, z - 0.02, '#a88658')) // 서랍(책 넣는 칸)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) p.push(box(0.03, DESK_H - 0.03, 0.03, x + sx * (DESK_W / 2 - 0.03), (DESK_H - 0.03) / 2, z + sz * (DESK_D / 2 - 0.03), METAL))
  }
  p.push(box(0.02, 0.02, DESK_D - 0.06, x - DESK_W / 2 + 0.03, 0.18, z, METAL))
  p.push(box(0.02, 0.02, DESK_D - 0.06, x + DESK_W / 2 - 0.03, 0.18, z, METAL))
}

// 의자: 줄 중심 (x, z) 쪽에 앉는다. 등받이는 뒤(+장면 z).
function chairParts(p: BufferGeometry[], x: number, z: number): void {
  const cz = z + 0.02
  p.push(box(0.4, 0.03, 0.38, x, SEAT_H, cz, CHAIR))
  p.push(box(0.38, 0.28, 0.025, x, SEAT_H + 0.32, cz + 0.2, CHAIR))
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) p.push(box(0.025, SEAT_H, 0.025, x + sx * 0.17, SEAT_H / 2, cz + sz * 0.16, METAL))
    p.push(box(0.02, 0.3, 0.02, x + sx * 0.17, SEAT_H + 0.15, cz + 0.2, METAL))
  }
}

// 앉은 학생: 의자 위, 책상 쪽(-장면 z)을 보며 대부분 고개를 숙이고 시험을 푼다.
function studentParts(p: BufferGeometry[], x: number, z: number, k: number): void {
  const top = CLOTHES[(k * 5 + 3) % CLOTHES.length]
  const pants = PANTS[k % PANTS.length]
  const hair = HAIR[(k * 7) % HAIR.length]
  const longHair = k % 3 === 1
  // 너무 숙이면 머리 아랫면(피부)이 뒤로 드러나 얼굴처럼 보인다.
  const lean = 0.16 + ((k * 13) % 5) * 0.03 // 몸을 책상 쪽으로 숙인 정도
  const nod = 0.12 + ((k * 11) % 4) * 0.07 // 고개 숙인 정도
  const tilt = (((k * 17) % 5) - 2) * 0.05 // 고개 갸웃
  const seatZ = z + 0.02
  // 허벅지·종아리·신발
  for (const sx of [-1, 1]) {
    const lx = x + sx * 0.09
    p.push(box(0.14, 0.13, 0.42, lx, SEAT_H + 0.08, seatZ - 0.15, pants))
    p.push(box(0.12, SEAT_H, 0.13, lx, SEAT_H / 2, seatZ - 0.36, pants))
    p.push(box(0.13, 0.07, 0.24, lx, 0.035, seatZ - 0.41, '#e8e8e8'))
  }
  // 상체(엉덩이 축으로 앞으로 숙임)
  const hip = new Matrix4().makeTranslation(x, SEAT_H + 0.1, seatZ + 0.04)
  // 상체는 조금 작게: 앞자리 학생 머리가 눈높이 근처에 머물러 칠판 앞 감독관을 덜 가린다.
  const body = hip.clone().multiply(new Matrix4().makeRotationX(-lean)).multiply(new Matrix4().makeScale(UPPER_S, UPPER_S, UPPER_S))
  const upper: BufferGeometry[] = [
    box(0.38, 0.5, 0.22, 0, 0.25, 0, top),
    box(0.1, 0.42, 0.11, -0.22, 0.27, -0.04, top, -0.5),
    box(0.1, 0.42, 0.11, 0.22, 0.27, -0.04, top, -0.5),
    box(0.09, 0.09, 0.09, -0.22, 0.1, -0.2, SKIN),
    box(0.09, 0.09, 0.09, 0.22, 0.1, -0.2, SKIN),
  ]
  p.push(...transformed(upper, body))
  // 머리(목 축으로 숙임)
  const neck = body.clone().multiply(new Matrix4().makeTranslation(0, 0.52, 0)).multiply(new Matrix4().makeRotationX(-nod)).multiply(new Matrix4().makeRotationZ(tilt))
  const head: BufferGeometry[] = [
    box(0.08, 0.06, 0.08, 0, 0.03, 0, SKIN),
    box(0.22, 0.24, 0.22, 0, 0.17, 0, SKIN),
    box(0.24, 0.09, 0.24, 0, 0.29, 0.005, hair),
    box(0.24, 0.3, 0.07, 0, 0.145, 0.095, hair),
    box(0.4, 0.07, 0.26, 0, -0.02, 0.0, top), // 옷깃
    box(0.03, 0.15, 0.2, -0.115, 0.22, 0.02, hair),
    box(0.03, 0.15, 0.2, 0.115, 0.22, 0.02, hair),
  ]
  if (longHair) head.push(box(0.25, 0.26, 0.06, 0, 0.06, 0.11, hair))
  p.push(...transformed(head, neck))
}

// ---- 감독관(정점 색, 부분마다 축이 있는 메시)
const SUIT = '#17181c'
const SHIRT = '#f4f4f2'
const TIE = '#7a1f2b'
const SHOE = '#0c0c0e'
const P_HAIR = '#141210'

type ProctorRig = {
  root: Group // 바닥 위치·방향
  body: Group // 앞으로 숙이기(적발 연출)
  legL: Group
  legR: Group
  armL: Group
  armR: Group
  head: Group
}

// 감독관 모델은 장면 +z(카메라 쪽)를 정면으로 만든다.
function buildProctor(material: Material, geos: BufferGeometry[]): ProctorRig {
  const mk = (parts: BufferGeometry[]): Mesh => {
    const g = merge(parts)
    geos.push(g)
    return new Mesh(g, material)
  }
  const root = new Group()
  const body = new Group()
  root.add(body)
  const HIP = 0.9
  const legL = new Group()
  const legR = new Group()
  for (const [leg, sx] of [[legL, -1], [legR, 1]] as const) {
    leg.position.set(sx * 0.1, HIP, 0)
    leg.add(mk([box(0.15, HIP - 0.06, 0.16, 0, -(HIP - 0.06) / 2, 0, SUIT), box(0.15, 0.08, 0.28, 0, -HIP + 0.04, 0.05, SHOE)]))
    body.add(leg)
  }
  // 몸통: 뒤는 검은 정장, 앞은 흰 셔츠 V와 넥타이.
  body.add(
    mk([
      box(0.42, 0.62, 0.24, 0, HIP + 0.31, 0, SUIT),
      box(0.14, 0.4, 0.01, 0, HIP + 0.42, 0.125, SHIRT),
      box(0.05, 0.34, 0.012, 0, HIP + 0.4, 0.132, TIE),
      box(0.38, 0.06, 0.25, 0, HIP + 0.02, 0, '#0a0a0c'), // 허리띠
      box(0.1, 0.06, 0.1, 0, HIP + 0.64, 0, SKIN), // 목
    ]),
  )
  const armL = new Group()
  const armR = new Group()
  for (const [arm, sx] of [[armL, -1], [armR, 1]] as const) {
    arm.position.set(sx * 0.265, HIP + 0.58, 0) // 바깥 끝 ±0.32 m: 옆 통로 3800에서도 화면 폭 안
    arm.add(mk([box(0.11, 0.6, 0.14, 0, -0.3, 0, SUIT), box(0.09, 0.1, 0.1, 0, -0.64, 0, SKIN)]))
    body.add(arm)
  }
  // 머리: 앞은 얼굴(눈·코·안경), 뒤는 머리카락으로 덮어 뒷모습과 앞모습이 다르게 보인다.
  const head = new Group()
  head.position.set(0, HIP + 0.66, 0)
  head.add(
    mk([
      box(0.26, 0.28, 0.26, 0, 0.16, 0, SKIN),
      box(0.28, 0.08, 0.28, 0, 0.32, 0, P_HAIR),
      box(0.28, 0.24, 0.07, 0, 0.19, -0.11, P_HAIR),
      box(0.04, 0.16, 0.24, -0.13, 0.22, -0.02, P_HAIR),
      box(0.04, 0.16, 0.24, 0.13, 0.22, -0.02, P_HAIR),
      box(0.05, 0.035, 0.012, -0.06, 0.19, 0.133, '#101010'),
      box(0.05, 0.035, 0.012, 0.06, 0.19, 0.133, '#101010'),
      box(0.2, 0.012, 0.012, 0, 0.215, 0.138, '#3a3a3a'), // 안경테
      box(0.04, 0.06, 0.06, 0, 0.13, 0.15, '#e2b48a'), // 코
      box(0.08, 0.015, 0.01, 0, 0.07, 0.132, '#9b5a4a'), // 입
    ]),
  )
  body.add(head)
  return { root, body, legL, legR, armL, armR, head }
}

// ---- 텍스처
function boardTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 300
  const g = c.getContext('2d')
  if (g) {
    g.fillStyle = '#2f4a3a'
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = 'rgba(255,255,255,0.05)'
    for (let i = 0; i < 40; i++) g.fillRect((i * 263) % 1000, (i * 97) % 280, 90, 10)
    // 화면이 세로라 칠판 양 끝은 잘 안 보인다. 글은 가운데에 모은다.
    g.textAlign = 'center'
    g.fillStyle = 'rgba(245,245,235,0.9)'
    g.font = 'bold 56px sans-serif'
    g.fillText('2교시  수학 영역', 512, 95)
    g.font = '40px sans-serif'
    g.fillText('조용히! 시험 중', 512, 170)
    g.fillStyle = 'rgba(255,230,140,0.9)'
    g.fillText('휴대 전화는 가방에', 512, 240)
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

const SHEET_W = 256
const SHEET_H = 360
function drawSheet(g: CanvasRenderingContext2D, marks: readonly number[], q: number): void {
  g.fillStyle = '#f6f1e3'
  g.fillRect(0, 0, SHEET_W, SHEET_H)
  g.fillStyle = '#d9534f'
  g.fillRect(0, 0, SHEET_W, 40)
  g.fillStyle = '#ffffff'
  g.font = 'bold 24px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('답안지', SHEET_W / 2, 21)
  const top = 52
  const rowH = (SHEET_H - top - 8) / N_Q
  for (let i = 0; i < N_Q; i++) {
    const y = top + i * rowH + rowH / 2
    if (i === q) {
      g.fillStyle = 'rgba(255,196,64,0.35)'
      g.fillRect(4, y - rowH / 2 + 2, SHEET_W - 8, rowH - 4)
    }
    g.fillStyle = '#c0392b'
    g.font = 'bold 22px sans-serif'
    g.fillText(String(i + 1), 24, y)
    for (let k = 0; k < N_CHOICE; k++) {
      const cx = 66 + k * 42
      g.beginPath()
      g.ellipse(cx, y, 12, 15, 0, 0, Math.PI * 2)
      if (marks[i] === k) {
        g.fillStyle = '#1a1a1a'
        g.fill()
      } else {
        g.strokeStyle = '#d9534f'
        g.lineWidth = 2
        g.stroke()
        g.fillStyle = '#d9534f'
        g.font = '13px sans-serif'
        g.fillText(String(k + 1), cx, y + 1)
      }
    }
  }
}

// 휴대폰 화면: 풀이 중이면 진행 막대, 다 풀리면 정답 번호. answer < 0이면 풀이 중.
function drawPhone(g: CanvasRenderingContext2D, q: number, pct: number, answer: number): void {
  g.fillStyle = '#0e1626'
  g.fillRect(0, 0, PH_W, PH_PX)
  g.fillStyle = '#1f6feb'
  g.fillRect(0, 0, PH_W, 34)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'bold 20px sans-serif'
  g.fillText('AI 풀이', PH_W / 2, 18)
  g.font = 'bold 26px sans-serif'
  g.fillStyle = '#9fb4d8'
  g.fillText(`문제 ${q + 1}`, PH_W / 2, 66)
  if (answer < 0) {
    g.fillStyle = '#ffffff'
    g.font = 'bold 21px sans-serif'
    g.fillText('풀이 중…', PH_W / 2, 116)
    g.fillStyle = '#26324a'
    g.fillRect(14, 142, PH_W - 28, 14)
    g.fillStyle = '#4fc3ff'
    g.fillRect(14, 142, ((PH_W - 28) * pct) / 100, 14)
    g.fillStyle = '#9fb4d8'
    g.font = 'bold 26px sans-serif'
    g.fillText(`${pct}%`, PH_W / 2, 186)
  } else {
    g.fillStyle = '#9fb4d8'
    g.font = 'bold 24px sans-serif'
    g.fillText('정답', PH_W / 2, 94)
    g.fillStyle = '#c9f25c'
    g.font = 'bold 70px sans-serif'
    g.fillText(CIRCLED[answer] ?? '?', PH_W / 2, 158)
  }
}

// 무릎 위 휴대폰이 아래에서 비추는 빛: 화면 아래 가운데가 가장 밝고 위·옆으로 사라진다.
function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(64, 150, 0, 64, 150, 150)
    grad.addColorStop(0, 'rgba(150,235,255,1)')
    grad.addColorStop(0.18, 'rgba(30,180,255,0.9)')
    grad.addColorStop(0.5, 'rgba(20,140,255,0.45)')
    grad.addColorStop(1, 'rgba(40,140,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

export type SceneHandle = {
  resize(width: number, height: number, dpr: number): void
  render(prev: SimState, cur: SimState, alpha: number, nowMs: number): void
  /** 이 판의 정답(문제별 0~4). 휴대폰 화면이 다 풀린 문제의 정답을 보여 주는 데만 쓴다. */
  setAnswers(answers: readonly number[]): void
  dispose(): void
}

// 각 a를 b 쪽으로 가장 짧게 t만큼.
function turnToward(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

// 시뮬 face → 장면 y 회전(모델 정면이 장면 +z). 0: 시뮬 −z = 장면 +z, 1: 장면 −z, 2: −x, 3: +x.
const FACE_YAW = [0, Math.PI, -Math.PI / 2, Math.PI / 2] as const

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true })
  } catch (e) {
    throw new Error(`WebGL을 만들 수 없어요: ${e instanceof Error ? e.message : String(e)}`)
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR))
  renderer.setClearColor(BG)

  const geometries: BufferGeometry[] = []
  const materials: Material[] = []
  const textures: Texture[] = []

  const scene = new Scene()
  scene.background = new Color(BG)
  const camera = new PerspectiveCamera(CAM.fovY, 1, 0.05, 30)
  camera.position.set(CAM.x * M, CAM.y * M, -CAM.z * M)
  camera.rotation.set(PITCH, 0, 0)

  // 창문(왼쪽) 쪽에서 들어오는 낮 햇빛 + 형광등 같은 고른 빛
  scene.add(new HemisphereLight('#fffaf0', '#6b5a48', 1.6))
  const sun = new DirectionalLight('#fff4e0', 1.5)
  sun.position.set(-6, 5, 3) // 왼쪽 창에서, 조금 뒤에서: 카메라가 보는 면(학생 등·감독관 정면·칠판)이 밝다
  scene.add(sun)

  const lit = new MeshLambertMaterial({ vertexColors: true })
  const unlit = new MeshBasicMaterial({ vertexColors: true })
  materials.push(lit, unlit)

  // 고정 교실(한 번의 그리기 호출)
  const roomGeo = merge(classroomParts())
  geometries.push(roomGeo)
  scene.add(new Mesh(roomGeo, lit))

  // 조명 없는 것: 창 유리(하늘), 천장, 형광등
  const glow: BufferGeometry[] = []
  for (let i = 0; i < 4; i++) {
    const z = -1.6 - i * 2.0
    glow.push(box(0.01, 1.36, 1.64, -WALL_X + 0.015, 1.7, z, '#bfe3f7'))
  }
  // 천장: 아래를 향한 면이라 반구광의 바닥색을 받아 어두워지므로 조명 없이 칠한다.
  glow.push(box(WALL_X * 2, 0.02, BACK_Z - FRONT_WALL_Z, 0, ROOM_H + 0.01, (BACK_Z + FRONT_WALL_Z) / 2, '#d8d2c2'))
  for (let r = 0; r < 3; r++) for (const x of [-1.8, 0, 1.8]) glow.push(box(0.18, 0.04, 1.3, x, ROOM_H - 0.02, -2.2 - r * 2.6, '#fbfbf4'))
  const glowGeo = merge(glow)
  geometries.push(glowGeo)
  scene.add(new Mesh(glowGeo, unlit))

  // 칠판
  const boardTex = boardTexture()
  textures.push(boardTex)
  const boardGeo = new PlaneGeometry(4.5, 1.25)
  const boardMat = new MeshLambertMaterial({ map: boardTex })
  geometries.push(boardGeo)
  materials.push(boardMat)
  const board = new Mesh(boardGeo, boardMat)
  board.position.set(0, 1.55, FRONT_WALL_Z + 0.06)
  scene.add(board)

  // 내 책상 위 답안지(책상에 눕히고 살짝 돌려 놓는다)
  const myDeskZ = -ME_Z * M - DESK_AHEAD
  const sheetCanvas = document.createElement('canvas')
  sheetCanvas.width = SHEET_W
  sheetCanvas.height = SHEET_H
  const sheetCtx = sheetCanvas.getContext('2d')
  const sheetTex = new CanvasTexture(sheetCanvas)
  sheetTex.colorSpace = SRGBColorSpace
  sheetTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
  textures.push(sheetTex)
  const sheetGeo = new PlaneGeometry(0.3, 0.42)
  const sheetMat = new MeshBasicMaterial({ map: sheetTex })
  geometries.push(sheetGeo)
  materials.push(sheetMat)
  const sheet = new Mesh(sheetGeo, sheetMat)
  sheet.rotation.set(-Math.PI / 2, 0, 0.06)
  sheet.position.set(ME_X * M - 0.03, DESK_H + 0.002, myDeskZ - 0.03)
  scene.add(sheet)
  const lastMarks = new Array<number>(N_Q).fill(-2)
  let lastQ = -1

  // 휴대폰 빛: 책상 아래 점광원(앞자리 의자·책상 다리를 물들인다) + 화면 아래에서 번지는 빛(카메라에 붙인 판).
  // 점광원은 늘 두고 세기만 바꾼다(조명 수가 바뀌면 셰이더를 다시 만든다).
  const phoneLight = new PointLight(PHONE_COLOR, 0, 2.2, 1.5)
  phoneLight.position.set(ME_X * M, 0.45, myDeskZ + 0.05)
  scene.add(phoneLight)
  const glowTex = glowTexture()
  textures.push(glowTex)
  const glowPlaneGeo = new PlaneGeometry(1, 1)
  const glowMat = new MeshBasicMaterial({ map: glowTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 })
  geometries.push(glowPlaneGeo)
  materials.push(glowMat)
  const lapGlow = new Mesh(glowPlaneGeo, glowMat)
  lapGlow.renderOrder = 10
  lapGlow.visible = false
  camera.add(lapGlow)
  scene.add(camera)
  // 판 크기: 카메라 앞 GLOW_D에서 화면 폭 전체, 높이 아래 GLOW_H 비율.
  function placeGlow(aspect: number): void {
    const halfH = GLOW_D * Math.tan((CAM.fovY * Math.PI) / 360)
    const h = halfH * 2 * GLOW_H
    lapGlow.scale.set(halfH * 2 * aspect, h, 1)
    lapGlow.position.set(0, -halfH + h / 2, -GLOW_D)
  }
  placeGlow(1)
  let phoneOn = 0 // 0..1, 켜고 끌 때 부드럽게

  // 손에 든 휴대폰. 깊이 검사 없이 renderOrder 순서로 겹쳐 그린다(손바닥 < 본체 < 화면 < 손가락).
  const phoneCanvas = document.createElement('canvas')
  phoneCanvas.width = PH_W
  phoneCanvas.height = PH_PX
  const phoneCtx = phoneCanvas.getContext('2d')
  const phoneTex = new CanvasTexture(phoneCanvas)
  phoneTex.colorSpace = SRGBColorSpace
  textures.push(phoneTex)
  const phoneRig = new Group()
  const flat = (w: number, h: number, x: number, y: number, order: number, color: string, map?: Texture, rz = 0): void => {
    const mat = new MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false })
    if (map) mat.map = map
    materials.push(mat)
    const m = new Mesh(glowPlaneGeo, mat)
    m.scale.set(w, h, 1)
    m.position.set(x, y, 0)
    m.rotation.z = rz
    m.renderOrder = order
    phoneRig.add(m)
  }
  flat(0.66, 0.9, 0.05, -0.5, 11, SKIN) // 손바닥·손목
  flat(0.5, 1, 0, 0, 12, PH_BODY) // 본체
  flat(0.44, 0.9, 0, 0.01, 13, '#ffffff', phoneTex) // 화면
  flat(0.15, 0.34, 0.24, -0.42, 14, SKIN, undefined, 0.4) // 엄지
  for (let i = 0; i < 3; i++) flat(0.1, 0.11, -0.275, -0.02 - i * 0.14, 14, SKIN) // 감싼 손가락
  phoneRig.scale.setScalar(PH_H)
  phoneRig.visible = false
  camera.add(phoneRig)
  let phShownX = 0
  let phShownY = 0
  let phHiddenY = 0
  function placePhone(aspect: number): void {
    const halfH = PH_D * Math.tan((CAM.fovY * Math.PI) / 360)
    phShownX = halfH * aspect * PH_X
    phShownY = -halfH + PH_H * 0.42 // 아래가 살짝 잘려 책상 밑에서 올라온 느낌
    phHiddenY = -halfH - PH_H * 1.1
  }
  placePhone(1)
  let phoneUp = 0 // 0..1, 손에 든 휴대폰이 올라온 정도
  let phoneKey = -1
  let answers: readonly number[] | null = null
  function setAnswers(a: readonly number[]): void {
    answers = a
    phoneKey = -1
  }

  // 감독관
  const rig = buildProctor(lit, geometries)
  scene.add(rig.root)
  let yaw: number = FACE_YAW[0]
  let swingAmp = 0
  let nod = 0
  let slump = 0
  let lastNow = -1
  let caughtAt = -1
  let caughtFromX = 0
  let caughtFromZ = 0
  let caughtFromYaw = 0
  let shownX = 0
  let shownZ = -FRONT_Z * M

  function render(prev: SimState, cur: SimState, alpha: number, nowMs: number): void {
    const dt = lastNow < 0 ? 0 : Math.min(0.1, Math.max(0, (nowMs - lastNow) / 1000))
    lastNow = nowMs
    const a = Math.min(1, Math.max(0, alpha))
    const p0 = prev.proctor
    const p1 = cur.proctor

    // 답안지는 표시가 바뀔 때만 다시 그린다.
    let dirty = cur.q !== lastQ
    for (let i = 0; i < N_Q; i++) if (cur.marks[i] !== lastMarks[i]) dirty = true
    if (dirty && sheetCtx) {
      for (let i = 0; i < N_Q; i++) lastMarks[i] = cur.marks[i]
      lastQ = cur.q
      drawSheet(sheetCtx, cur.marks, cur.q)
      sheetTex.needsUpdate = true
    }

    // 휴대폰 빛
    const phoneTarget = cur.tool === 3 ? 1 : 0
    phoneOn += (phoneTarget - phoneOn) * (1 - Math.exp(-dt * 12))
    if (dt === 0) phoneOn = phoneTarget
    const flicker = 0.92 + 0.08 * Math.sin(nowMs * 0.011)
    phoneLight.intensity = PHONE_LIGHT * phoneOn * flicker
    glowMat.opacity = phoneOn * flicker * GLOW_OPACITY
    lapGlow.visible = phoneOn > 0.01

    // 손에 든 휴대폰: 켜면 올라오고, 숨기는 중에는 내려간다.
    const upTarget = cur.tool === 3 && cur.stow === 0 ? 1 : 0
    phoneUp += (upTarget - phoneUp) * (1 - Math.exp(-dt * PH_RATE))
    if (dt === 0) phoneUp = upTarget
    phoneRig.visible = phoneUp > 0.01
    if (phoneRig.visible) {
      const e = phoneUp * phoneUp * (3 - 2 * phoneUp)
      phoneRig.position.set(phShownX, phHiddenY + (phShownY - phHiddenY) * e + Math.sin(nowMs * 0.004) * 0.002, -PH_D)
      phoneRig.rotation.z = -0.1 + (1 - e) * 0.3
      const p = cur.prog[cur.q]
      const done = p >= PROG_MAX
      const ans = done && answers ? answers[cur.q] : -1
      const pct = Math.floor((p * 20) / PROG_MAX) * 5 // 5% 단위로만 다시 그린다
      const key = cur.q * 1000 + (done ? 200 + ans : pct)
      if (key !== phoneKey && phoneCtx) {
        phoneKey = key
        drawPhone(phoneCtx, cur.q, done ? 100 : pct, ans)
        phoneTex.needsUpdate = true
      }
    }

    // 감독관 위치·방향
    const turnT = dt === 0 ? 1 : 1 - Math.exp(-dt * TURN_RATE)
    let walking = p1.mode === 'walk'
    let lean = 0
    if (cur.end === 'caught') {
      if (caughtAt < 0) {
        caughtAt = nowMs
        caughtFromX = shownX
        caughtFromZ = shownZ
        caughtFromYaw = yaw
      }
      const t = Math.min(1, (nowMs - caughtAt) / CAUGHT_MS)
      const e = 1 - (1 - t) * (1 - t) * (1 - t)
      shownX = caughtFromX + (CAM.x * M - caughtFromX) * e
      shownZ = caughtFromZ + (-CAM.z * M - CAUGHT_DIST - caughtFromZ) * e
      yaw = turnToward(caughtFromYaw, 0, e)
      walking = t < 1
      lean = 0.15 * e
      nod += (0.35 * e - nod) * turnT // 나를 내려다본다
      camera.rotation.x = PITCH + (CAUGHT_PITCH - PITCH) * e
    } else {
      if (caughtAt >= 0) camera.rotation.x = PITCH
      caughtAt = -1
      shownX = (p0.x + (p1.x - p0.x) * a) * M
      shownZ = -(p0.z + (p1.z - p0.z) * a) * M
      yaw = turnToward(yaw, FACE_YAW[p1.face], turnT)
      nod += ((p1.dozing ? DOZE_NOD : 0) - nod) * turnT * 0.5
      slump += ((p1.dozing ? DOZE_SLUMP : 0) - slump) * turnT * 0.5
      lean = slump
    }
    rig.root.position.set(shownX, 0, shownZ)
    rig.root.rotation.y = yaw
    rig.body.rotation.x = lean

    swingAmp += ((walking ? SWING : 0) - swingAmp) * (dt === 0 ? 1 : 1 - Math.exp(-dt * 8))
    const ph = Math.sin((nowMs / 1000) * Math.PI * 2 * STEP_HZ)
    rig.legL.rotation.x = ph * swingAmp
    rig.legR.rotation.x = -ph * swingAmp
    rig.armL.rotation.x = -ph * swingAmp * 0.6
    rig.armR.rotation.x = ph * swingAmp * 0.6
    rig.body.position.y = Math.abs(ph) * swingAmp * 0.03
    rig.head.rotation.x = nod

    renderer.render(scene, camera)
  }

  function resize(w: number, h: number, dpr: number): void {
    if (w <= 0 || h <= 0) return
    renderer.setPixelRatio(Math.min(dpr || 1, MAX_DPR))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    placeGlow(camera.aspect)
    placePhone(camera.aspect)
  }

  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
    for (const t of textures) t.dispose()
    renderer.dispose()
  }

  return { render, resize, setAnswers, dispose }
}
