// 키보드 → 차 조작 (레이싱 설계 §5.5). 순수 함수. KeyboardEvent.code 기준.
// 지상: 방향키·WASD로 가속·브레이크·조향, Space 핸드브레이크, Shift 니트로.
// 공중: 위·아래는 앞·뒤구르기(가속은 그대로), 왼·오는 옆구르기(조향 0), Q·E는 제자리 돌기.
// R(복귀)·Escape(나가기)는 화면이 따로 처리한다.
import { NO_CONTROLS, type Controls } from './physics/controls.ts'

const UP = ['ArrowUp', 'KeyW']
const DOWN = ['ArrowDown', 'KeyS']
const LEFT = ['ArrowLeft', 'KeyA']
const RIGHT = ['ArrowRight', 'KeyD']
const NITRO = ['ShiftLeft', 'ShiftRight']

export const GAME_KEYS: ReadonlySet<string> = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, ...NITRO, 'Space', 'KeyQ', 'KeyE'])

export function controlsFrom(down: ReadonlySet<string>, airborne: boolean): Controls {
  const any = (ks: string[]) => ks.some((k) => down.has(k))
  const up = any(UP) ? 1 : 0
  const back = any(DOWN) ? 1 : 0
  const lr = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0)
  return {
    ...NO_CONTROLS,
    throttle: up,
    brake: back,
    steer: airborne ? 0 : lr,
    handbrake: down.has('Space'),
    nitro: any(NITRO),
    pitch: airborne ? up - back : 0,
    roll: airborne ? lr : 0,
    yaw: airborne ? (down.has('KeyE') ? 1 : 0) - (down.has('KeyQ') ? 1 : 0) : 0,
  }
}
