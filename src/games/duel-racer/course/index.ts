// 코스 등록부와 진행도 계산. 순수 함수.
import type { Course, Vec3 } from './types.ts'
import { neon1 } from './neon1.ts'

export type { Course, CourseBox, Vec3 } from './types.ts'

const COURSES: Record<string, Course> = { 'neon-1': neon1 }

export function getCourse(id: string): Course {
  const c = COURSES[id]
  if (!c) throw new Error(`unknown course ${id}`)
  return c
}

const arcCache = new WeakMap<Course, number[]>()

/** 인덱스별 누적 거리 (m) */
export function arcLength(c: Course): number[] {
  const hit = arcCache.get(c)
  if (hit) return hit
  const s = [0]
  for (let i = 1; i < c.centerline.length; i++) {
    const a = c.centerline[i - 1]
    const b = c.centerline[i]
    s.push(s[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z))
  }
  arcCache.set(c, s)
  return s
}

const WINDOW = 40

function nearest(c: Course, pos: Vec3, from: number, to: number): { index: number; d2: number } {
  let best = from
  let bd = Infinity
  for (let i = from; i <= to; i++) {
    const p = c.centerline[i]
    const d2 = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 + (p.z - pos.z) ** 2
    if (d2 < bd) {
      bd = d2
      best = i
    }
  }
  return { index: best, d2: bd }
}

/**
 * pos에서 가장 가까운 중심선 점. hint 근처(±40점)에서 찾고, 그 점까지 거리가 그 점 도로 폭보다 멀면
 * (지름길 착지 등) 중심선 전체에서 다시 찾는다.
 */
export function progressAt(c: Course, pos: Vec3, hint: number): { index: number; s: number } {
  const n = c.centerline.length
  const h = Math.min(n - 1, Math.max(0, Math.round(hint)))
  let r = nearest(c, pos, Math.max(0, h - WINDOW), Math.min(n - 1, h + WINDOW))
  if (Math.sqrt(r.d2) > c.width[r.index]) r = nearest(c, pos, 0, n - 1)
  return { index: r.index, s: arcLength(c)[r.index] }
}
