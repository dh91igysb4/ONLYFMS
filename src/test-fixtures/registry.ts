// 테스트 전용 등록부: 운영 게임에 테스트 게임(test-guess)을 더한다.
// 쓰는 쪽:
//   vi.mock('<…>/games/index.ts', async (orig) =>
//     (await import('<…>/test-fixtures/registry.ts')).withTestGame(await orig()))
import type { GameModule } from '../games/types.ts'
import { manifest } from './test-guess/manifest.ts'
import { logic } from './test-guess/logic.ts'

export const testGuess: GameModule = { manifest, logic }

export function withTestGame(real: { games: GameModule[] }) {
  const games = [testGuess, ...real.games]
  return { games, getGame: (id: string) => games.find((g) => g.manifest.id === id) }
}
