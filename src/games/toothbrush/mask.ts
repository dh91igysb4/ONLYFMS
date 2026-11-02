// 닦을 수 있는 칸 형상 (설계 §3.2). 구역마다 닦을 수 있는 면(치아, 혀 구역은 혀 표면)을
// 논리 좌표(480 × 320) 위 정수 도형 목록으로 정의한다. 칸 (c, r)은 칸 중심 (10c + 5, 10r + 5)가 어떤 도형 안에 있으면
// (그리고 구역의 inside 타원 모두 안, outside 타원 모두 밖이면) 닦을 수 있는 칸이다. 구역 종류와 상관없이 같은 규칙이다.
// 판정은 정수 곱셈·비교뿐이다(sqrt·초월함수 없음, 결정론). 이름의 'tooth'는 v1부터 쓰던 이름으로, 혀 칸도 포함한다.
// 그림(draw.ts)은 같은 도형 정의를 캔버스 경로로 그린다. 판정에 안 쓰는 그림 전용 도형(입·혀·치열 윤곽, 장식 치아)도 여기 둔다.
import { CELL, H, W, ZONE_COUNT } from './constants.ts'

/** 축 벡터의 기준 길이. 축 (ax, ay)는 길이가 약 AXIS인 정수 벡터다. */
export const AXIS = 64

/** 도형 종류(그림용): 앞니, 송곳니, 작은어금니, 큰어금니, 혀 */
export const KIND_INCISOR = 0
export const KIND_CANINE = 1
export const KIND_PREMOLAR = 2
export const KIND_MOLAR = 3
export const KIND_TONGUE = 4

/**
 * 둥근 상자 도형(치아·혀) [종류, cx, cy, ax, ay, hw, hh, rg, re].
 * 중심 (cx, cy)에서 오프셋 (X, Y)를 축 좌표 u = ay·X − ax·Y, v = ax·X + ay·Y로 바꾼다
 * (둘 다 AXIS배 근처로 늘어난 값). |u| ≤ hw·AXIS, |v| ≤ hh·AXIS인 상자에서 모서리를 둥글린다.
 * 모서리 반지름은 v < 0 쪽(잇몸 쪽)이 rg, v ≥ 0 쪽(씹는 끝 쪽)이 re.
 */
export type Box = readonly [kind: number, cx: number, cy: number, ax: number, ay: number, hw: number, hh: number, rg: number, re: number]
/** 축 정렬 타원 [cx, cy, rx, ry] */
export type Ellipse = readonly [cx: number, cy: number, rx: number, ry: number]
export type ZoneShape = {
  /** 닦을 수 있는 도형: 치아, 혀 구역(3)은 혀 하나 (번호 = 목록 순서) */
  teeth: readonly Box[]
  /** 닦을 수 있는 칸은 이 타원들 모두의 안이어야 한다 (입술 안쪽) */
  inside: readonly Ellipse[]
  /** 닦을 수 있는 칸은 이 타원들 모두의 밖이어야 한다 (혀에 가린 부분) */
  outside: readonly Ellipse[]
  /** 그림 전용(판정 안 씀): 씹는 면 구역(2·5)의 치열 타원 */
  arch?: Ellipse
  /** 그림 전용: 판정과 상관없는 혀 타원 (1 아래쪽 혀끝, 5 U 안쪽 혀) */
  tongue?: Ellipse
  /** 그림 전용: 벌린 입 구멍(두 타원의 교집합). 바깥 구역(0)은 inside가 곧 입 구멍이다 */
  mouth?: readonly Ellipse[]
  /** 그림 전용: 장식 치아 (혀 구역의 윗니·아랫니 끝) */
  decor?: readonly Box[]
}

export const ZONE_SHAPES: readonly ZoneShape[] = [
  // 0 바깥: 다문 정면 (위 치아 먼저, 아래 치아 뒤)
  {
    teeth: [
      [2, -17, 119, 23, 60, 21, 46, 21, 14],
      [2, 26, 109, 20, 61, 23, 51, 23, 16],
      [1, 77, 104, 15, 62, 28, 60, 28, 22],
      [0, 133, 93, 10, 63, 31, 56, 31, 7],
      [0, 201, 90, 4, 64, 40, 65, 40, 7],
      [0, 279, 90, -4, 64, 40, 65, 40, 7],
      [0, 347, 93, -10, 63, 31, 56, 31, 7],
      [1, 403, 104, -15, 62, 28, 60, 28, 22],
      [2, 454, 109, -20, 61, 23, 51, 23, 16],
      [2, 497, 119, -23, 60, 21, 46, 21, 14],
      [2, 9, 173, 21, -61, 23, 47, 23, 14],
      [2, 56, 183, 17, -62, 25, 52, 25, 16],
      [1, 109, 188, 13, -63, 29, 59, 29, 20],
      [0, 163, 199, 7, -64, 27, 56, 27, 7],
      [0, 214, 201, 3, -64, 26, 58, 26, 7],
      [0, 266, 201, -3, -64, 26, 58, 26, 7],
      [0, 317, 199, -7, -64, 27, 56, 27, 7],
      [1, 371, 188, -13, -63, 29, 59, 29, 20],
      [2, 424, 183, -17, -62, 25, 52, 25, 16],
      [2, 471, 173, -21, -61, 23, 47, 23, 14],
    ],
    inside: [[240, 412, 380, 390], [240, -92, 380, 390]],
    outside: [],
  },
  // 1
  {
    teeth: [
      [2, -5, 149, -35, 54, 35, 52, 35, 20],
      [1, 59, 193, -27, 58, 32, 59, 32, 20],
      [0, 129, 215, -18, 62, 29, 55, 29, 8],
      [0, 200, 234, -6, 64, 31, 60, 31, 8],
      [0, 280, 234, 6, 64, 31, 60, 31, 8],
      [0, 351, 215, 18, 62, 29, 55, 29, 8],
      [1, 421, 193, 27, 58, 32, 59, 32, 20],
      [2, 485, 149, 35, 54, 35, 52, 35, 20],
    ],
    inside: [],
    outside: [],
    tongue: [240, 370, 190, 64],
  },
  // 2
  {
    teeth: [
      [3, 47, 282, -64, -7, 42, 50, 24, 24],
      [2, 61, 212, -61, -18, 28, 43, 22, 22],
      [2, 82, 158, -57, -28, 28, 42, 22, 22],
      [1, 112, 108, -50, -39, 28, 30, 24, 24],
      [0, 153, 69, -38, -51, 27, 20, 14, 14],
      [0, 207, 42, -16, -62, 32, 22, 15, 15],
      [0, 273, 42, 16, -62, 32, 22, 15, 15],
      [0, 327, 69, 38, -51, 27, 20, 14, 14],
      [1, 368, 108, 50, -39, 28, 30, 24, 24],
      [2, 398, 158, 57, -28, 28, 42, 22, 22],
      [2, 419, 212, 61, -18, 28, 43, 22, 22],
      [3, 433, 282, 64, -7, 42, 50, 24, 24],
    ],
    inside: [],
    outside: [],
    arch: [240, 330, 196, 292],
  },
  // 3 혀: 내민 혀를 위에서 본 모습. 닦을 수 있는 칸은 혀 표면, 입술·입·치아 끝은 그림 전용
  {
    teeth: [[4, 240, 190, 0, 64, 130, 118, 0, 0]],
    inside: [[240, 168, 124, 140]],
    outside: [],
    mouth: [[240, 318, 300, 300], [240, -75, 300, 300]],
    decor: [
      [1, 100, 70, 12, 63, 22, 22, 22, 18],
      [0, 154, 48, 6, 64, 24, 22, 22, 7],
      [0, 210, 40, 1, 64, 29, 30, 29, 7],
      [0, 270, 40, -1, 64, 29, 30, 29, 7],
      [0, 326, 48, -6, 64, 24, 22, 22, 7],
      [1, 380, 70, -12, 63, 22, 22, 22, 18],
      [2, 52, 150, 16, -62, 20, 22, 20, 14],
      [1, 96, 172, 10, -63, 20, 24, 20, 16],
      [0, 132, 178, 4, -64, 18, 24, 18, 7],
      [0, 348, 178, -4, -64, 18, 24, 18, 7],
      [1, 384, 172, -10, -63, 20, 24, 20, 16],
      [2, 428, 150, -16, -62, 20, 22, 20, 14],
    ],
  },
  // 4
  {
    teeth: [
      [2, 1, 172, -34, -54, 35, 51, 35, 20],
      [1, 66, 128, -26, -58, 32, 59, 32, 20],
      [0, 135, 106, -17, -62, 29, 56, 29, 8],
      [0, 204, 94, -6, -64, 28, 56, 28, 8],
      [0, 276, 94, 6, -64, 28, 56, 28, 8],
      [0, 345, 106, 17, -62, 29, 56, 29, 8],
      [1, 414, 128, 26, -58, 32, 59, 32, 20],
      [2, 479, 172, 34, -54, 35, 51, 35, 20],
    ],
    inside: [],
    outside: [[240, 334, 165, 100]],
  },
  // 5
  {
    teeth: [
      [3, 44, -26, -64, -2, 38, 47, 24, 24],
      [3, 49, 56, -63, 10, 42, 49, 24, 24],
      [2, 67, 126, -60, 21, 29, 40, 22, 22],
      [2, 91, 180, -55, 32, 28, 38, 22, 22],
      [1, 125, 227, -47, 44, 28, 29, 24, 24],
      [0, 168, 261, -33, 55, 25, 21, 13, 13],
      [0, 215, 280, -12, 63, 24, 21, 13, 13],
      [0, 265, 280, 12, 63, 24, 21, 13, 13],
      [0, 312, 261, 33, 55, 25, 21, 13, 13],
      [1, 355, 227, 47, 44, 28, 29, 24, 24],
      [2, 389, 180, 55, 32, 28, 38, 22, 22],
      [2, 413, 126, 60, 21, 29, 40, 22, 22],
      [3, 431, 56, 63, 10, 42, 49, 24, 24],
      [3, 436, -26, 64, -2, 38, 47, 24, 24],
    ],
    inside: [],
    outside: [],
    arch: [240, -10, 196, 292],
    tongue: [240, -20, 130, 226],
  },
]

export function inBox(b: Box, x: number, y: number): boolean {
  const [, cx, cy, ax, ay, hw, hh, rg, re] = b
  const X = x - cx, Y = y - cy
  const u = ay * X - ax * Y
  const v = ax * X + ay * Y
  const U = u < 0 ? -u : u
  const V = v < 0 ? -v : v
  const HW = hw * AXIS, HH = hh * AXIS
  if (U > HW || V > HH) return false
  const rr = (v < 0 ? rg : re) * AXIS
  const qu = U - (HW - rr), qv = V - (HH - rr)
  if (qu <= 0 || qv <= 0) return true
  return qu * qu + qv * qv <= rr * rr
}

export function inEllipse(e: Ellipse, x: number, y: number): boolean {
  const [cx, cy, rx, ry] = e
  const X = x - cx, Y = y - cy
  return X * X * ry * ry + Y * Y * rx * rx <= rx * rx * ry * ry
}

/** 논리 좌표 (x, y)의 닦을 수 있는 도형 번호 (치아·혀, 아니면 -1) */
export function toothAt(zone: number, x: number, y: number): number {
  const s = ZONE_SHAPES[zone]
  for (const e of s.inside) if (!inEllipse(e, x, y)) return -1
  for (const e of s.outside) if (inEllipse(e, x, y)) return -1
  for (let t = 0; t < s.teeth.length; t++) if (inBox(s.teeth[t], x, y)) return t
  return -1
}

const CELLS: readonly (readonly number[])[] = []
const OWNER: readonly Int8Array[] = []
;(() => {
  const cells = CELLS as number[][]
  const owner = OWNER as Int8Array[]
  for (let z = 0; z < ZONE_COUNT; z++) {
    const list: number[] = []
    const own = new Int8Array(W * H).fill(-1)
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const t = toothAt(z, c * CELL + 5, r * CELL + 5)
        if (t < 0) continue
        const i = r * W + c
        list.push(i)
        own[i] = t
      }
    }
    cells.push(list)
    owner.push(own)
  }
})()

/** 구역의 닦을 수 있는 칸(치아·혀) 번호 목록 (행 우선 오름차순) */
export function toothCells(zone: number): readonly number[] {
  return CELLS[zone]
}

export function isTooth(zone: number, i: number): boolean {
  return OWNER[zone][i] >= 0
}

export function toothOf(zone: number, i: number): number {
  const o = OWNER[zone]?.[i]
  return o === undefined ? -1 : o
}
