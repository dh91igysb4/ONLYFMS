// 장면 배치 계산(설계 §6.2). three를 쓰지 않는 순수 함수. 길이는 mm.
import { BLOCK_H, COL_MAX, COL_MIN, ROW, X_LIMIT } from '../constants.ts'
import { decorRandom } from '../course.ts'
import type { Course, SegmentInfo } from '../course.ts'

// cx·cy·cz는 상자 중심. 바닥 상자의 slope = h1 - h0이고, cy는 칸 가운데 바닥 높이에서 두께 절반 아래.
export type Box = { kind: 'floor' | 'block'; cx: number; cy: number; cz: number; w: number; h: number; d: number; slope: number }
// 건물 바닥 높이는 장면이 조각 base 기준으로 정한다(h는 그 기준 위 높이).
export type Building = { cx: number; cz: number; w: number; d: number; h: number }

export const FLOOR_T = 200

// 칸마다 상자 하나(인접 칸 병합 없음). 구멍은 상자가 없다.
export function segmentBoxes(course: Course, info: SegmentInfo): Box[] {
  const out: Box[] = []
  for (let row = info.startRow; row < info.startRow + info.length; row++) {
    const cz = row * ROW + ROW / 2
    for (let col = COL_MIN; col <= COL_MAX; col++) {
      const c = course.cell(col, row)
      if (c.floor === null) continue
      const { h0, h1 } = c.floor
      const cx = col * 1000
      out.push({ kind: 'floor', cx, cy: (h0 + h1) / 2 - FLOOR_T / 2, cz, w: 1000, h: FLOOR_T, d: ROW, slope: h1 - h0 })
      if (c.block) out.push({ kind: 'block', cx, cy: Math.max(h0, h1) + BLOCK_H / 2, cz, w: 1000, h: BLOCK_H, d: ROW, slope: 0 })
    }
  }
  return out
}

// 건물은 z를 LOT 길이 구획으로 나눠 구획마다 양옆에 하나씩 둔다. 구획마다 난수를 같은 개수만 뽑으므로
// 어느 범위로 나눠 불러도 결과가 같고, 구획 중심(cz)이 속한 범위에서만 돌려줘 겹치지 않는다.
const LOT = 7000
const MIN_GAP = X_LIMIT + 2500 // 트랙 끝에서 건물 안쪽 면까지 최소 거리(X_LIMIT + 1000보다 넓게)

export function buildingsFor(seed: string, fromRow: number, toRow: number): Building[] {
  const fromZ = fromRow * ROW
  const toZ = toRow * ROW
  const out: Building[] = []
  if (toZ <= fromZ) return out
  const next = decorRandom(seed)
  for (let k = 0; k * LOT + LOT / 2 < toZ; k++) {
    const cz = k * LOT + LOT / 2
    for (const side of [-1, 1]) {
      const w = 4000 + (next() % 6000)
      const d = 3500 + (next() % (LOT - 4000))
      const h = 12000 + (next() % 40000)
      const gap = MIN_GAP + (next() % 5000)
      if (cz < fromZ) continue
      out.push({ cx: side * (gap + w / 2), cz, w, d, h })
    }
  }
  return out
}
