import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'sneak-exam',
  name: '몰래 수능',
  description: '감독관 몰래 답을 알아내 답안지를 채운다',
  hidden: true,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  freeStats: 'score',
  scoreMax: 1600,
  scoreDecimals: 0,
}
