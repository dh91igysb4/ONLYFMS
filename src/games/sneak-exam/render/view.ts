// 몰래 수능 화면 계산(순수, three 없음). 길이는 시뮬과 같은 mm.
import { ME_X, ME_Z } from '../constants.ts'

// 카메라: 내 자리 눈높이에서 칠판(+z) 쪽을 본다. fovY는 세로 시야각(도).
export const CAM = { x: ME_X, y: 1150, z: ME_Z, fovY: 60 } as const

const TAN_HALF = Math.tan((CAM.fovY * Math.PI) / 360)

// (x, z)가 화면 가로 시야 밖이면 그쪽(-1 왼쪽, 1 오른쪽), 안이면 0. 화면 오른쪽 = +x.
// 카메라와 거의 같은 줄(dz ≤ 200)이면 늘 옆으로 본다(dx = 0이면 왼쪽).
export function offscreenSide(x: number, z: number, aspect: number): -1 | 0 | 1 {
  const dx = x - CAM.x
  const dz = z - CAM.z
  if (dz <= 200) return dx > 0 ? 1 : -1
  if (Math.abs(dx) > dz * TAN_HALF * aspect) return dx > 0 ? 1 : -1
  return 0
}
