import type { GameModule } from './types.ts'
import { manifest as numberGuessManifest } from './number-guess/manifest.ts'
import { logic as numberGuessLogic } from './number-guess/logic.ts'

/** 게임 등록부. 새 게임은 여기에 한 줄 추가한다. */
export const games: GameModule[] = [
  { manifest: numberGuessManifest, logic: numberGuessLogic },
]

export function getGame(id: string): GameModule | undefined {
  return games.find((g) => g.manifest.id === id)
}
