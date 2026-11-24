import { FREE_DAILY_CAP } from '../economy.ts'
import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'sneak-exam',
  name: '이진우 따라잡기',
  description: '감독관 몰래 답을 알아내 답안지를 채운다',
  hidden: false,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  freeStats: 'score',
  scoreMax: 1600,
  scoreDecimals: 0,
  gold: { perPoint: 0.062, playCap: 200, dailyCap: FREE_DAILY_CAP },
}
