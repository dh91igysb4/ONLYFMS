import { FREE_DAILY_CAP } from '../economy.ts'
import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'ball-run',
  name: '볼 런',
  description: '굴러가는 공을 좌우로 움직여 장애물을 피한다',
  hidden: false,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  freeStats: 'score',
  freeBestOnly: true,
  scoreMax: 99999,
  scoreDecimals: 0,
  gold: { perPoint: 0.33, playCap: 100, dailyCap: FREE_DAILY_CAP },
}
