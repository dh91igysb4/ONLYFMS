// 움직이는 길(올라타는 길). 설계 §6.1~§6.2. 정수만.
// 선분을 기준점 (pivotX, pivotY) 둘레로 자세 각도만큼 돌리고 (dx, dy)만큼 옮긴다.
// time 길의 시각은 판의 부분 틱 T, touch·pass 길은 T0(밟힌·넘은 시각, 아직이면 null)부터 센다.
import type { Box } from './collide.ts'
import { applyPose, maxReach, poseAt, type Motion } from './motion.ts'
import type { Seg } from './pieces.ts'
import { isqrt } from './trig.ts'

/** delay: 틱. pass.x는 템플릿 좌표(코스가 월드로 옮긴다). */
export type MoverStart = { k: 'time' } | { k: 'touch'; delay: number } | { k: 'pass'; x: number; delay: number }
export type MoverLook = 'yellow' | 'green'
export type MoverDef = { segs: readonly Seg[]; pivotX: number; pivotY: number; motion: Motion; start: MoverStart; look: MoverLook }
export type Mover = MoverDef & { id: number } // 월드 좌표

/** 시각 T(부분 틱)의 월드 선분. */
export function moverSegsAt(m: Mover, T: number, T0: number | null): Seg[] {
  const p = poseAt(m.motion, T, T0)
  return m.segs.map((s) => {
    const a = applyPose(p, m.pivotX, m.pivotY, s.x0, s.y0)
    const b = applyPose(p, m.pivotX, m.pivotY, s.x1, s.y1)
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y, boost: s.boost }
  })
}

/** 움직임 전체를 덮는 상자. 도는 길은 기준점 ± (가장 먼 끝점 거리 + 2), fall은 아래로 FALL_DEPTH까지. */
export function moverBox(m: Mover): Box {
  const r = maxReach(m.motion)
  let b: Box
  if (r.turns) {
    let d2 = 0
    for (const s of m.segs) {
      for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y1]]) d2 = Math.max(d2, (x - m.pivotX) * (x - m.pivotX) + (y - m.pivotY) * (y - m.pivotY))
    }
    const L = isqrt(d2) + 2 // + 2: isqrt 내림과 applyPose 내림 여유
    b = { x0: m.pivotX - L, y0: m.pivotY - L, x1: m.pivotX + L, y1: m.pivotY + L }
  } else {
    b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    for (const s of m.segs) {
      b = {
        x0: Math.min(b.x0, s.x0, s.x1),
        y0: Math.min(b.y0, s.y0, s.y1),
        x1: Math.max(b.x1, s.x0, s.x1),
        y1: Math.max(b.y1, s.y0, s.y1),
      }
    }
  }
  return { x0: b.x0 + r.dx0, y0: b.y0 + r.dy0, x1: b.x1 + r.dx1, y1: b.y1 + r.dy1 }
}
