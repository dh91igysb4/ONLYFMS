// 자유 플레이 결과의 번 골드 표시 (지갑 설계 §7.4). 테스트 게임에 manifest gold {10, 50, 120}을 단다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const submitMock = vi.fn(async (_row: unknown) => true)
const refreshMock = vi.fn(async () => {})
const gold = vi.hoisted(() => ({ on: true, enabled: true }))

vi.mock('../../games/index.ts', async (orig) => {
  const base = (await import('../../test-fixtures/registry.ts')).withTestGame(await orig())
  const getGame = (id: string) => {
    const g = base.getGame(id)
    if (!g || id !== 'test-guess' || !gold.on) return g
    return { ...g, manifest: { ...g.manifest, gold: { perPoint: 10, playCap: 50, dailyCap: 120 } } }
  }
  return { ...base, getGame }
})
vi.mock('../../games/ui.ts', async (orig) => (await import('../../test-fixtures/ui.ts')).withTestGameUi(await orig()))
vi.mock('./seed.ts', async () => {
  const actual = await vi.importActual<typeof import('./seed.ts')>('./seed.ts')
  return { ...actual, newSeed: () => new Uint8Array(16).fill(3) }
})
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'http://x', supabaseKey: 'k' }))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: false } }),
}))
vi.mock('./freeQueue.ts', () => ({ submit: (row: unknown) => submitMock(row) }))
vi.mock('./freeLogQueue.ts', () => ({ submitLog: () => {} }))
vi.mock('../wallet/useWallet.ts', async (orig) => ({
  ...(await orig<typeof import('../wallet/useWallet.ts')>()),
  refreshWallet: () => refreshMock(),
}))
vi.mock('../wallet/enabled.ts', () => ({ walletEnabled: () => gold.enabled }))

import { PlayRunner } from './PlayRunner.tsx'
import { logic } from '../../test-fixtures/test-guess/logic.ts'
import { rngFromSeed } from '../../shared/rng.ts'
import { resetWallet, setWallet } from '../../lib/walletStore.ts'

const answer = (logic.pickPuzzle(rngFromSeed(new Uint8Array(16).fill(3)), { range: '100' }) as { answer: number }).answer

function guess(n: number) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: String(n) } })
  fireEvent.click(screen.getByRole('button', { name: '추측' }))
}

/** 점수 = 11 − 추측 수 (테스트 게임) */
async function playTo(score: number) {
  render(<PlayRunner mode="local" gameId="test-guess" options={{ range: '100' }} />)
  await screen.findByText('남은 기회 8')
  const wrong = Array.from({ length: 100 }, (_, i) => i + 1).filter((v) => v !== answer)
  for (let i = 0; i < 11 - score - 1; i++) guess(wrong[i])
  guess(answer)
  await screen.findByText(new RegExp(`정답은 ${answer}`))
}

async function goldLine(text: string) {
  await waitFor(() => expect(document.querySelector('.free-gold[role="status"]')?.textContent).toBe(text))
}

beforeEach(() => {
  submitMock.mockReset()
  submitMock.mockResolvedValue(true)
  refreshMock.mockReset()
  resetWallet()
  setWallet({ balance: 0, today: {}, earnedToday: 0 })
  gold.on = true
  gold.enabled = true
})

test('score_3_shows_plus_30_and_refreshes_wallet_after_save', async () => {
  await playTo(3)
  await goldLine('+30 G')
  expect(refreshMock).toHaveBeenCalledTimes(1)
})

test('play_cap_limits_to_50', async () => {
  await playTo(9)
  await goldLine('+50 G')
})

test('game_daily_cap_leftover_and_reached', async () => {
  setWallet({ balance: 0, today: { 'test-guess': 100 }, earnedToday: 0 })
  await playTo(3)
  await goldLine('+20 G')
})

test('game_daily_cap_reached_message', async () => {
  setWallet({ balance: 0, today: { 'test-guess': 120 }, earnedToday: 0 })
  await playTo(3)
  await goldLine('오늘 이 게임 골드는 다 벌었어요')
})

test('site_cap_partial', async () => {
  setWallet({ balance: 0, today: {}, earnedToday: 30750 })
  await playTo(3)
  await goldLine('+6 G · 오늘 상한을 넘어 일부만')
})

test('site_cap_straddle', async () => {
  setWallet({ balance: 0, today: {}, earnedToday: 30740 })
  await playTo(3)
  await goldLine('+14 G · 오늘 상한을 넘어 일부만')
})

test('save_failure_says_gold_comes_later', async () => {
  submitMock.mockResolvedValue(false)
  await playTo(3)
  await goldLine('+30 G · 저장되면 골드가 들어가요')
  expect(refreshMock).not.toHaveBeenCalled()
})

test('game_without_gold_shows_nothing', async () => {
  gold.on = false
  await playTo(3)
  await Promise.resolve()
  expect(document.querySelector('.free-gold')).toBeNull()
})

test('wallet_not_enabled_shows_nothing', async () => {
  gold.enabled = false
  await playTo(3)
  await Promise.resolve()
  expect(document.querySelector('.free-gold')).toBeNull()
  expect(refreshMock).not.toHaveBeenCalled()
})
