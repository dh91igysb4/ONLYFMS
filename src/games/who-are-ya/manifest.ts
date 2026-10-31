import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'who-are-ya',
  name: '후알야',
  description: '선수 한 명을 8번 안에 맞힌다',
  hidden: true,
  modes: { daily: true, contest: true, free: true },
  puzzleSource: 'generate',
  options: [
    {
      key: 'tier',
      label: '난이도',
      choices: [
        { value: 'easy', label: '쉬움' },
        { value: 'normal', label: '보통' },
        { value: 'hard', label: '어려움' },
      ],
      default: 'easy',
    },
    {
      key: 'league',
      label: '리그',
      // 값은 data.ts의 LEAGUES id와 같아야 한다 (logic.test.ts가 확인)
      choices: [
        { value: 'all', label: '전체' },
        { value: 'premier-league', label: '프리미어리그' },
        { value: 'laliga', label: '라리가' },
        { value: 'serie-a', label: '세리에 A' },
        { value: 'bundesliga', label: '분데스리가' },
        { value: 'ligue-1', label: '리그 1' },
      ],
      default: 'all',
    },
  ],
}
