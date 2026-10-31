// 테스트 전용 화면 등록부: 운영 화면에 테스트 게임 화면을 더한다.
// 쓰는 쪽:
//   vi.mock('<…>/games/ui.ts', async (orig) =>
//     (await import('<…>/test-fixtures/ui.ts')).withTestGameUi(await orig()))
import type { ComponentType } from 'react'
import type { GameProps } from '../games/ui.ts'
import { Game } from './test-guess/Game.tsx'

export function withTestGameUi(real: { getGameComponent(id: string): ComponentType<GameProps> | undefined }) {
  return {
    ...real,
    getGameComponent: (id: string) => (id === 'test-guess' ? Game : real.getGameComponent(id)),
  }
}
