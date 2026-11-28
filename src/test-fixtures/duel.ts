// 테스트 전용: 숨김 대전 게임(hidden-duel). 요트 로직·화면을 빌려 쓴다.
// 쓰는 쪽:
//   vi.mock('<…>/games/index.ts', async (orig) =>
//     (await import('<…>/test-fixtures/duel.ts')).withHiddenDuel(await orig()))
import type { DuelModule } from '../games/types.ts'

export const HIDDEN_DUEL_ID = 'hidden-duel'

export function hiddenDuelOf(base: DuelModule): DuelModule {
  return { ...base, manifest: { ...base.manifest, id: HIDDEN_DUEL_ID, name: '숨김 대전', hidden: true } }
}

export function withHiddenDuel<R extends { duels: DuelModule[]; getDuel(id: string): DuelModule | undefined }>(real: R): R {
  const hidden = hiddenDuelOf(real.duels[0])
  const duels = [...real.duels, hidden]
  return { ...real, duels, getDuel: (id: string) => (id === HIDDEN_DUEL_ID ? hidden : real.getDuel(id)) }
}

// 테스트 전용: 숨김 실시간 대전(realtime-duel). 첫 대전 게임을 빌려 manifest만 실시간으로 바꾼다.
export const REALTIME_DUEL_ID = 'realtime-duel'

export function realtimeDuelOf(base: DuelModule): DuelModule {
  const duel = { turnSeconds: { choices: [180], default: 180 }, sameScreen: false, realtime: { raceSeconds: 180 } }
  return { ...base, manifest: { ...base.manifest, id: REALTIME_DUEL_ID, name: '실시간 대전', hidden: true, duel } }
}

export function withRealtimeDuel<R extends { duels: DuelModule[]; getDuel(id: string): DuelModule | undefined }>(real: R): R {
  const rt = realtimeDuelOf(real.duels[0])
  const duels = [...real.duels, rt]
  return { ...real, duels, getDuel: (id: string) => (id === REALTIME_DUEL_ID ? rt : real.getDuel(id)) }
}
