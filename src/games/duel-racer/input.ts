// 키보드 → 차 조작 (레이싱 설계 §5.5). 순수 함수. KeyboardEvent.code 기준.
// 방향키·WASD로 가속·브레이크·조향, Shift 니트로. 공중 회전·드리프트는 없다(2026-11-28 사용자 변경).
// Space는 페이지 스크롤만 막는다. R(복귀)·Escape(나가기)는 화면이 따로 처리한다.
import { NO_CONTROLS, type Controls } from './physics/controls.ts'

const UP = ['ArrowUp', 'KeyW']
const DOWN = ['ArrowDown', 'KeyS']
const LEFT = ['ArrowLeft', 'KeyA']
const RIGHT = ['ArrowRight', 'KeyD']
const NITRO = ['ShiftLeft', 'ShiftRight']

export const GAME_KEYS: ReadonlySet<string> = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, ...NITRO, 'Space'])

export function controlsFrom(down: ReadonlySet<string>): Controls {
  const any = (ks: string[]) => ks.some((k) => down.has(k))
  return {
    ...NO_CONTROLS,
    throttle: any(UP) ? 1 : 0,
    brake: any(DOWN) ? 1 : 0,
    steer: (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0),
    nitro: any(NITRO),
  }
}
