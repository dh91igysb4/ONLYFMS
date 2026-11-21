// 좌우 왕복 블록('M') 위치. 시뮬(충돌)과 화면이 같은 함수를 써서 어긋나지 않는다. 순수 정수 연산, 외부 의존 없음.
import { MOVER_PERIOD } from './constants.ts'

// x0 → x1(mm, 그 행 바깥 'M' 칸 가운데)로 갔다가 돌아온다. h는 큐브가 놓인 바닥 높이, phase는 틱 위상(0..MOVER_PERIOD-1).
export type Mover = { x0: number; x1: number; h: number; phase: number }

const HALF = MOVER_PERIOD / 2

// 틱 tick의 큐브 중심 x. u = (tick + phase) mod 주기, 앞 반 주기는 x0 → x1, 뒤 반 주기는 되돌아온다.
// 거리는 |x1 − x0|로 버림 계산해 부호를 붙인다(반전 조각 x0·x1 부호를 뒤집으면 정확한 거울상).
export function moverX(m: { x0: number; x1: number; phase: number }, tick: number): number {
  let u = (tick + m.phase) % MOVER_PERIOD
  if (u < 0) u += MOVER_PERIOD
  const k = u <= HALF ? u : MOVER_PERIOD - u
  const span = m.x1 - m.x0
  const d = Math.floor(((span < 0 ? -span : span) * k) / HALF)
  return span < 0 ? m.x0 - d : m.x0 + d
}
