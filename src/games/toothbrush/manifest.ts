import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'toothbrush',
  name: '양치 시뮬레이터',
  description: '60초 동안 양치해서 플라그를 지운다',
  hidden: false,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  freeStats: 'score',
}
