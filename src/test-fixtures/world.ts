// 테스트 전용: 지속형 게임(test-world). 횟수를 세는 아주 작은 게임이다.
// 쓰는 쪽:
//   vi.mock('<…>/games/index.ts', async (orig) =>
//     (await import('<…>/test-fixtures/world.ts')).withTestWorld(await orig()))
//   vi.mock('<…>/games/ui.ts', async (orig) =>
//     (await import('<…>/test-fixtures/world.ts')).withTestWorldUi(await orig(), Component))
import type { ComponentType } from 'react'
import type { WorldGameProps } from '../games/ui.ts'
import type { WorldModule } from '../games/types.ts'

export const TEST_WORLD_ID = 'test-world'

type State = { n: number }
type Action = { type: 'inc' } | { type: 'bad' }

export const testWorld: WorldModule = {
  manifest: {
    id: TEST_WORLD_ID,
    name: '테스트 월드',
    description: '테스트 전용 지속형 게임',
    hidden: false,
    modes: { daily: false, contest: false, free: false },
    puzzleSource: 'generate',
    dailyTimeLimitSec: null,
    options: [],
    category: 'world',
    records: [{ key: 'n', label: '횟수' }],
  },
  logic: {
    version: 1,
    init: (): State => ({ n: 0 }),
    migrate: (state: unknown): State => {
      const n = (state as { n?: unknown } | null | undefined)?.n
      return { n: typeof n === 'number' && Number.isFinite(n) ? n : 0 }
    },
    apply: (state: State, action: Action) =>
      action.type === 'inc' ? { state: { n: state.n + 1 } } : { error: 'nope' },
    view: (state: State) => state,
    records: (state: State) => [{ key: 'n', value: state.n }],
  },
}

export function withTestWorld<R extends { worlds: WorldModule[]; getWorld(id: string): WorldModule | undefined }>(real: R): R {
  return {
    ...real,
    worlds: [...real.worlds, testWorld],
    getWorld: (id: string) => (id === TEST_WORLD_ID ? testWorld : real.getWorld(id)),
  }
}

export function withTestWorldUi(
  real: { getWorldComponent(id: string): ComponentType<WorldGameProps> | undefined },
  Component: ComponentType<WorldGameProps>,
) {
  return {
    ...real,
    getWorldComponent: (id: string) => (id === TEST_WORLD_ID ? Component : real.getWorldComponent(id)),
  }
}
