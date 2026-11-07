import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'ball-run',
  name: '볼 런',
  description: '굴러가는 공을 좌우로 움직여 장애물을 피한다',
  hidden: true,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  freeStats: 'score',
  scoreMax: 99999,
  scoreDecimals: 0,
}
