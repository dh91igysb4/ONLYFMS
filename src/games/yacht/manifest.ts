import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'yacht',
  name: '요트 다이스',
  description: '주사위 5개로 13칸을 채워 더 높은 점수를 낸다',
  hidden: false,
  category: 'duel',
  modes: { daily: false, contest: false, free: false },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  duel: { turnSeconds: { choices: [30, 60, 90], default: 60 }, sameScreen: true },
}
