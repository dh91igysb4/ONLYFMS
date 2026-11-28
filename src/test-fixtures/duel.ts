// 테스트 전용: 숨김 대전 게임(hidden-duel). 요트 로직·화면을 빌려 쓴다.
// 쓰는 쪽:
//   vi.mock('<…>/games/index.ts', async (orig) =>
//     (await import('<…>/test-fixtures/duel.ts')).withHiddenDuel(await orig()))
import type { DuelLogic, DuelModule } from '../games/types.ts'

export const HIDDEN_DUEL_ID = 'hidden-duel'

export function hiddenDuelOf(base: DuelModule): DuelModule {
  return { ...base, manifest: { ...base.manifest, id: HIDDEN_DUEL_ID, name: '숨김 대전', hidden: true } }
}

export function withHiddenDuel<R extends { duels: DuelModule[]; getDuel(id: string): DuelModule | undefined }>(real: R): R {
  const hidden = hiddenDuelOf(real.duels[0])
  const duels = [...real.duels, hidden]
  return { ...real, duels, getDuel: (id: string) => (id === HIDDEN_DUEL_ID ? hidden : real.getDuel(id)) }
}

// 테스트 전용: 숨김 실시간 대전(realtime-duel). 첫 대전 게임의 manifest를 빌려 실시간으로 바꾸고,
// 로직은 보고 판정만 하는 테스트용: 각 좌석이 기록 { my: 틱 | null(미완주) }을 한 번 보고, 짧은 기록 승.
// payload.mismatch === true거나 둘 다 미완주면 무효. r[seat] === null은 아직 보고 안 함(JSON이라 undefined를 쓰지 않는다).
export const REALTIME_DUEL_ID = 'realtime-duel'
export const REALTIME_MATCH_SECONDS = 245
export const REALTIME_START_DELAY_SEC = 5

type RtState = { r: ({ my: number | null } | null)[]; mismatch: boolean }
const rtLogic: DuelLogic<RtState, unknown, RtState> = {
  version: 1,
  init: () => ({ r: [null, null], mismatch: false }),
  toMove: () => 0,
  apply: () => ({ error: 'realtime_only' }),
  timeoutAction: () => ({}),
  turnNo: (s) => s.r.filter((x) => x !== null).length,
  report(s, seat, p) {
    if (s.r[seat] !== null) return { error: 'already_reported' }
    const q = p as { my?: unknown; mismatch?: unknown }
    if (q.my !== null && typeof q.my !== 'number') return { error: 'bad_report' }
    const r = [...s.r]
    r[seat] = { my: q.my }
    return { state: { r, mismatch: s.mismatch || q.mismatch === true } }
  },
  reportTimeout: () => ({ my: null }),
  result(s) {
    const [a, b] = s.r
    if (a === null || b === null) return { over: false }
    if (s.mismatch || (a.my === null && b.my === null)) return { over: true, winner: null, void: true }
    const x = a.my ?? Infinity
    const y = b.my ?? Infinity
    return { over: true, winner: x < y ? 0 : y < x ? 1 : null, scores: [a.my ?? 0, b.my ?? 0] }
  },
  view: (s) => s,
}

export function realtimeDuelOf(base: DuelModule): DuelModule {
  const duel = {
    turnSeconds: { choices: [REALTIME_MATCH_SECONDS], default: REALTIME_MATCH_SECONDS },
    sameScreen: false,
    realtime: { raceSeconds: 180, startDelaySec: REALTIME_START_DELAY_SEC },
  }
  return { manifest: { ...base.manifest, id: REALTIME_DUEL_ID, name: '실시간 대전', hidden: true, options: [], duel }, logic: rtLogic }
}

export function withRealtimeDuel<R extends { duels: DuelModule[]; getDuel(id: string): DuelModule | undefined }>(real: R): R {
  const rt = realtimeDuelOf(real.duels[0])
  const duels = [...real.duels, rt]
  return { ...real, duels, getDuel: (id: string) => (id === REALTIME_DUEL_ID ? rt : real.getDuel(id)) }
}
