import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Manifest } from '../../games/types.ts'

const daily = vi.fn()
const duels = vi.fn()
const contests = vi.fn()
let admin = false

function m(id: string, modes: Manifest['modes'], extra: Partial<Manifest> = {}): { manifest: Manifest } {
  return {
    manifest: {
      id, name: id === 'wya' ? '후알야' : `게임-${id}`, description: `설명-${id}`, hidden: false, modes,
      puzzleSource: 'generate', dailyTimeLimitSec: null, options: [], ...extra,
    } as Manifest,
  }
}
vi.mock('../../games/index.ts', () => ({
  games: [
    m('wya', { daily: true, contest: true, free: true }),
    m('ball', { daily: false, contest: false, free: true }),
    m('secret', { daily: false, contest: false, free: true }, { hidden: true }),
  ],
}))
vi.mock('./shortcuts.ts', async (orig) => ({
  ...(await orig<typeof import('./shortcuts.ts')>()),
  loadDailyScore: (...a: unknown[]) => daily(...a),
  loadMyOpenDuels: () => duels(),
  loadOpenContests: (...a: unknown[]) => contests(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { GamesPanel, TodayPanel } from './Shortcuts.tsx'

const never = () => new Promise<never>(() => {})
const view = () => render(<MemoryRouter><TodayPanel /><GamesPanel /></MemoryRouter>)
const link = (name: string | RegExp) => screen.getByRole('link', { name })

beforeEach(() => {
  admin = false
  daily.mockReset().mockImplementation(never)
  duels.mockReset().mockImplementation(never)
  contests.mockReset().mockImplementation(never)
})

describe('오늘 판·게임 판', () => {
  test('데이터가 오기 전에도 버튼이 보이고 주소가 맞다', () => {
    view()
    expect(link('데일리 후알야').getAttribute('href')).toBe('/play/wya/daily')
    expect(link('대전').getAttribute('href')).toBe('/duel')
    expect(link('대회').getAttribute('href')).toBe('/contests')
    expect(link('후알야').getAttribute('href')).toBe('/play/wya/free')
    expect(link('게임-ball').getAttribute('href')).toBe('/play/ball/free')
    expect(screen.queryByText('게임-secret')).toBeNull()
    expect(daily).toHaveBeenCalledWith('wya', 'u1')
    expect(contests).toHaveBeenCalledWith('u1')
  })

  test('판 이름: 오늘, 게임. 데일리·대전·대회는 오늘 판, 자유 플레이는 게임 판', () => {
    view()
    const today = screen.getByRole('region', { name: '오늘' })
    const games = screen.getByRole('region', { name: '게임' })
    expect(today.contains(link('데일리 후알야'))).toBe(true)
    expect(today.contains(link('대전'))).toBe(true)
    expect(today.contains(link('대회'))).toBe(true)
    expect(games.contains(link('후알야'))).toBe(true)
    expect(games.contains(link('게임-ball'))).toBe(true)
  })

  test('오늘 판: 데일리를 안 풀었으면 "아직 안 풀었어요"', async () => {
    daily.mockResolvedValue(null)
    view()
    const a = await screen.findByRole('link', { name: '데일리 후알야, 아직 안 풀었어요' })
    expect(a.textContent).toContain('아직 안 풀었어요')
  })

  test('오늘 판: 데일리를 풀었으면 "오늘 N점"', async () => {
    daily.mockResolvedValue(7)
    view()
    const a = await screen.findByRole('link', { name: '데일리 후알야, 오늘 7점' })
    expect(a.textContent).toContain('오늘 7점')
  })

  test('데일리 불러오기에 실패하면 그 줄에 "불러오지 못했어요", 버튼은 그대로', async () => {
    daily.mockRejectedValue(new Error('x'))
    view()
    await screen.findByText('불러오지 못했어요')
    expect(link('데일리 후알야').getAttribute('href')).toBe('/play/wya/daily')
  })

  test('내 대국(진행·대기) 1개면 그 대국으로 바로, 표시 1', async () => {
    duels.mockResolvedValue([{ id: 'm1', status: 'waiting' }])
    view()
    const a = await screen.findByRole('link', { name: '대전, 내 대국 1개' })
    expect(a.getAttribute('href')).toBe('/duel/m1')
    expect(a.textContent).toContain('내 대국 1개')
  })

  test('내 대국 2개면 목록으로, 표시 2; 0개면 "없음"', async () => {
    duels.mockResolvedValue([{ id: 'm1', status: 'active' }, { id: 'm2', status: 'active' }])
    const { unmount } = view()
    const a = await screen.findByRole('link', { name: '대전, 내 대국 2개' })
    expect(a.getAttribute('href')).toBe('/duel')
    unmount()
    duels.mockResolvedValue([])
    view()
    await waitFor(() => expect(duels).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    expect(link('대전').textContent).toContain('없음')
  })

  test('열린 대회 1개면 그 대회로 바로', async () => {
    contests.mockResolvedValue([{ id: 'c1' }])
    view()
    const a = await screen.findByRole('link', { name: '대회, 진행·예정 1개' })
    expect(a.getAttribute('href')).toBe('/contests/c1')
  })

  test('게임 설명 문구는 보이지 않는다', () => {
    admin = true
    view()
    expect(screen.queryByText(/설명-/)).toBeNull()
    expect(link('게임-secret').getAttribute('href')).toBe('/play/secret/free')
  })
})
