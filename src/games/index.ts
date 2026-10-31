import type { DuelModule, GameModule } from './types.ts'
import { manifest as numberGuessManifest } from './number-guess/manifest.ts'
import { logic as numberGuessLogic } from './number-guess/logic.ts'
import { manifest as whoAreYaManifest } from './who-are-ya/manifest.ts'
import { logic as whoAreYaLogic } from './who-are-ya/logic.ts'
import { manifest as yachtManifest } from './yacht/manifest.ts'
import { logic as yachtLogic } from './yacht/logic.ts'

/** 게임 등록부. 새 게임은 여기에 한 줄 추가한다. */
export const games: GameModule[] = [
  { manifest: numberGuessManifest, logic: numberGuessLogic },
  { manifest: whoAreYaManifest, logic: whoAreYaLogic },
]

export function getGame(id: string): GameModule | undefined {
  return games.find((g) => g.manifest.id === id)
}

/** 대전 게임 등록부. 솔로 `games`와 분리한다 (play Edge Function은 games만 본다). */
export const duels: DuelModule[] = [{ manifest: yachtManifest, logic: yachtLogic }]

export function getDuel(id: string): DuelModule | undefined {
  return duels.find((d) => d.manifest.id === id)
}
