// 1대1 레이싱 대전 로직. 레이스는 브라우저에서 실시간으로 돌고, 서버는 결과 보고(report)만 판정한다(설계 §7).
// 순수 함수만, 외부 의존 없음 (Deno 호환). three·rapier·physics/·render/·net/를 import하지 않는다.
import type { DuelLogic, DuelResult, Seat } from '../types.ts'
import { COURSE_IDS, RACE_SECONDS, TICK_HZ } from './constants.ts'

/** 한 좌석의 보고. my: 내 완주 틱(미완주 null). opp: 상대가 알려 준 상대 완주 틱(모르면 null) */
export type RacerReport = { my: number | null; opp: number | null }
export type RacerState = { course: string; reports: [RacerReport | null, RacerReport | null] }

const MAX_TICKS = RACE_SECONDS * TICK_HZ
const validTicks = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_TICKS)

export const logic: DuelLogic<RacerState, never, RacerState> = {
  version: 2,
  init() {
    return { course: COURSE_IDS[0], reports: [null, null] }
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
  turnNo(state) {
    return state.reports.filter((r) => r !== null).length
  },
  report(state, seat: Seat, payload) {
    if (state.reports[seat] !== null) return { error: 'already_reported' }
    if (typeof payload !== 'object' || payload === null) return { error: 'bad_report' }
    const p = payload as { my?: unknown; opp?: unknown }
    const opp = p.opp === undefined ? null : p.opp
    if (!validTicks(p.my) || !validTicks(opp)) return { error: 'bad_report' }
    const reports: RacerState['reports'] = [...state.reports]
    reports[seat] = { my: p.my, opp }
    return { state: { ...state, reports } }
  },
  reportTimeout() {
    return { my: null, opp: null }
  },
  result(state): DuelResult {
    const [a, b] = state.reports
    if (a === null || b === null) return { over: false }
    // 서로 알려 준 기록이 내 기록과 다르면 판정할 수 없다(설계 §7). 모르는 쪽(null)은 건너뛴다
    if ((b.opp !== null && b.opp !== a.my) || (a.opp !== null && a.opp !== b.my)) {
      return { over: true, winner: null, void: true }
    }
    if (a.my === null && b.my === null) return { over: true, winner: null, void: true }
    const x = a.my ?? Infinity
    const y = b.my ?? Infinity
    return { over: true, winner: x < y ? 0 : y < x ? 1 : null, scores: [a.my ?? 0, b.my ?? 0] }
  },
  view(state) {
    return state
  },
}
