import { FREE_DAILY_CAP } from '../economy.ts'
import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'neon-rider',
  name: '네온 라이더',
  description: '누르면 달리고, 공중에서 누르면 돈다. 바퀴로 착지하라',
  hidden: false,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  freeStats: 'score',
  freeBestOnly: true,
  scoreMax: 9999,
  scoreDecimals: 0,
  gold: { perPoint: 9.5, playCap: 1430, dailyCap: FREE_DAILY_CAP },
}
