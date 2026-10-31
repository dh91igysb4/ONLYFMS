import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Game } from './Game.tsx'
import { logic, snapshotOf, type Puzzle, type State } from './logic.ts'
import { PLAYERS } from './data.ts'
import { deHangul, norm, search } from './search.ts'
import type { GameProps } from '../ui.ts'

const ctx = { now: 0, startedAt: 0, deadline: null }
const idOf = (name: string) => PLAYERS.find((p) => p[1] === name)![0]
const ANSWER = snapshotOf(idOf('Erling Haaland'))!
const P: Puzzle = { answer: ANSWER, tier: 'easy', league: 'all' }

function play(...ids: number[]): State {
  let s = logic.initState(P, ctx)
  for (const id of ids) {
    const r = logic.apply(P, s, { type: 'guess', id }, ctx)
    if ('error' in r) throw new Error(r.error)
    s = r.state
  }
  return s
}

function props(over: Partial<GameProps>): GameProps {
  return {
    publicState: logic.publicState(play()), finished: false, score: null, busy: false, error: null,
    onAction: vi.fn(), remainingMs: null, ...over,
  }
}

const KANE = idOf('Harry Kane')
const YAMAL = idOf('Lamine Yamal')
const PEDRI = idOf('Pedri')

describe('who-are-ya search', () => {
  test('accent-insensitive and Korean keyboard layout', () => {
    expect(norm('Vinícius Júnior')).toBe('vinicius junior')
    expect(deHangul('ㅏ묻')).toBe('kane')
    expect(search('ㅏ묻', new Set()).map((p) => p.id)).toContain(KANE)
    expect(search('harry ka', new Set())[0].id).toBe(KANE)
    expect(search('harry ka', new Set([KANE])).map((p) => p.id)).not.toContain(KANE)
    expect(search('', new Set())).toEqual([])
  })
})

describe('who-are-ya Game', () => {
  test('renders guesses (newest first) with tiles from public state', () => {
    render(<Game {...props({ publicState: logic.publicState(play(KANE, YAMAL)) })} />)
    expect(screen.getByText('남은 기회 6')).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: '추측 기록' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Lamine Yamal')
    expect(rows[1]).toHaveTextContent('Harry Kane')
    // 타일 설명에 판정이 들어 있다 (Kane: 다른 리그, 나이 ▼ 등)
    expect(within(rows[1]).getByRole('img', { name: /^클럽 / })).toBeInTheDocument()
  })

  test('submits a guess action via search pick', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'harry kane' } })
    const opt = screen.getAllByRole('option')[0]
    expect(opt).toHaveTextContent('Harry Kane')
    fireEvent.click(opt)
    expect(onAction).toHaveBeenCalledWith({ type: 'guess', id: KANE })
    expect(box).toHaveValue('')
  })

  test('Enter picks the highlighted suggestion; guessed players are not suggested', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction, publicState: logic.publicState(play(KANE)) })} />)
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'harry kane' } })
    expect(screen.queryByRole('option', { name: /Harry Kane/ })).toBeNull()
    fireEvent.change(box, { target: { value: 'pedri' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onAction).toHaveBeenCalledWith({ type: 'guess', id: PEDRI })
  })

  test('hint button disabled before 3 wrong, enabled after; shows initials once used', () => {
    const onAction = vi.fn()
    const { rerender } = render(<Game {...props({ onAction, publicState: play(KANE, YAMAL) })} />)
    expect(screen.getByRole('button', { name: /힌트/ })).toBeDisabled()
    rerender(<Game {...props({ onAction, publicState: play(KANE, YAMAL, PEDRI) })} />)
    const hint = screen.getByRole('button', { name: /힌트/ })
    expect(hint).toBeEnabled()
    fireEvent.click(hint)
    expect(onAction).toHaveBeenCalledWith({ type: 'hint' })
    rerender(<Game {...props({ onAction, publicState: { ...play(KANE, YAMAL, PEDRI), initials: 'E. H.' } })} />)
    expect(screen.getByText('E. H.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /힌트/ })).toBeDisabled()
  })

  test('give up needs two taps', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    fireEvent.click(screen.getByRole('button', { name: '포기하고 정답 보기' }))
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '한 번 더 누르면 포기' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'give_up' })
  })

  test('finished: shows answer, result and score; no search', () => {
    const s = play(KANE, ANSWER.id)
    render(<Game {...props({ publicState: s, finished: true, score: 10, reveal: logic.reveal(P) })} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('2번 만에 정답')).toBeInTheDocument()
    expect(screen.getByText('10점')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '정답' })).getAllByRole('img', { name: /일치/ })).toHaveLength(5)
  })
})
