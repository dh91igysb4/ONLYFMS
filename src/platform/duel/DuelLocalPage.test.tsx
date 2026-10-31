import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  const { withHiddenDuel } = await import('../../test-fixtures/duel.ts')
  const withHidden = withHiddenDuel(real)
  return { ...withHidden, getDuel: (id: string) => (id === 'opt-fake' ? fake : withHidden.getDuel(id)) }
})
vi.mock('../../games/ui.ts', async (orig) => {
  const real = await orig<typeof import('../../games/ui.ts')>()
  return { ...real, getDuelComponent: (id: string) => (id === 'opt-fake' ? () => null : real.getDuelComponent(id === 'hidden-duel' ? 'yacht' : id)) }
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
