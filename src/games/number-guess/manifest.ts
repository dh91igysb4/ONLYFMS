import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'number-guess',
  name: '숫자 맞히기',
  description: '1~100 사이 숫자를 8번 안에 맞힌다',
  hidden: true,
  modes: { daily: true, contest: true, free: true },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [
    {
      key: 'range',
      label: '범위',
      choices: [
        { value: '100', label: '1~100' },
        { value: '1000', label: '1~1000' },
      ],
      default: '100',
    },
  ],
}
