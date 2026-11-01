import type { ComponentType } from 'react'
import { ContestsBlock } from './blocks/ContestsBlock.tsx'
import { DailyBlock } from './blocks/DailyBlock.tsx'
import { DuelsBlock } from './blocks/DuelsBlock.tsx'
import { EloBlock } from './blocks/EloBlock.tsx'
import { StreakBlock } from './blocks/StreakBlock.tsx'
import { WeeklyBlock } from './blocks/WeeklyBlock.tsx'

export type HomeBlock = { id: string; title: string; Component: ComponentType<{ title: string }> }

export const homeBlocks: HomeBlock[] = [
  { id: 'daily', title: '오늘의 데일리', Component: DailyBlock },
  { id: 'contests', title: '대회', Component: ContestsBlock },
  { id: 'duels', title: '대전', Component: DuelsBlock },
  { id: 'weekly', title: '이번 주 순위', Component: WeeklyBlock },
  { id: 'elo', title: '대전 레이팅', Component: EloBlock },
  { id: 'streak', title: '내 기록', Component: StreakBlock },
]

export const homeBlockIds: string[] = homeBlocks.map((b) => b.id)
