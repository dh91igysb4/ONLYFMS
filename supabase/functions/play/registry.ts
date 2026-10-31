// 게임 등록부 (설계 §4.7): src/games를 상대 경로로 직접 가져온다.
import { getGame } from '../../../src/games/index.ts'
import type { GameModule } from '../../../src/games/types.ts'

export type Registry = { getGame(id: string): GameModule | undefined }

export const registry: Registry = { getGame }
