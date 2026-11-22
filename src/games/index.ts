import type { DuelModule, GameModule, WorldModule } from './types.ts'
import { manifest as whoAreYaManifest } from './who-are-ya/manifest.ts'
import { logic as whoAreYaLogic } from './who-are-ya/logic.ts'
import { manifest as toothbrushManifest } from './toothbrush/manifest.ts'
import { logic as toothbrushLogic } from './toothbrush/logic.ts'
import { manifest as yachtManifest } from './yacht/manifest.ts'
import { logic as yachtLogic } from './yacht/logic.ts'
import { manifest as ballRunManifest } from './ball-run/manifest.ts'
import { logic as ballRunLogic } from './ball-run/logic.ts'
import { manifest as sneakExamManifest } from './sneak-exam/manifest.ts'
import { logic as sneakExamLogic } from './sneak-exam/logic.ts'

/** 게임 등록부. 새 게임은 여기에 한 줄 추가한다. */
export const games: GameModule[] = [
  { manifest: whoAreYaManifest, logic: whoAreYaLogic },
  { manifest: toothbrushManifest, logic: toothbrushLogic },
  { manifest: ballRunManifest, logic: ballRunLogic },
  { manifest: sneakExamManifest, logic: sneakExamLogic },
]

export function getGame(id: string): GameModule | undefined {
  return games.find((g) => g.manifest.id === id)
}

/** 대전 게임 등록부. 솔로 `games`와 분리한다 (play Edge Function은 games만 본다). */
export const duels: DuelModule[] = [{ manifest: yachtManifest, logic: yachtLogic }]

export function getDuel(id: string): DuelModule | undefined {
  return duels.find((d) => d.manifest.id === id)
}

/** 지속형(world) 게임 등록부. 저장이 이어지는 게임은 solo `games`와 분리한다 (play Edge Function은 games만 본다). */
export const worlds: WorldModule[] = []

export function getWorld(id: string): WorldModule | undefined {
  return worlds.find((w) => w.manifest.id === id)
}
