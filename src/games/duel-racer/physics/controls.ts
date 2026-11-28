// 차 조작 입력 한 틱 분량. 키보드 배치는 input.ts가 만든다.
export type Controls = {
  /** 0..1 */
  throttle: number
  /** 0..1 */
  brake: number
  /** -1(왼쪽)..1(오른쪽) */
  steer: number
  handbrake: boolean
  nitro: boolean
  /** 공중 회전 -1..1. pitch +1 = 앞이 아래로(앞구르기), roll +1 = 오른쪽으로, yaw +1 = 오른쪽으로 */
  pitch: number
  roll: number
  yaw: number
}

export const NO_CONTROLS: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, pitch: 0, roll: 0, yaw: 0 }
