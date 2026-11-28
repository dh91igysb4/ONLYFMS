// 키보드 → 차 조작 (레이싱 설계 §5.5). 순수 함수. KeyboardEvent.code 기준.
// 방향키·WASD로 가속·브레이크·조향, Shift 니트로. 드리프트는 없다(2026-11-28 사용자 변경).
// 공중에서는 A/D(←/→)가 차 방향, W/S(↑/↓)가 앞뒤 기울기다(W = 앞이 아래로). 조향은 0.
// 기울기는 공중에 뜬 뒤 새로 누른 W/S(airKeys)만 센다. 가속하려고 땅에서부터 누르고 있던 W로 앞이 처박히지 않게.
// Space는 페이지 스크롤만 막는다. R(복귀)·Escape(나가기)는 화면이 따로 처리한다.
import { NO_CONTROLS, type Controls } from './physics/controls.ts'

const UP = ['ArrowUp', 'KeyW']
const DOWN = ['ArrowDown', 'KeyS']
const LEFT = ['ArrowLeft', 'KeyA']
const RIGHT = ['ArrowRight', 'KeyD']
const NITRO = ['ShiftLeft', 'ShiftRight']

export const GAME_KEYS: ReadonlySet<string> = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, ...NITRO, 'Space'])

export function controlsFrom(down: ReadonlySet<string>, airborne = false, airKeys: ReadonlySet<string> = down): Controls {
  const any = (ks: string[]) => ks.some((k) => down.has(k))
  const fresh = (ks: string[]) => ks.some((k) => down.has(k) && airKeys.has(k))
  const up = any(UP) ? 1 : 0
  const back = any(DOWN) ? 1 : 0
  const lr = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0)
  return {
    ...NO_CONTROLS,
    throttle: up,
    brake: back,
    steer: airborne ? 0 : lr,
    nitro: any(NITRO),
    pitch: airborne ? (fresh(UP) ? 1 : 0) - (fresh(DOWN) ? 1 : 0) : 0,
    yaw: airborne ? lr : 0,
  }
}
