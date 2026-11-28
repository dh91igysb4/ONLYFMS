// 코스로 Rapier 물리 세계를 만든다: 중력, 도로·벽 트라이메시, 상자 콜라이더(점프대·착지대·지름길).
import type { World } from '@dimforge/rapier3d-compat'
import { buildRoad } from '../course/road.ts'
import type { Course } from '../course/types.ts'
import { TICK_HZ } from '../constants.ts'
import type { Rapier } from './rapier.ts'

export type PhysWorld = { R: Rapier; world: World; course: Course }

/** yaw → pitch → roll(로컬) 순서 회전의 쿼터니언 */
export function quatYPR(yaw: number, pitch: number, roll: number): { x: number; y: number; z: number; w: number } {
  const mul = (a: Q, b: Q): Q => ({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  })
  const qy: Q = { w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 }
  const qp: Q = { w: Math.cos(pitch / 2), x: Math.sin(pitch / 2), y: 0, z: 0 }
  const qr: Q = { w: Math.cos(roll / 2), x: 0, y: 0, z: Math.sin(roll / 2) }
  return mul(mul(qy, qp), qr)
}
type Q = { x: number; y: number; z: number; w: number }

export function createWorld(R: Rapier, course: Course): PhysWorld {
  const world = new R.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = 1 / TICK_HZ
  const road = buildRoad(course)
  const ground = world.createRigidBody(R.RigidBodyDesc.fixed())
  // 삼각형 사이 이음매에서 법선이 튀어 차가 튕겨 나가지 않게 FIX_INTERNAL_EDGES(겹친 꼭짓점 합치기 포함)
  const flags = R.TriMeshFlags.FIX_INTERNAL_EDGES
  world.createCollider(R.ColliderDesc.trimesh(road.positions, road.indices, flags).setFriction(0.9), ground)
  if (road.walls.indices.length > 0) {
    world.createCollider(R.ColliderDesc.trimesh(road.walls.positions, road.walls.indices, flags).setFriction(0.05).setRestitution(0.3), ground)
  }
  for (const b of course.boxes) {
    const q = quatYPR(b.rot.yaw, b.rot.pitch, b.rot.roll)
    world.createCollider(
      R.ColliderDesc.cuboid(b.half.x, b.half.y, b.half.z).setTranslation(b.center.x, b.center.y, b.center.z).setRotation(q).setFriction(0.9),
      ground,
    )
  }
  return { R, world, course }
}
