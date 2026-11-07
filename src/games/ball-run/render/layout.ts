// 장면 배치 계산(설계 §6.2). three를 쓰지 않는 순수 함수. 길이는 mm.
import { BLOCK_H, GATE_H, COL_MAX, COL_MIN, R, ROW, X_LIMIT } from '../constants.ts'
import { decorRandom } from '../course.ts'
import type { Course, SegmentInfo } from '../course.ts'
import { floorAt } from '../sim.ts'

// cx·cy·cz는 상자 중심. 바닥 상자의 slope = h1 - h0이고, cy는 칸 가운데 바닥 높이에서 두께 절반 아래.
// bank는 기운 판(바닥 상자만). lintel은 같은 행 문 기둥(G) 둘 사이 위를 잇는 화면용 가로대(충돌 없음).
export type Box = {
  kind: 'floor' | 'block' | 'lintel'
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
// 문 기둥(blockH === GATE_H, 높은 기둥 P는 제외)은 한 행에서 왼쪽부터 둘씩 짝지어, 짝 사이 칸 위(블록 높이 ~ 낮은 기둥 꼭대기)에 가로대를 둔다.
export function segmentBoxes(course: Course, info: SegmentInfo): Box[] {
  const out: Box[] = []
  for (let row = info.startRow; row < info.startRow + info.length; row++) {
    const cz = row * ROW + ROW / 2
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
      const bottom = Math.max(a.base, b.base) + BLOCK_H
      const top = Math.min(a.top, b.top)
      if (top <= bottom) continue
      out.push({
        kind: 'lintel', cx: ((a.col + b.col) * 1000) / 2, cy: (bottom + top) / 2, cz,
        w: (b.col - a.col - 1) * 1000, h: top - bottom, d: ROW, slope: 0,
      })
    }
  }
  return out
}

// 카메라 목표 높이(mm). 눈은 공 위 CAM_UP, 시선은 공 앞 LOOK_AHEAD의 바닥 높이 + R(바닥이 없으면 공 높이)이라
// 내리막 앞에서는 아래로 숙인다. 카메라는 공 뒤 CAM_BACK에 있으므로, 급경사·단차에서 카메라와 공 사이(공의 열) 바닥이
// 더 높으면 그 바닥 기준으로 눈을 올려 판 속에 묻히거나 판 모서리에 공이 가리지 않게 한다.
export const CAM_UP = 850
export const CAM_BACK = 4200
export const LOOK_AHEAD = 6000
const EYE_PROBE = 500

export function cameraTarget(course: Course, ball: { x: number; y: number; z: number }): { eyeY: number; lookY: number } {
  let base = ball.y
  for (let dz = EYE_PROBE; dz < CAM_BACK + EYE_PROBE; dz += EYE_PROBE) {
    const f = floorAt(course, ball.x, ball.z - Math.min(dz, CAM_BACK))
    if (f !== null && f + R > base) base = f + R
  }
  const f = floorAt(course, ball.x, ball.z + LOOK_AHEAD)
  return { eyeY: base + CAM_UP, lookY: f === null ? ball.y : f + R }
}

// 기운 판은 같은 행에서 이어진 같은 방향 칸들을 한 판으로 보고 판 윗면 가운데를 축으로 BANK_ANGLE(rad) 굴려 그린다.
// 공 x에서 굴린 면이 칸 높이(시뮬 바닥)보다 얼마나 높은지(mm, 낮으면 음수). 기운 판이 아니면 0.
export const BANK_ANGLE = (20 * Math.PI) / 180

export function bankOffset(course: Course, x: number, z: number): number {
  const row = Math.floor(z / ROW)
  const col = Math.floor((x + 500) / 1000)
  const c = course.cell(col, row)
  if (c.bank === undefined || c.floor === null) return 0
  const same = (k: number): boolean => {
    const o = course.cell(k, row)
    return o.bank === c.bank && o.floor !== null && o.floor.h0 === c.floor!.h0
  }
  let lo = col
  let hi = col
  while (lo - 1 >= COL_MIN && same(lo - 1)) lo--
  while (hi + 1 <= COL_MAX && same(hi + 1)) hi++
  const pc = ((lo + hi) * 1000) / 2
  return -c.bank * (x - pc) * Math.tan(BANK_ANGLE)
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
