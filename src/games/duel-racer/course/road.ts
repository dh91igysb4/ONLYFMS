// 중심선으로 도로 면·양쪽 벽 삼각형을 만든다. 물리(트라이메시)와 렌더가 함께 쓴다. 순수 함수.
import type { Course, Vec3 } from './types.ts'

export const WALL_HEIGHT = 1.2

export type Mesh = { positions: Float32Array; indices: Uint32Array }

/** 점 i의 수평 진행 방향(단위) */
export function tangentAt(c: Course, i: number): Vec3 {
  const n = c.centerline.length
  const a = c.centerline[Math.max(0, i - 1)]
  const b = c.centerline[Math.min(n - 1, i + 1)]
  const dx = b.x - a.x
  const dz = b.z - a.z
  const l = Math.hypot(dx, dz) || 1
  return { x: dx / l, y: 0, z: dz / l }
}

/** 점 i의 옆 방향(up × tangent, 롤 적용). 도로 왼쪽 가장자리 = p + side·w/2 */
export function sideAt(c: Course, i: number): Vec3 {
  const t = tangentAt(c, i)
  const r = c.bank[i] ?? 0
  // up × t = (t.z, 0, -t.x). 롤은 t축으로 돌린다.
  const sx = t.z
  const sz = -t.x
  return { x: sx * Math.cos(r), y: Math.sin(r), z: sz * Math.cos(r) }
}

function isOpen(c: Course, i: number): boolean {
  return (c.openWalls ?? []).some(([a, b]) => i >= a && i <= b)
}

export function buildRoad(c: Course): Mesh & { walls: Mesh } {
  const n = c.centerline.length
  const positions = new Float32Array(n * 2 * 3)
  const edges: [Vec3, Vec3][] = []
  for (let i = 0; i < n; i++) {
    const p = c.centerline[i]
    const s = sideAt(c, i)
    const h = c.width[i] / 2
    const L = { x: p.x + s.x * h, y: p.y + s.y * h, z: p.z + s.z * h }
    const R = { x: p.x - s.x * h, y: p.y - s.y * h, z: p.z - s.z * h }
    positions.set([L.x, L.y, L.z, R.x, R.y, R.z], i * 6)
    edges.push([L, R])
  }
  const indices = new Uint32Array((n - 1) * 6)
  for (let i = 0; i < n - 1; i++) {
    const l0 = i * 2
    const r0 = l0 + 1
    const l1 = l0 + 2
    const r1 = l0 + 3
    // (L_i, R_i, L_i+1), (R_i, R_i+1, L_i+1): 법선이 위
    indices.set([l0, r0, l1, r0, r1, l1], i * 6)
  }
  // 벽: 가장자리마다 세로 띠. 열린 구간은 건너뛴다.
  const wp: number[] = []
  const wi: number[] = []
  for (const side of [0, 1] as const) {
    for (let i = 0; i < n - 1; i++) {
      if (isOpen(c, i) || isOpen(c, i + 1)) continue
      const a = edges[i][side]
      const b = edges[i + 1][side]
      const k = wp.length / 3
      wp.push(a.x, a.y, a.z, b.x, b.y, b.z, a.x, a.y + WALL_HEIGHT, a.z, b.x, b.y + WALL_HEIGHT, b.z)
      wi.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  return { positions, indices, walls: { positions: new Float32Array(wp), indices: new Uint32Array(wi) } }
}
