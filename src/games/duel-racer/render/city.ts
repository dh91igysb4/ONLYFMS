// 네온 도시 건물 배치 (레이싱 설계 §5.4). 순수·결정적. 고가 도로 아래·옆으로 상자 건물을 세운다.
import type { Course, Vec3 } from '../course/types.ts'

export type Block = { center: Vec3; half: Vec3; glow: string }

/** 도로 가장자리에서 건물까지 최소 간격 (m) */
export const CITY_CLEARANCE = 6
const GLOWS = ['#ff2bd6', '#22e4ff', '#ffd23f', '#8a5cff', '#2bff9a']
const STEP = 8 // 중심선 몇 점마다 한 번 시도할지
const GROUND_Y = -40

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clearOfRoad(c: Course, cx: number, cz: number, hx: number, hz: number): boolean {
  for (let i = 0; i < c.centerline.length; i += 2) {
    const p = c.centerline[i]
    const dx = Math.max(0, Math.abs(p.x - cx) - hx)
    const dz = Math.max(0, Math.abs(p.z - cz) - hz)
    if (Math.hypot(dx, dz) < c.width[i] / 2 + CITY_CLEARANCE) return false
  }
  return true
}

export function cityBlocks(c: Course, seed: number): Block[] {
  const rnd = mulberry32(seed)
  const out: Block[] = []
  const n = c.centerline.length
  for (let i = 0; i < n; i += STEP) {
    const a = c.centerline[Math.max(0, i - 1)]
    const b = c.centerline[Math.min(n - 1, i + 1)]
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1
    const sx = (b.z - a.z) / tl
    const sz = -(b.x - a.x) / tl
    for (const side of [1, -1]) {
      const hx = 6 + rnd() * 10
      const hz = 6 + rnd() * 10
      const dist = c.width[i] / 2 + CITY_CLEARANCE + Math.max(hx, hz) * 1.5 + rnd() * 40
      const cx = c.centerline[i].x + sx * side * dist
      const cz = c.centerline[i].z + sz * side * dist
      const top = c.centerline[i].y - 10 + rnd() * 70
      const glow = GLOWS[Math.floor(rnd() * GLOWS.length)]
      if (!clearOfRoad(c, cx, cz, hx, hz)) continue
      const hy = (top - GROUND_Y) / 2
      out.push({ center: { x: cx, y: GROUND_Y + hy, z: cz }, half: { x: hx, y: hy, z: hz }, glow })
    }
  }
  return out
}
