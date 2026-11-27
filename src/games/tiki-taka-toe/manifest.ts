import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'tiki-taka-toe',
  name: '티키타카토',
  description: '가로·세로 조건을 모두 만족하는 선수로 3칸 한 줄을 먼저 만든다',
  hidden: false,
  topic: 'football',
  category: 'duel',
  modes: { daily: false, contest: false, free: false },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [
    {
      key: 'theme',
      label: '리그 테마',
      choices: [
        { value: 'eng', label: '잉글랜드' },
        { value: 'esp', label: '스페인' },
        { value: 'ita', label: '이탈리아' },
        { value: 'ger', label: '독일' },
        { value: 'eur', label: '유럽 전체' },
      ],
      default: 'eur',
    },
  ],
  duel: { turnSeconds: { choices: [15, 30, 60, 120, 180], default: 30 }, sameScreen: true, prepare: 'ttt_pick_puzzle' },
}
