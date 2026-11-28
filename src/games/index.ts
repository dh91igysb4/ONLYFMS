import type { DuelModule, GameModule, WorldModule } from './types.ts'
import { manifest as whoAreYaManifest } from './who-are-ya/manifest.ts'
import { logic as whoAreYaLogic } from './who-are-ya/logic.ts'
import { manifest as toothbrushManifest } from './toothbrush/manifest.ts'
import { logic as toothbrushLogic } from './toothbrush/logic.ts'
import { manifest as yachtManifest } from './yacht/manifest.ts'
import { logic as yachtLogic } from './yacht/logic.ts'
import { manifest as tttManifest } from './tiki-taka-toe/manifest.ts'
import { logic as tttLogic } from './tiki-taka-toe/logic.ts'
import { manifest as ballRunManifest } from './ball-run/manifest.ts'
import { logic as ballRunLogic } from './ball-run/logic.ts'
import { manifest as sneakExamManifest } from './sneak-exam/manifest.ts'
import { logic as sneakExamLogic } from './sneak-exam/logic.ts'
import { manifest as fishingManifest } from './fishing/manifest.ts'
import { logic as fishingLogic } from './fishing/logic.ts'
import { manifest as neonRiderManifest } from './neon-rider/manifest.ts'
import { logic as neonRiderLogic } from './neon-rider/logic.ts'
import { manifest as careerQuizManifest } from './career-quiz/manifest.ts'
import { logic as careerQuizLogic } from './career-quiz/logic.ts'
import { manifest as duelRacerManifest } from './duel-racer/manifest.ts'
import { logic as duelRacerLogic } from './duel-racer/logic.ts'

/** 게임 등록부. 새 게임은 여기에 한 줄 추가한다. */
export const games: GameModule[] = [
  { manifest: whoAreYaManifest, logic: whoAreYaLogic },
  { manifest: toothbrushManifest, logic: toothbrushLogic },
  { manifest: ballRunManifest, logic: ballRunLogic },
  { manifest: sneakExamManifest, logic: sneakExamLogic },
  { manifest: neonRiderManifest, logic: neonRiderLogic },
  { manifest: careerQuizManifest, logic: careerQuizLogic },
]

export function getGame(id: string): GameModule | undefined {
  return games.find((g) => g.manifest.id === id)
}

/** 대전 게임 등록부. 솔로 `games`와 분리한다 (play Edge Function은 games만 본다). */
export const duels: DuelModule[] = [
  { manifest: yachtManifest, logic: yachtLogic },
  { manifest: tttManifest, logic: tttLogic },
  { manifest: duelRacerManifest, logic: duelRacerLogic },
]

export function getDuel(id: string): DuelModule | undefined {
  return duels.find((d) => d.manifest.id === id)
}

/** 지속형(world) 게임 등록부. 저장이 이어지는 게임은 solo `games`와 분리한다 (play Edge Function은 games만 본다). */
export const worlds: WorldModule[] = [{ manifest: fishingManifest, logic: fishingLogic }]

/**
 * 지갑을 쓰는 게임이 하나라도 등록돼 있는가 (등록부 기준, 게임 id 분기 아님).
 * 화면(헤더·프로필·판돈 입력)은 이 값으로 표시를 가리고, duel 함수는 꺼져 있으면 판돈 0만 받는다(지갑 설계 §9).
 */
export function walletEnabled(): boolean {
  return worlds.some((w) => w.logic.wallet === true)
}

export function getWorld(id: string): WorldModule | undefined {
  return worlds.find((w) => w.manifest.id === id)
}
