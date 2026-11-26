import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GameProps } from '../ui.ts'
import { logic, type Action, type Puzzle, type State } from './logic.ts'

vi.mock('../../lib/footballSearch.ts', () => ({
  searchFootballPlayers: vi.fn(async () => [
    { id: 'Q615', name_ko: '리오넬 메시', name_en: 'Lionel Messi', nation_id: null, position: 'FW', birth_year: 1987 },
    { id: 'Q11571', name_ko: '크리스티아누 호날두', name_en: 'Cristiano Ronaldo', nation_id: null, position: 'FW', birth_year: 1985 },
  ]),
}))

const { Game } = await import('./Game.tsx')

const ctx = { now: 0, startedAt: 0, deadline: null }
const P: Puzzle = {
  id: 'Q615', nameKo: '리오넬 메시', nameEn: 'Lionel Messi', tier: 'easy', mode: 'challenge',
  lines: [[2004, 2021, 'FC Barcelona', 0], [2021, 2023, 'Paris Saint-Germain FC', 0], [2023, null, 'Inter Miami CF', 1]],
}

function run(p: Puzzle, ...actions: Action[]): State {
  let s = logic.initState(p, ctx)
  for (const a of actions) {
    const r = logic.apply(p, s, a, ctx)
    if ('error' in r) throw new Error(r.error)
    s = r.state
  }
  return s
}

function props(over: Partial<GameProps>): GameProps {
  return {
    publicState: logic.publicState(run(P)), finished: false, score: null, busy: false, error: null,
    onAction: vi.fn(), remainingMs: null, ...over,
  }
}

describe('career-quiz Game', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('챌린지: 첫 줄만 보이고 나머지는 가린다, 한 줄 열기', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    const lines = within(screen.getByRole('list', { name: '경력' })).getAllByRole('listitem')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toHaveTextContent('2004–2021FC Barcelona')
    expect(lines[1]).toHaveTextContent('2021–2023■■■')
    expect(screen.queryByText(/Paris/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /한 줄 열기/ }))
    expect(onAction).toHaveBeenCalledWith({ type: 'open' })
  })

  test('일반: 전부 보이고 임대 표시, 줄 열기 버튼 없음', () => {
    render(<Game {...props({ publicState: logic.publicState(run({ ...P, mode: 'normal' })) })} />)
    expect(screen.getByText('Inter Miami CF')).toBeInTheDocument()
    expect(screen.getByText('임대')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /한 줄 열기/ })).toBeNull()
  })

  test('검색해서 고르면 QID와 이름으로 답한다', async () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '메시' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    fireEvent.click(screen.getByRole('option', { name: /Lionel Messi/ }))
    expect(onAction).toHaveBeenCalledWith({ type: 'guess', id: 'Q615', name: 'Lionel Messi' })
  })

  test('이미 답한 선수는 후보에서 뺀다', async () => {
    const s = run(P, { type: 'guess', id: 'Q11571', name: '크리스티아누 호날두' })
    render(<Game {...props({ publicState: logic.publicState(s) })} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ro' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('남은 기회 7')).toBeInTheDocument()
  })

  test('힌트는 3번 답한 뒤', () => {
    const wrong = (n: number): Action => ({ type: 'guess', id: `Q${9000 + n}`, name: `선수${n}` })
    const { rerender } = render(<Game {...props({ publicState: logic.publicState(run(P, wrong(1), wrong(2))) })} />)
    expect(screen.getByRole('button', { name: /3번 답한 뒤/ })).toBeDisabled()
    rerender(<Game {...props({ publicState: logic.publicState(run(P, wrong(1), wrong(2), wrong(3))) })} />)
    expect(screen.getByRole('button', { name: '힌트(이니셜) -3점' })).toBeEnabled()
  })

  test('끝나면 정답과 전체 경력, 점수', () => {
    const s = run(P, { type: 'guess', id: 'Q615', name: '메시' })
    render(<Game {...props({ publicState: logic.publicState(s), finished: true, score: 10, reveal: logic.reveal(P) })} />)
    expect(screen.getByText('Lionel Messi', { selector: '.cq-ans' })).toBeInTheDocument()
    expect(screen.getByText('1줄 보고 정답')).toBeInTheDocument()
    expect(screen.getByText('10점')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '정답 선수의 경력' })).getByText('Paris Saint-Germain FC')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
