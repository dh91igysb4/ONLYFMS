import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'ball-run',
  name: '볼 런',
  description: '공을 굴려 장애물을 피해 최대한 멀리 간다',
  hidden: true,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  freeStats: 'score',
  scoreMax: 99999,
  scoreDecimals: 0,
}
