// 1대1 레이싱 대전 로직. 레이스는 브라우저에서 실시간으로 돌고, 서버는 2단계에서 결과 보고(report)만 판정한다(설계 §7).
// 2단계 전 등록용 최소 형태(Task 2에서 보고 판정으로 바뀐다).
// 순수 함수만, 외부 의존 없음 (Deno 호환). three·rapier·physics/·render/를 import하지 않는다.
import type { DuelLogic } from '../types.ts'
import { COURSE_IDS } from './constants.ts'

export type RacerState = { course: string }

export const logic: DuelLogic<RacerState, never, RacerState> = {
  version: 1,
  init() {
    return { course: COURSE_IDS[0] }
  },
  toMove() {
    return 0
  },
  apply() {
    return { error: 'realtime_only' }
  },
  timeoutAction() {
    return {} as never
  },
  turnNo() {
    return 0
  },
  result() {
    return { over: false }
  },
  view(state) {
    return state
  },
}
