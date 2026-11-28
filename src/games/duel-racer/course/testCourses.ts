// 테스트 전용 코스: 넓은 평지 직선, 평지 + 점프대. 운영 코스 등록부에 넣지 않는다.
import type { Course, Vec3 } from './types.ts'

function straight(length: number, width: number): Pick<Course, 'centerline' | 'width' | 'bank'> {
  const centerline: Vec3[] = []
  for (let z = 0; z <= length; z += 4) centerline.push({ x: 0, y: 0, z })
  return { centerline, width: centerline.map(() => width), bank: centerline.map(() => 0) }
}

/** 2km 직선, 폭 200m(드리프트·전복 시험용), 벽 없음, 300m마다 체크포인트 */
export function flatCourse(length = 2000): Course {
  const s = straight(length, 200)
  const n = s.centerline.length
  const checkpoints = []
  for (let i = 0; i < n - 1; i += 75) checkpoints.push(i)
  return {
    id: 'test-flat',
    ...s,
    boxes: [],
    checkpoints,
    finish: n - 1,
    start: { pos: { x: 0, y: 1.2, z: 8 }, yaw: 0 },
    openWalls: [[0, n - 1]],
  }
}

/** 1.2km 직선, 폭 20m, 400m 지점에 점프대(앞이 2m 올라감) */
export function rampCourse(): Course {
  const c = flatCourse(1200)
  const pitch = -0.21
  const half = { x: 10, y: 0.4, z: 5 }
  const lift = -(half.y * Math.cos(pitch) - half.z * Math.abs(Math.sin(pitch)))
  return {
    ...c,
    id: 'test-ramp',
    width: c.width.map(() => 20),
    boxes: [{ kind: 'ramp', center: { x: 0, y: lift, z: 400 }, half, rot: { pitch, yaw: 0, roll: 0 } }],
  }
}
