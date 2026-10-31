import type { GameModule } from './types.ts'
import { manifest as whoAreYaManifest } from './who-are-ya/manifest.ts'
import { logic as whoAreYaLogic } from './who-are-ya/logic.ts'

/** 게임 등록부. 새 게임은 여기에 한 줄 추가한다. */
export const games: GameModule[] = [
  { manifest: whoAreYaManifest, logic: whoAreYaLogic },
]

export function getGame(id: string): GameModule | undefined {
  return games.find((g) => g.manifest.id === id)
}
