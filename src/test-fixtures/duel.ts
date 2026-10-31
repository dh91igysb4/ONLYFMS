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
