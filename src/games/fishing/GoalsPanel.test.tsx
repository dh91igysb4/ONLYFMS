// 과제 창(데일리·업적·지역 과제)과 완료 알림 문구.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { DEFAULT_AREAS } from './data.ts'
import type { View } from './logic.ts'
import { GoalsPanel } from './GoalsPanel.tsx'
import { DEFAULT_OUTFIT } from './wardrobe.ts'
import { newDaily } from './daily.ts'
import { newStats } from './stats.ts'

vi.mock('./sprites.ts', () => ({ spriteDataUrl: vi.fn((name: string) => `data:${name}`), drawSprite: vi.fn(), SPRITES: {} }))
vi.mock('./scene.ts', () => ({ drawWorld: vi.fn(), releaseSceneCache: vi.fn(), galleryScene: vi.fn(), SCENE_W: 160, SCENE_H: 240 }))

const NOW = Date.UTC(2026, 10, 28, 3)
function makeView(over: Partial<View> = {}): View {
  return {
    gold: 0, totalEarned: 0, rodTier: 1, bagTier: 1, areas: [...DEFAULT_AREAS], bag: [], dex: {}, legends: [], tackles: [], equipped: [],
    challenges: {}, wardrobe: [], outfit: { ...DEFAULT_OUTFIT }, pending: null, ...over,
  }
}
const daily = {
  ...newDaily(), day: '2026-11-28',
  tasks: [
    { id: 'd-any', tier: 'easy' as const, target: 15, progress: 4, done: false, reward: { meal: 3 } },
    { id: 'd-night', tier: 'normal' as const, target: 5, progress: 5, done: true, reward: { meal: 5, baits: { attractor: 2 } } },
    { id: 'd-perfect-run', tier: 'hard' as const, target: 3, progress: 1, done: false, reward: { baits: { attractor: 5 } } },
  ],
}

describe('과제 창', () => {
  test('오늘: 과제 3개·진행·보상, 끝나지 않은 과제만 바꾸기, 바꾸면 onReroll', () => {
    const onReroll = vi.fn()
    render(<GoalsPanel view={makeView({ daily })} busy={false} now={NOW} onReroll={onReroll} onTitle={() => {}} />)
    const list = screen.getByRole('list', { name: '오늘의 과제' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('쉬움 · 아무 물고기 15마리')
    expect(items[0]).toHaveTextContent('4/15 · 보상 어분 3')
    expect(items[1]).toHaveTextContent('완료 · 받은 보상 어분 5, 집어 미끼 2')
    expect(within(items[1]).queryByRole('button')).toBeNull()
    fireEvent.click(within(items[2]).getByRole('button', { name: /바꾸기/ }))
    expect(onReroll).toHaveBeenCalledWith(2)
  })
  test('오늘 과제가 아직 없거나 어제 것이면 불러오는 중, 리롤을 썼으면 버튼이 없다', () => {
    render(<GoalsPanel view={makeView({ daily: { ...daily, day: '2026-11-27' } })} busy={false} now={NOW} onReroll={() => {}} onTitle={() => {}} />)
    expect(screen.getByText('오늘의 과제를 불러오는 중이에요')).toBeInTheDocument()
  })
  test('업적: 점수·분야 탭·진행·숨은 업적은 ???, 칭호는 가진 것만 고른다', () => {
    const onTitle = vi.fn()
    const view = makeView({ dex: { anchovy: { count: 1, maxCm: 10 } }, stats: newStats(), achv: { tiers: { 'a-mythic': 3, 'a-dex': 1 }, title: null } })
    render(<GoalsPanel view={view} busy={false} now={NOW} onReroll={() => {}} onTitle={onTitle} />)
    fireEvent.click(screen.getByRole('tab', { name: '업적' }))
    expect(screen.getByText('업적 점수 95 · 4단계')).toBeInTheDocument()
    const collect = screen.getByRole('list', { name: '수집 업적' })
    expect(within(collect).getAllByRole('listitem')[0]).toHaveTextContent('도감 채우기 · 동')
    expect(within(collect).getAllByRole('listitem')[0]).toHaveTextContent('1/75종 · 다음 보상 15,000 JWD')
    fireEvent.change(screen.getByRole('combobox', { name: '칭호' }), { target: { value: 'a-mythic' } })
    expect(onTitle).toHaveBeenCalledWith('a-mythic')
    expect(within(screen.getByRole('combobox', { name: '칭호' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['보이지 않기', '용을 낚은 자'])
    fireEvent.click(screen.getByRole('tab', { name: '숨은 업적' }))
    expect(within(screen.getByRole('list', { name: '숨은 업적 업적' })).getAllByText('???')).toHaveLength(8)
  })
  test('지역 과제 탭은 기존 도전과제 목록', () => {
    render(<GoalsPanel view={makeView({ daily })} busy={false} now={NOW} onReroll={() => {}} onTitle={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: '지역 과제' }))
    expect(screen.getByText('깬 과제 0/10')).toBeInTheDocument()
  })
})

describe('완료 알림 문구', async () => {
  const { goalsText } = await import('./Game.tsx')
  test('과제 완료·셋 다·주간, 업적 단계·칭호', () => {
    expect(goalsText(undefined)).toBeNull()
    expect(goalsText({ daily: ['d-any'], rewards: [{ meal: 3 }] })).toBe('오늘의 과제 완료: 어분 3')
    expect(goalsText({ daily: ['d-any'], allDone: true, weekly: true, rewards: [{ meal: 3 }, { baits: { legend: 3 } }] })).toBe('오늘의 과제 완료(셋 다!) · 주간 보너스: 어분 3, 전설 미끼 3')
    expect(goalsText({ achv: [{ id: 'a-mythic', tier: 3, gold: 80000 }] })).toBe('업적 금 단계: 신화 수집 · +80,000 JWD · 칭호 "용을 낚은 자"')
  })
})
