import { FREE_DAILY_CAP } from '../economy.ts'
import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'career-quiz',
  name: '커리어 퀴즈',
  description: '클럽 경력을 보고 선수를 8번 안에 맞힌다',
  hidden: true,
  modes: { daily: false, contest: false, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [
    {
      key: 'mode',
      label: '모드',
      choices: [
        { value: 'normal', label: '일반' },
        { value: 'challenge', label: '챌린지' },
      ],
      default: 'normal',
    },
    {
      key: 'tier',
      label: '난이도',
      // 값은 data.ts의 Tier와 같아야 한다 (logic.test.ts가 확인)
      choices: [
        { value: 'easy', label: '쉬움' },
        { value: 'normal', label: '보통' },
        { value: 'hard', label: '어려움' },
      ],
      default: 'easy',
    },
  ],
  gold: { perPoint: 9, playCap: 200, dailyCap: FREE_DAILY_CAP },
}
