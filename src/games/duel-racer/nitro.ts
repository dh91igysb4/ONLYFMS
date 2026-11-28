// 니트로 게이지 (레이싱 설계 §5.3). 순수 함수.
// 쌓기: 체공 시간, 착지 때 회전 수와 깔끔한 착지, 드리프트. 쓰기: 누르는 동안 일정 속도로 줄고 분사한다.
import { NITRO_BURN_PER_SEC, NITRO_CLEAN_LANDING, NITRO_PER_AIR_SEC, NITRO_PER_DRIFT_SEC, NITRO_PER_FLIP } from './constants.ts'
import type { Landing } from './stunt.ts'

export type Nitro = { gauge: number; burning: boolean }

export const NITRO_START: Nitro = { gauge: 0.3, burning: false }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export function stepNitro(
  n: Nitro,
  e: { want: boolean; airborne: boolean; drifting: boolean; landed: Landing | null },
  dt: number,
): Nitro {
  let g = n.gauge
  if (e.airborne) g += NITRO_PER_AIR_SEC * dt
  if (e.drifting) g += NITRO_PER_DRIFT_SEC * dt
  if (e.landed) g += e.landed.flips * NITRO_PER_FLIP + (e.landed.clean ? NITRO_CLEAN_LANDING : 0)
  g = clamp01(g)
  if (e.want && g > 0) {
    g = clamp01(g - NITRO_BURN_PER_SEC * dt)
    return { gauge: g, burning: g > 0 }
  }
  return { gauge: g, burning: false }
}
