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
  loadDailyDone: (...a: unknown[]) => daily(...a),
  loadMyActiveDuels: () => duels(),
  loadMyActiveContests: (...a: unknown[]) => contests(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { Shortcuts } from './Shortcuts.tsx'

const never = () => new Promise<never>(() => {})
const view = () => render(<MemoryRouter><Shortcuts /></MemoryRouter>)
const link = (name: string | RegExp) => screen.getByRole('link', { name })

beforeEach(() => {
  admin = false
  daily.mockReset().mockImplementation(never)
  duels.mockReset().mockImplementation(never)
  contests.mockReset().mockImplementation(never)
})

describe('Shortcuts', () => {
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

  test('데일리를 안 끝냈으면 ●와 접근 이름', async () => {
    daily.mockResolvedValue(false)
    view()
    const a = await screen.findByRole('link', { name: '데일리 후알야, 아직 안 풀었어요' })
    expect(a.textContent).toContain('●')
  })

  test('데일리를 끝냈거나 불러오기에 실패하면 ● 없음, 버튼은 그대로', async () => {
    daily.mockRejectedValue(new Error('x'))
    view()
    await waitFor(() => expect(daily).toHaveBeenCalled())
    await Promise.resolve()
    expect(link('데일리 후알야').textContent).not.toContain('●')
  })

  test('진행 중 대국 1개면 그 대국으로 바로, 표시 1', async () => {
    duels.mockResolvedValue([{ id: 'm1', status: 'active' }])
    view()
    const a = await screen.findByRole('link', { name: '대전, 진행 중 1개' })
    expect(a.getAttribute('href')).toBe('/duel/m1')
    expect(a.textContent).toContain('1')
  })

  test('진행 중 대국 2개면 목록으로, 표시 2; 0개면 표시 없음', async () => {
    duels.mockResolvedValue([{ id: 'm1', status: 'active' }, { id: 'm2', status: 'active' }])
    const { unmount } = view()
    const a = await screen.findByRole('link', { name: '대전, 진행 중 2개' })
    expect(a.getAttribute('href')).toBe('/duel')
    unmount()
    duels.mockResolvedValue([])
    view()
    await waitFor(() => expect(duels).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    expect(link('대전').textContent).toBe('대전')
  })

  test('참가 중 대회 1개면 그 대회로 바로', async () => {
    contests.mockResolvedValue([{ id: 'c1' }])
    view()
    const a = await screen.findByRole('link', { name: '대회, 참가 중 1개' })
    expect(a.getAttribute('href')).toBe('/contests/c1')
  })

  test('게임 설명 문구는 보이지 않는다', () => {
    admin = true
    view()
    expect(screen.queryByText(/설명-/)).toBeNull()
    expect(link('게임-secret').getAttribute('href')).toBe('/play/secret/free')
  })
})
