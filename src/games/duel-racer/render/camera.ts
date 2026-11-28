// 차 뒤 추격 카메라 (레이싱 설계 §5.5). 순수 함수.
// 차의 yaw만 따라가고(공중에서 돌아도 화면은 수평), 위치는 지수 평활로 부드럽게, 빠를수록 시야각을 넓힌다.
import type { Vec3 } from '../course/types.ts'

export type CamPose = { pos: Vec3; look: Vec3; fov: number }
type Quat = { x: number; y: number; z: number; w: number }

export const CAM_BACK = 7
export const CAM_UP = 2.8
export const CAM_LOOK_AHEAD = 6
export const CAM_TAU = 0.12
export const FOV_SLOW = 65
export const FOV_FAST = 78
const FOV_SPEED = 50

/** 차 앞 방향(로컬 +z)의 수평 성분 단위 벡터. 차가 거의 수직이면 null */
function headingOf(q: Quat): { x: number; z: number } | null {
  const fx = 2 * (q.x * q.z + q.w * q.y)
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y)
  const l = Math.hypot(fx, fz)
  return l < 0.2 ? null : { x: fx / l, z: fz / l }
}

export function chaseCamera(prev: CamPose | null, car: { pos: Vec3; quat: Quat; vel: Vec3 }, dt: number): CamPose {
  const h = headingOf(car.quat) ?? (prev ? normXZ(car.pos.x - prev.pos.x, car.pos.z - prev.pos.z) : { x: 0, z: 1 })
  const target = { x: car.pos.x - h.x * CAM_BACK, y: car.pos.y + CAM_UP, z: car.pos.z - h.z * CAM_BACK }
  const look = { x: car.pos.x + h.x * CAM_LOOK_AHEAD, y: car.pos.y + 1, z: car.pos.z + h.z * CAM_LOOK_AHEAD }
  const sp = Math.hypot(car.vel.x, car.vel.z)
  const fov = FOV_SLOW + (FOV_FAST - FOV_SLOW) * Math.min(1, sp / FOV_SPEED)
  if (!prev) return { pos: target, look, fov }
  const a = 1 - Math.exp(-dt / CAM_TAU)
  return {
    pos: { x: prev.pos.x + (target.x - prev.pos.x) * a, y: prev.pos.y + (target.y - prev.pos.y) * a, z: prev.pos.z + (target.z - prev.pos.z) * a },
    look,
    fov: prev.fov + (fov - prev.fov) * a,
  }
}

function normXZ(x: number, z: number): { x: number; z: number } {
  const l = Math.hypot(x, z)
  return l < 1e-6 ? { x: 0, z: 1 } : { x: x / l, z: z / l }
}
