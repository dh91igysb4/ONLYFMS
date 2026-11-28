// 니트로 게이지 (레이싱 설계 §5.3, 2026-11-28 사용자 변경). 순수 함수.
// 누르는 동안 일정 속도로 줄고 분사한다. 마지막으로 쓴 뒤(출발 포함) NITRO_REGEN_DELAY초가 지나면 자동으로 조금씩 찬다.
import { NITRO_BURN_PER_SEC, NITRO_REGEN_DELAY, NITRO_REGEN_PER_SEC } from './constants.ts'

/** idle: 마지막으로 쓴(또는 누른) 뒤 지난 시간 (s) */
export type Nitro = { gauge: number; burning: boolean; idle: number }

export const NITRO_START: Nitro = { gauge: 0, burning: false, idle: 0 }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export function stepNitro(n: Nitro, want: boolean, dt: number): Nitro {
  if (want) {
    // 누르고 있으면 충전 대기가 다시 시작된다(빈 게이지로 누르고 있어도)
    const g = clamp01(n.gauge - NITRO_BURN_PER_SEC * dt)
    return { gauge: g, burning: n.gauge > 0 && g > 0, idle: 0 }
  }
  const idle = n.idle + dt
  const g = idle >= NITRO_REGEN_DELAY ? clamp01(n.gauge + NITRO_REGEN_PER_SEC * dt) : n.gauge
  return { gauge: g, burning: false, idle }
}
