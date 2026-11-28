import type { Manifest } from '../types.ts'

export const manifest: Manifest = {
  id: 'fishing',
  name: '펨타듀 낚시',
  shortName: '밸리',
  description: '물고기를 낚아 팔고 더 좋은 낚싯대를 산다',
  hidden: false,
  modes: { daily: false, contest: false, free: false },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  category: 'world',
  preview: true,
  avatar: { label: '낚시꾼' },
  records: [
    { key: 'total_earned', label: '누적 수익', unit: 'G' },
    { key: 'biggest', label: '최대어', unit: 'cm' },
    { key: 'dex', label: '도감', unit: '종' },
    { key: 'challenges', label: '도전과제', unit: '개' },
    { key: 'isle_cleared', label: '섬 개간', unit: '구역' },
    { key: 'house', label: '집', unit: '단계' },
    { key: 'deco', label: '섬 꾸미기', unit: '개' },
  ],
}
