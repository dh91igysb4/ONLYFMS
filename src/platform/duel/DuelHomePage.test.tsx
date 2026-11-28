import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'http://x', supabaseKey: 'k' }))
const duelMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  duel: (...a: unknown[]) => duelMock(...a),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
let admin = true
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

let walletOn = false
vi.mock('../wallet/enabled.ts', () => ({ walletEnabled: () => walletOn }))
const refreshMock = vi.fn(async () => {})
vi.mock('../wallet/useWallet.ts', async (orig) => ({
  ...(await orig<typeof import('../wallet/useWallet.ts')>()),
  refreshWallet: () => refreshMock(),
}))

vi.mock('../../games/index.ts', async (orig) =>
  (await import('../../test-fixtures/duel.ts')).withHiddenDuel(await orig<typeof import('../../games/index.ts')>()))

import { DuelHomePage } from './DuelHomePage.tsx'
import { resetWallet, setWallet } from '../../lib/walletStore.ts'

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}</p>
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/duel']}>
      <Routes>
        <Route path="/duel" element={<DuelHomePage />} />
        <Route path="*" element={<p>다른 화면</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const calls = (action: string) => duelMock.mock.calls.filter((c) => (c[0] as { action: string }).action === action)

const empty = { lobby: [], mine: [], recent: [], due: [] }
const item = (over: Record<string, unknown>) => ({
  id: 'x', game_id: 'yacht', rated: true, visibility: 'public', turn_seconds: 60, status: 'waiting',
  players: [{ id: 'u2', handle: 'son', rating: 1010 }], created_by_handle: 'son',
  created_at: new Date().toISOString(), winner: null, end_reason: null, final_scores: null, ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  duelMock.mockReset()
  rpcMock.mockReset()
  admin = true
  walletOn = false
  refreshMock.mockClear()
  resetWallet()
  rpcMock.mockResolvedValue(empty)
})
afterEach(() => { vi.useRealTimers() })

test('home_create_form', async () => {
  duelMock.mockResolvedValue({ match_id: 'm9', invite_code: 'abcde12345' })
  renderHome()
  await flush()
  const game = screen.getByLabelText('게임') as HTMLSelectElement
  // 대전 게임만 (솔로 게임은 없다). 관리자라 숨김 대전도 보인다
  expect(Array.from(game.options).map((o) => o.textContent)).toEqual(['요트 다이스', '티키타카토', '숨김 대전'])
  const turn = screen.getByLabelText('턴 시간') as HTMLSelectElement
  expect(Array.from(turn.options).map((o) => o.value)).toEqual(['30', '60', '90'])
  expect(turn.value).toBe('60')
  expect((screen.getByLabelText('랭크') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('공개') as HTMLInputElement).checked).toBe(true)

  fireEvent.click(screen.getByLabelText('친선'))
  fireEvent.click(screen.getByLabelText('초대 링크로만'))
  fireEvent.change(turn, { target: { value: '90' } })
  fireEvent.click(screen.getByRole('button', { name: '대국 만들기' }))
  await flush()
  expect(calls('create')).toEqual([[{
    action: 'create', game_id: 'yacht', options: {}, rated: false, visibility: 'invite', turn_seconds: 90, stake: 0,
  }]])
  // 지갑 게임이 없으면 판돈 입력이 없다(서버도 0만 받는다)
  expect(screen.queryByLabelText('판돈')).toBeNull()
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/m9')
})

test('home_create_form: hidden duel games are admin only', async () => {
  const r = renderHome()
  await flush()
  expect(within(screen.getByLabelText('게임')).getByRole('option', { name: '숨김 대전' })).toBeInTheDocument()
  r.unmount()
  admin = false
  renderHome()
  await flush()
  const select = screen.getByLabelText('게임')
  expect(within(select).getByRole('option', { name: '요트 다이스' })).toBeInTheDocument()
  expect(within(select).queryByRole('option', { name: '숨김 대전' })).toBeNull()
})

test('home_local_start: sameScreen games only, hidden ones admin only', async () => {
  renderHome()
  await flush()
  fireEvent.click(screen.getByRole('link', { name: /요트 다이스 시작/ }))
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/local/yacht')
})

test('home_local_start: hidden from non-admin', async () => {
  admin = false
  renderHome()
  await flush()
  expect(screen.getByRole('link', { name: /요트 다이스 시작/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /숨김 대전 시작/ })).toBeNull()
})

test('home_create_form: server error is shown', async () => {
  const { ApiError } = await import('../../lib/api.ts')
  duelMock.mockRejectedValue(new ApiError('too_many_waiting', 409, { error: 'too_many_waiting' }))
  renderHome()
  await flush()
  fireEvent.click(screen.getByRole('button', { name: '대국 만들기' }))
  await flush()
  expect(screen.getByText('기다리는 대국은 3개까지 만들 수 있어요')).toBeInTheDocument()
  expect(screen.getByTestId('where')).toHaveTextContent('/duel')
})

test('home_lists', async () => {
  duelMock.mockImplementation(async (b: { action: string }) => {
    if (b.action === 'tick') throw new Error('ignored')
    if (b.action === 'join') return { match_id: 'l1' }
    throw new Error(b.action)
  })
  rpcMock.mockResolvedValueOnce({
    lobby: [item({ id: 'l1' })],
    mine: [
      item({ id: 'w1', players: [{ id: 'u1', handle: 'kane', rating: 1000 }], created_by_handle: 'kane', visibility: 'invite' }),
      item({ id: 'a1', status: 'active', players: [{ id: 'u1', handle: 'kane', rating: 1000 }, { id: 'u3', handle: 'park', rating: 990 }] }),
    ],
    recent: [item({
      id: 'r1', status: 'finished', winner: 1, end_reason: 'normal', final_scores: [150, 210],
      players: [{ id: 'u4', handle: 'ji', rating: 980 }, { id: 'u1', handle: 'kane', rating: 1020 }],
    })],
    due: ['m7', 'm8'],
  })
  renderHome()
  await flush()
  expect(rpcMock).toHaveBeenCalledWith('duel_list')

  const lobby = screen.getByRole('region', { name: '대기실' })
  expect(within(lobby).getByText(/son/)).toBeInTheDocument()
  const mine = screen.getByRole('region', { name: '내 대국' })
  expect(within(mine).getByRole('link', { name: /상대를 기다리는 중/ })).toHaveAttribute('href', '/duel/w1')
  expect(within(mine).getByRole('link', { name: /park/ })).toHaveAttribute('href', '/duel/a1')
  const recent = screen.getByRole('region', { name: '최근 결과' })
  expect(within(recent).getByText(/승/)).toBeInTheDocument()
  expect(within(recent).getByText(/210 : 150/)).toBeInTheDocument()

  // 마감 지난 내 대국은 한 번씩 tick (오류는 무시)
  expect(calls('tick')).toEqual([
    [{ action: 'tick', match_id: 'm7' }],
    [{ action: 'tick', match_id: 'm8' }],
  ])
  expect(screen.queryByRole('alert')).toBeNull()

  // 대기실은 5초마다 다시 읽는다
  await advance(5000)
  expect(rpcMock.mock.calls.filter((c) => c[0] === 'duel_list')).toHaveLength(2)
  expect(calls('tick')).toHaveLength(2)
  expect(screen.getByText('기다리는 공개 대국이 없어요')).toBeInTheDocument()
})

test('home_lists: lobby join goes to the match', async () => {
  duelMock.mockResolvedValue({ match_id: 'l1' })
  rpcMock.mockResolvedValue({ ...empty, lobby: [item({ id: 'l1' })] })
  renderHome()
  await flush()
  fireEvent.click(screen.getByRole('button', { name: '참가' }))
  await flush()
  expect(calls('join')).toEqual([[{ action: 'join', match_id: 'l1', stake: 0 }]])
  expect(screen.getByTestId('where')).toHaveTextContent('/duel/l1')
})

test('home_lists: slow duel_list does not stack overlapping calls', async () => {
  let resolve!: (v: unknown) => void
  rpcMock.mockReset()
  rpcMock.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
  rpcMock.mockResolvedValue(empty)
  renderHome()
  await flush()
  await advance(16_000)
  expect(rpcMock.mock.calls.filter((c) => c[0] === 'duel_list')).toHaveLength(1)
  await act(async () => { resolve(empty); await vi.advanceTimersByTimeAsync(0) })
  await flush()
  expect(rpcMock.mock.calls.filter((c) => c[0] === 'duel_list')).toHaveLength(2)
})

// ---------------------------------------------------------------- 판돈 (지갑 4단계)
test('home_stake_picker: presets capped by balance, sends stake, refreshes wallet', async () => {
  walletOn = true
  setWallet({ balance: 1200, today: {}, earnedToday: 0 })
  duelMock.mockResolvedValue({ match_id: 'm9', invite_code: 'abcde12345', stake: 500 })
  renderHome()
  await flush()
  expect(screen.getByText(/내 골드 1,200 G/)).toBeInTheDocument()
  expect(screen.getByText(/이기면 상대 판돈까지 가져가요/)).toBeInTheDocument()
  const presets = screen.getByRole('group', { name: '판돈 빠른 선택' })
  expect(within(presets).getAllByRole('button').map((b) => b.textContent)).toEqual(['0 G', '100 G', '500 G', '1,000 G'])
  fireEvent.click(within(presets).getByRole('button', { name: '500 G' }))
  expect((screen.getByLabelText('판돈') as HTMLInputElement).value).toBe('500')
  fireEvent.click(screen.getByRole('button', { name: '대국 만들기' }))
  await flush()
  expect((calls('create')[0][0] as { stake: number }).stake).toBe(500)
  expect(refreshMock).toHaveBeenCalled()
})

test('home_stake_picker: more than balance is blocked, max 41,000', async () => {
  walletOn = true
  setWallet({ balance: 1200, today: {}, earnedToday: 0 })
  renderHome()
  await flush()
  const input = screen.getByLabelText('판돈')
  fireEvent.change(input, { target: { value: '2000' } })
  expect(screen.getByText('골드가 부족해요')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '대국 만들기' })).toBeDisabled()
  fireEvent.change(input, { target: { value: '1.5' } })
  expect(screen.getByText('판돈을 다시 적어 주세요')).toBeInTheDocument()
  setWallet({ balance: 100000, today: {}, earnedToday: 0 })
  await flush()
  fireEvent.change(input, { target: { value: '50000' } })
  expect(screen.getByText('판돈은 41,000 G까지예요')).toBeInTheDocument()
  fireEvent.change(input, { target: { value: '41000' } })
  expect(screen.getByRole('button', { name: '대국 만들기' })).toBeEnabled()
})

test('home_stake_picker: hidden game has no stake', async () => {
  walletOn = true
  setWallet({ balance: 1200, today: {}, earnedToday: 0 })
  duelMock.mockResolvedValue({ match_id: 'm9', invite_code: 'abcde12345' })
  renderHome()
  await flush()
  fireEvent.change(screen.getByLabelText('판돈'), { target: { value: '500' } })
  const game = screen.getByLabelText('게임') as HTMLSelectElement
  const hiddenId = Array.from(game.options).find((o) => o.textContent === '숨김 대전')!.value
  fireEvent.change(game, { target: { value: hiddenId } })
  expect(screen.queryByLabelText('판돈')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '대국 만들기' }))
  await flush()
  expect((calls('create')[0][0] as { stake: number }).stake).toBe(0)
})

test('home_lobby_stake: shown and sent on join', async () => {
  duelMock.mockResolvedValue({ match_id: 'l1' })
  rpcMock.mockResolvedValue({
    ...empty,
    lobby: [item({ id: 'l1', stake: 1000 })],
    mine: [item({ id: 'w1', created_by_handle: 'kane', players: [{ id: 'u1', handle: 'kane', rating: 1000 }], stake: 300 })],
  })
  renderHome()
  await flush()
  const lobby = screen.getByRole('region', { name: '대기실' })
  expect(within(lobby).getByText(/판돈 1,000 G/)).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: '내 대국' })).getByText(/판돈 300 G/)).toBeInTheDocument()
  fireEvent.click(within(lobby).getByRole('button', { name: '1,000 G 걸고 참가' }))
  await flush()
  expect(calls('join')).toEqual([[{ action: 'join', match_id: 'l1', stake: 1000 }]])
  expect(refreshMock).toHaveBeenCalled()
})

test('home_lobby_stake: not enough gold message', async () => {
  const { ApiError } = await import('../../lib/api.ts')
  duelMock.mockRejectedValue(new ApiError('not_enough_gold', 409))
  rpcMock.mockResolvedValue({ ...empty, lobby: [item({ id: 'l1', stake: 1000 })] })
  renderHome()
  await flush()
  fireEvent.click(screen.getByRole('button', { name: '1,000 G 걸고 참가' }))
  await flush()
  expect(screen.getByText('골드가 부족해요')).toBeInTheDocument()
})

test('종류·공개 범위는 라디오(구분 버튼)로 고르고 create 요청에 rated·visibility로 간다', async () => {
  duelMock.mockResolvedValue({ match_id: 'm9', invite_code: 'abcde12345' })
  renderHome()
  await flush()
  const friendly = screen.getByRole('radio', { name: '친선' })
  const invite = screen.getByRole('radio', { name: '초대 링크로만' })
  expect(friendly.closest('.fm-seg')).not.toBeNull()
  expect(invite.closest('.fm-seg')).not.toBeNull()
  expect((screen.getByRole('radio', { name: '랭크' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(friendly)
  fireEvent.click(invite)
  expect(screen.getByRole('form', { name: '대국 만들기' }).querySelector('.fm-form')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '대국 만들기' }))
  await flush()
  expect(calls('create')[0][0]).toMatchObject({ rated: false, visibility: 'invite' })
})

test('최근 결과 표: 승·무·패 칸과 점수, 무효는 칸 없이 "무효"', async () => {
  const me = { id: 'u1', handle: 'kane', rating: 1000 }
  const ji = { id: 'u4', handle: 'ji', rating: 980 }
  rpcMock.mockResolvedValue({
    ...empty,
    recent: [
      item({ id: 'r1', status: 'finished', winner: 1, final_scores: [150, 210], players: [ji, me] }),
      item({ id: 'r2', status: 'finished', winner: 0, final_scores: [150, 210], players: [ji, me] }),
      item({ id: 'r3', status: 'finished', winner: null, final_scores: [100, 100], players: [me, ji] }),
      item({ id: 'r4', status: 'void', winner: null, final_scores: null, players: [me, ji] }),
    ],
  })
  renderHome()
  await flush()
  const recent = screen.getByRole('region', { name: '최근 결과' })
  const rows = [...recent.querySelectorAll('tbody tr')]
  expect(rows).toHaveLength(4)
  expect(rows.map((r) => r.querySelector('.fm-chip')?.textContent ?? null)).toEqual(['승', '패', '무', null])
  expect(rows[0].querySelector('.fm-chip')!.className).toContain('is-win')
  expect(rows[1].querySelector('.fm-chip')!.className).toContain('is-loss')
  expect(rows[0].textContent).toContain('210 : 150')
  expect(rows[3].textContent).toContain('무효')
  expect(within(rows[0] as HTMLElement).getByRole('link', { name: /ji/ })).toHaveAttribute('href', '/duel/r1')
})

test('맨 위 숫자 칸: 대기실 n, 내 대국 n', async () => {
  rpcMock.mockResolvedValue({
    ...empty,
    lobby: [item({ id: 'l1' })],
    mine: [item({ id: 'w1' }), item({ id: 'a1', status: 'active' })],
  })
  renderHome()
  await flush()
  const stats = document.querySelector('.fm-stats')!
  const pairs = [...stats.querySelectorAll('.fm-stat')].map((s) => [
    s.querySelector('.fm-stat-label')!.textContent, s.querySelector('.fm-stat-value')!.textContent,
  ])
  expect(pairs).toEqual([['대기실', '1'], ['내 대국', '2']])
  expect(screen.getByRole('heading', { name: '대전' }).className).toContain('sr-only')
})
