import { fireEvent, render, screen } from '@testing-library/react'
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

import { DuelLocalPage } from './DuelLocalPage.tsx'

beforeEach(() => { duelMock.mockReset(); rpcMock.mockReset() })

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

test('unknown_game', () => {
  renderLocal('nope')
  expect(screen.getByText('없는 게임이에요')).toBeTruthy()
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
  expect(screen.getAllByText(/플레이어 1/).length).toBeGreaterThan(0)
  expect(duelMock).not.toHaveBeenCalled()
  expect(rpcMock).not.toHaveBeenCalled()
  // 다시 하기
  click('다시 하기')
  expect(screen.queryByRole('region', { name: '결과' })).toBeNull()
  expect(screen.getByTestId('turn').textContent).toContain('플레이어 1 차례')
})
