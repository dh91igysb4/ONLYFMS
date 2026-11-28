// 코스 데이터 형식 (레이싱 설계 §5.4). 순수 데이터, 외부 의존 없음.
// 좌표: y가 위. 차는 로컬 +z가 앞. 방향 yaw는 앞 벡터 (sin yaw, 0, cos yaw).

export type Vec3 = { x: number; y: number; z: number }

/** 정적 상자: 점프대(기울인 상자), 착지대, 지름길(코스를 벗어나 건너뛰는 점프대·착지대) */
export type CourseBox = {
  kind: 'ramp' | 'platform' | 'shortcut'
  center: Vec3
  half: Vec3
  /** 적용 순서: yaw(y축) → pitch(x축) → roll(z축), 상자 로컬 기준 */
  rot: { pitch: number; yaw: number; roll: number }
}

export type Course = {
  id: string
  /** 출발 → 도착 중심선, 2~6m 간격 */
  centerline: Vec3[]
  /** 점마다 도로 폭 (m) */
  width: number[]
  /** 점마다 롤(rad). 곡선 기울기 */
  bank: number[]
  boxes: CourseBox[]
  /** 체크포인트 중심선 인덱스, 오름차순, 첫 값은 0(출발) */
  checkpoints: number[]
  /** 도착선 중심선 인덱스 */
  finish: number
  start: { pos: Vec3; yaw: number }
  /** 벽이 없는 중심선 인덱스 구간 [from, to] (지름길 출입구) */
  openWalls?: [number, number][]
}
