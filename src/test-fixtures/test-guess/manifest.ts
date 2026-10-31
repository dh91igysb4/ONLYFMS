// 테스트 전용 게임(운영 등록부에 없음). 플랫폼 테스트가 게임 하나를 끝까지 돌려 보는 데 쓴다.
import type { Manifest } from '../../games/types.ts'

export const manifest: Manifest = {
  id: 'test-guess',
  name: '테스트 숫자 맞히기',
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
