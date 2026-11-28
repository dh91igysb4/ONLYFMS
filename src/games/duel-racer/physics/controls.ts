// 차 조작 입력 한 틱 분량. 키보드 배치는 input.ts가 만든다.
export type Controls = {
  /** 0..1 */
  throttle: number
  /** 0..1 */
  brake: number
  /** -1(왼쪽)..1(오른쪽) */
  steer: number
  nitro: boolean
}

export const NO_CONTROLS: Controls = { throttle: 0, brake: 0, steer: 0, nitro: false }
