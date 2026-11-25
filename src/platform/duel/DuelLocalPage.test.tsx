import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

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

// 옵션이 있는 가짜 대전 게임 (옵션 기본값이 init에 전달되는지 확인)
const initSpy = vi.hoisted(() => vi.fn())
vi.mock('../../games/index.ts', async (orig) => {
  const real = await orig<typeof import('../../games/index.ts')>()
  const fake = {
    manifest: {
      id: 'opt-fake', name: '옵션 게임', hidden: false,
      options: [{ key: 'size', label: '크기', choices: [{ value: 's', label: 'S' }, { value: 'l', label: 'L' }], default: 'l' }],
      duel: { turnSeconds: { choices: [60], default: 60 }, sameScreen: true },
    },
    logic: {
      version: 1,
      init: (_r: unknown, o: unknown) => { initSpy(o); return {} },
      toMove: () => 0,
      view: () => ({}),
      turnNo: () => 0,
      result: () => ({ over: false }),
    },
  }
  // 판 준비 RPC를 쓰는 가짜 게임: init이 prepared를 상태에 담고, 보드가 그것을 그린다
  const prep = {
    manifest: { ...fake.manifest, id: 'prep-fake', name: '준비 게임', duel: { ...fake.manifest.duel, prepare: 'prep_fake' } },
    logic: { ...fake.logic, init: (_r: unknown, o: unknown, p: unknown) => ({ o, p }), view: (s: unknown) => s },
  }
  const { withHiddenDuel } = await import('../../test-fixtures/duel.ts')
  const withHidden = withHiddenDuel(real)
  const fakes: Record<string, unknown> = { 'opt-fake': fake, 'prep-fake': prep }
  return { ...withHidden, getDuel: (id: string) => fakes[id] ?? withHidden.getDuel(id) }
})
vi.mock('../../games/ui.ts', async (orig) => {
  const real = await orig<typeof import('../../games/ui.ts')>()
  const PrepBoard = ({ view }: { view: { p: { theme: string } } }) => <p data-testid="prep-board">{view.p.theme}</p>
  return {
    ...real,
    getDuelComponent: (id: string) =>
      id === 'opt-fake' ? () => null : id === 'prep-fake' ? PrepBoard : real.getDuelComponent(id === 'hidden-duel' ? 'yacht' : id),
  }
})

import { DuelLocalPage } from './DuelLocalPage.tsx'

beforeEach(() => { duelMock.mockReset(); rpcMock.mockReset(); admin = true })

function renderLocal(game: string, rng?: () => number) {
  return render(
    <MemoryRouter initialEntries={[`/duel/local/${game}`]}>
      <Routes>
        <Route path="/duel/local/:game" element={<DuelLocalPage rng={rng} />} />
      </Routes>
    </MemoryRouter>,
  )
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

test('local_init_uses_manifest_option_defaults', () => {
  initSpy.mockClear()
  renderLocal('opt-fake')
  expect(initSpy).toHaveBeenCalledWith({ size: 'l' })
})

test('unknown_game', () => {
  renderLocal('nope')
  expect(screen.getByText('없는 게임이에요')).toBeTruthy()
})

test('hidden_game_admin_only', () => {
  renderLocal('hidden-duel')
  expect(screen.getByTestId('turn')).toBeTruthy()
  cleanup()
  admin = false
  renderLocal('hidden-duel')
  expect(screen.getByText('없는 게임이에요')).toBeTruthy()
  expect(screen.queryByTestId('turn')).toBeNull()
})

test('turn_label_and_pass_hint', () => {
  renderLocal('yacht', () => 0.1)
  expect(screen.getByTestId('turn').textContent).toContain('플레이어 1 차례')
  expect(screen.queryByText(/기기를 넘겨주세요/)).toBeNull()
  click(/^굴리기/)
  const cell = screen.getAllByRole('button').find((b) => /기록/.test(b.getAttribute('aria-label') ?? ''))!
  fireEvent.click(cell)
  expect(screen.getByTestId('turn').textContent).toContain('플레이어 2 차례')
  expect(screen.getByText(/기기를 넘겨주세요/)).toBeTruthy()
  click(/^굴리기/)
  expect(screen.queryByText(/기기를 넘겨주세요/)).toBeNull()
})

test('local_full_game', () => {
  // 모든 주사위 1: 요트(50)·에이스 등 허용 칸이 계속 남는다
  renderLocal('yacht', () => 0)
  for (let turn = 0; turn < 26; turn++) {
    click(/^굴리기/)
    const cell = screen.getAllByRole('button').find((b) => /기록/.test(b.getAttribute('aria-label') ?? ''))
    expect(cell, `turn ${turn}`).toBeTruthy()
    fireEvent.click(cell!)
  }
  expect(screen.getByRole('region', { name: '결과' })).toBeTruthy()
  expect(within(screen.getByRole('region', { name: '결과' })).getByText(/승리|무승부/)).toBeTruthy()
  expect(duelMock).not.toHaveBeenCalled()
  expect(rpcMock).not.toHaveBeenCalled()
  // 다시 하기
  click('다시 하기')
  expect(screen.queryByRole('region', { name: '결과' })).toBeNull()
  expect(screen.getByTestId('turn').textContent).toContain('플레이어 1 차례')
})

test('restart_first_roll_has_no_stale_keep', () => {
  renderLocal('yacht', () => 0)
  click(/^굴리기/)
  fireEvent.click(screen.getAllByRole('button', { name: /^주사위 1/ })[0])
  fireEvent.click(screen.getAllByRole('button').find((b) => /기록/.test(b.getAttribute('aria-label') ?? ''))!)
  for (let turn = 1; turn < 26; turn++) {
    click(/^굴리기/)
    fireEvent.click(screen.getAllByRole('button').find((b) => /기록/.test(b.getAttribute('aria-label') ?? ''))!)
  }
  click('다시 하기')
  click(/^굴리기/)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getAllByRole('button', { name: /^주사위/ }).every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true)
})

test('local_prepare_states', async () => {
  let reject!: (e: unknown) => void
  rpcMock.mockReturnValueOnce(new Promise((_res, rej) => { reject = rej }))
  renderLocal('prep-fake')
  expect(screen.getByText('판을 준비하고 있어요')).toBeTruthy()
  expect(rpcMock).toHaveBeenCalledWith('prep_fake', { p_options: { size: 'l' } })
  expect(screen.queryByTestId('prep-board')).toBeNull()
  reject(new Error('down'))
  expect(await screen.findByText('판을 불러오지 못했어요')).toBeTruthy()
  expect(screen.queryByTestId('prep-board')).toBeNull()
  // 다시 시도: null도 실패로 본다
  rpcMock.mockResolvedValueOnce(null)
  click('다시 시도')
  expect(await screen.findByText('판을 불러오지 못했어요')).toBeTruthy()
  rpcMock.mockResolvedValueOnce({ theme: 'epl' })
  click('다시 시도')
  expect((await screen.findByTestId('prep-board')).textContent).toBe('epl')
  expect(rpcMock).toHaveBeenCalledTimes(3)
  expect(screen.queryByText('판을 준비하고 있어요')).toBeNull()
})

test('local_prepare_called_once', async () => {
  rpcMock.mockResolvedValueOnce({ theme: 'a' })
  renderLocal('prep-fake')
  expect((await screen.findByTestId('prep-board')).textContent).toBe('a')
  await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1))
})
