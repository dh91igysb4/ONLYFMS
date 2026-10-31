import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Game } from './Game.tsx'
import { logic, type YState } from './logic.ts'
import { allowed, scoreFor, total, type Sheet } from './scoring.ts'
import type { DuelGameProps } from '../ui.ts'

const base: YState = { sheets: [{}, {}], bonus: [0, 0], seat: 0, dice: [], rolls: 0 }

function props(view: YState, over: Partial<DuelGameProps> = {}): DuelGameProps {
  return {
    view, mySeat: view.seat, toMove: view.seat, finished: false, busy: false, error: null,
    onAction: vi.fn(), names: ['가가', '나나'], ...over,
  }
}

describe('yacht Game', () => {
  test('dice_keep_toggle_and_roll', () => {
    const p = props({ ...base, dice: [1, 2, 3, 4, 5], rolls: 1 })
    render(<Game {...p} />)
    const d1 = screen.getByRole('button', { name: '주사위 1' })
    expect(d1.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^주사위 2/ }))
    fireEvent.click(screen.getByRole('button', { name: /^주사위 4/ }))
    expect(screen.getByRole('button', { name: '주사위 2, 고정됨' }).getAttribute('aria-pressed')).toBe('true')
    // 한 번 더 눌러 풀었다 다시 고정
    fireEvent.click(screen.getByRole('button', { name: '주사위 4, 고정됨' }))
    fireEvent.click(screen.getByRole('button', { name: /^주사위 4/ }))
    fireEvent.click(screen.getByRole('button', { name: '굴리기 (1/3)' }))
    expect(p.onAction).toHaveBeenCalledWith({ type: 'roll', keep: [1, 3] })
  })

  test('score_preview_and_allowed_only', () => {
    const sheet: Sheet = { aces: 3 }
    const dice = [2, 2, 2, 5, 5]
    const p = props({ ...base, sheets: [sheet, {}], dice, rolls: 2 })
    render(<Game {...p} />)
    const ok = allowed(dice, sheet)
    const fh = screen.getByRole('button', { name: /풀 하우스/ })
    expect(fh.textContent).toContain(String(scoreFor(dice, 'fullHouse', sheet)))
    expect(ok).toContain('fullHouse')
    // 채워진 에이스 칸은 버튼이 아니다
    expect(screen.queryByRole('button', { name: /에이스/ })).toBeNull()
    fireEvent.click(fh)
    expect(p.onAction).toHaveBeenCalledWith({ type: 'score', category: 'fullHouse' })
    // 허용 칸 수만큼만 점수 버튼
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('button')).toHaveLength(ok.length)
  })

  test('joker_only_forced_cell_active', () => {
    const sheet: Sheet = { yacht: 50 }
    const dice = [4, 4, 4, 4, 4]
    render(<Game {...props({ ...base, sheets: [sheet, {}], dice, rolls: 1 })} />)
    const btns = within(screen.getByRole('table')).getAllByRole('button')
    expect(btns).toHaveLength(1)
    expect(btns[0].textContent).toContain('20')
  })

  test('not_my_turn_disabled', () => {
    const p = props({ ...base, dice: [1, 2, 3, 4, 5], rolls: 1 }, { mySeat: 1, toMove: 0 })
    render(<Game {...p} />)
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /굴리기/ }))
    expect(p.onAction).not.toHaveBeenCalled()
  })

  test('before_roll_cannot_score_or_keep', () => {
    render(<Game {...props(base)} />)
    expect(within(screen.getByRole('table')).queryAllByRole('button')).toHaveLength(0)
    expect((screen.getByRole('button', { name: '굴리기 (0/3)' }) as HTMLButtonElement).disabled).toBe(false)
    for (const b of screen.getAllByRole('button', { name: /^주사위/ })) expect((b as HTMLButtonElement).disabled).toBe(true)
  })

  test('first_roll_sends_empty_keep', () => {
    const p = props(base)
    render(<Game {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '굴리기 (0/3)' }))
    expect(p.onAction).toHaveBeenCalledWith({ type: 'roll', keep: [] })
  })

  test('hint_shown_after_third_roll', () => {
    render(<Game {...props({ ...base, dice: [1, 1, 2, 3, 4], rolls: 3 })} />)
    expect(screen.getByText(/칸을 골라 기록하세요/)).toBeTruthy()
  })

  test('no_rolls_left_disables_roll', () => {
    render(<Game {...props({ ...base, dice: [1, 1, 2, 3, 4], rolls: 3 })} />)
    expect((screen.getByRole('button', { name: '굴리기 (3/3)' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('totals_shown', () => {
    // 위 칸 합 = 3+6+9+12+15+18 = 63 → 보너스 35
    const sheet: Sheet = { aces: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18, choice: 20 }
    const other: Sheet = { aces: 1 }
    render(<Game {...props({ ...base, sheets: [sheet, other], bonus: [100, 0] }, { mySeat: 1, toMove: 0 })} />)
    expect(screen.getByTestId('bonus-0').textContent).toBe('35')
    expect(screen.getByTestId('bonus-1').textContent).toBe('0')
    expect(screen.getByTestId('yacht-bonus-0').textContent).toBe('100')
    expect(screen.getByTestId('total-0').textContent).toBe(String(total(sheet, 100)))
    expect(screen.getByTestId('total-1').textContent).toBe(String(total(other, 0)))
  })

  test('finished_disables_everything', () => {
    render(<Game {...props({ ...base, dice: [1, 2, 3, 4, 5], rolls: 1 }, { finished: true })} />)
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
  })

  test('logic_state_renders', () => {
    const s = logic.init(() => 0.5, {})
    render(<Game {...props(s)} />)
    expect(screen.getByText('가가')).toBeTruthy()
  })
})
