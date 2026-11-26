import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const rpc = vi.fn()
const inFn = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({
  supabaseUrl: 'http://localhost:54321',
  supabaseKey: 'k',
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ in: (...a: unknown[]) => inFn(...a) }) }),
  },
}))

import { Game } from './Game.tsx'
import type { View } from './logic.ts'
import type { DuelGameProps } from '../ui.ts'

const H = (id: string, label: string) => ({ id, kind: 'club', label })
const empty = (): View['cells'] => Array.from({ length: 9 }, () => ({ owner: null, name: null }))

function base(over: Partial<View> = {}): View {
  return {
    rows: [H('r0', '브라질'), H('r1', 'PL 우승'), H('r2', '벵거')],
    cols: [H('c0', '아스널'), H('c1', '첼시'), H('c2', '프랑스')],
    cells: empty(),
    steals: [5, 6],
    toMove: 0,
    drawOffer: null,
    canOffer: [true, true],
    last: null,
    quiet: 0,
    examples: null,
    theme: 'eng',
    ...over,
  }
}

function props(view: View, over: Partial<DuelGameProps> = {}): DuelGameProps {
  return {
    view, mySeat: 0, toMove: view.toMove, finished: false, busy: false, error: null,
    onAction: vi.fn(), names: ['가가', '나나'], ...over,
  }
}

const cellBtn = (i: number) => screen.getByTestId(`ttt-cell-${i}`) as HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers()
  rpc.mockReset()
  inFn.mockReset()
  inFn.mockResolvedValue({ data: [{ id: 'nat-fr', name_ko: '프랑스', name_en: 'France' }], error: null })
})
afterEach(() => vi.useRealTimers())

describe('tiki-taka-toe Game', () => {
  test('renders_headers_and_cells', () => {
    const cells = empty()
    cells[4] = { owner: 1, name: '앙리' }
    render(<Game {...props(base({ cells }))} />)
    for (const l of ['브라질', 'PL 우승', '벵거', '아스널', '첼시', '프랑스']) expect(screen.getByText(l)).toBeTruthy()
    for (let i = 0; i < 9; i++) expect(cellBtn(i)).toBeTruthy()
    expect(cellBtn(4).textContent).toContain('앙리')
  })

  test('pick_cell_search_submit', async () => {
    rpc.mockResolvedValue({
      data: [
        { id: 'p1', kind: 'player', name_ko: '티에리 앙리', name_en: 'Thierry Henry', nation_id: 'nat-fr', position: 'FW', birth_year: 1977, team_kind: null },
        { id: 'p2', kind: 'player', name_ko: null, name_en: 'Henry Other', nation_id: null, position: null, birth_year: 1990, team_kind: null },
      ],
      error: null,
    })
    const p = props(base())
    render(<Game {...p} />)
    fireEvent.click(cellBtn(1))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: '앙리' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(rpc).toHaveBeenCalledWith('football_search', { p_q: '앙리', p_kind: 'player', p_lim: 8 })
    const opt = within(dialog).getByRole('button', { name: /Thierry Henry/ }) // 선수 이름은 영어
    expect(opt.textContent).toContain('프랑스')
    expect(opt.textContent).toContain('1977')
    expect(within(dialog).getByRole('button', { name: /Henry Other/ })).toBeTruthy()
    fireEvent.click(opt)
    expect(p.onAction).toHaveBeenCalledWith({ type: 'guess', cell: 1, playerId: 'p1', name: 'Thierry Henry' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('steal_label_and_block', () => {
    const cells = empty()
    cells[0] = { owner: 1, name: '앙리' }
    cells[1] = { owner: 0, name: '피레스' }
    const a = render(<Game {...props(base({ cells, steals: [3, 6] }))} />)
    expect(cellBtn(0).textContent).toContain('스틸(남은 3번)')
    expect(cellBtn(0).disabled).toBe(false)
    expect(cellBtn(1).disabled).toBe(true)
    fireEvent.click(cellBtn(0))
    expect(within(screen.getByRole('dialog')).getByText(/스틸/)).toBeTruthy()
    a.unmount()
    render(<Game {...props(base({ cells, steals: [0, 6] }))} />)
    expect(cellBtn(0).textContent).toContain('스틸(남은 0번)')
    expect(cellBtn(0).disabled).toBe(true)
  })

  test('skip_and_draw_controls', async () => {
    const p = props(base())
    const a = render(<Game {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '턴 넘기기' }))
    expect(p.onAction).toHaveBeenLastCalledWith({ type: 'pass' })

    fireEvent.click(screen.getByRole('checkbox', { name: '무승부 제안' }))
    fireEvent.click(screen.getByRole('button', { name: '턴 넘기기' }))
    expect(p.onAction).toHaveBeenLastCalledWith({ type: 'pass', offerDraw: true })
    // 보낸 뒤에는 체크가 풀린다
    expect((screen.getByRole('checkbox', { name: '무승부 제안' }) as HTMLInputElement).checked).toBe(false)

    // 답하기에도 실린다
    rpc.mockResolvedValue({ data: [{ id: 'p1', kind: 'player', name_ko: '앙리', name_en: 'Henry', nation_id: null, position: null, birth_year: null, team_kind: null }], error: null })
    fireEvent.click(screen.getByRole('checkbox', { name: '무승부 제안' }))
    fireEvent.click(cellBtn(2))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '앙리' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Henry/ }))
    expect(p.onAction).toHaveBeenLastCalledWith({ type: 'guess', cell: 2, playerId: 'p1', name: 'Henry', offerDraw: true })
    a.unmount()

    // 상대 제안
    const q = props(base({ drawOffer: 1 }))
    const b = render(<Game {...q} />)
    expect(screen.getByText(/나나님이 무승부를 제안했어요/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '무승부 수락' }))
    expect(q.onAction).toHaveBeenCalledWith({ type: 'acceptDraw' })
    b.unmount()

    // 제안 못 하는 차례
    render(<Game {...props(base({ canOffer: [false, true] }))} />)
    expect((screen.getByRole('checkbox', { name: '무승부 제안' }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '무승부 수락' })).toBeNull()
  })

  test('not_my_turn_disables_controls', () => {
    const p = props(base({ toMove: 1, drawOffer: 0 }), { mySeat: 0 })
    render(<Game {...p} />)
    for (let i = 0; i < 9; i++) expect(cellBtn(i).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '턴 넘기기' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '무승부 수락' })).toBeNull()
  })

  test('examples_after_end', () => {
    const examples = Array.from({ length: 9 }, (_, i) => [`예시${i}가`, `예시${i}나`])
    render(<Game {...props(base({ examples }), { finished: true })} />)
    for (let i = 0; i < 9; i++) {
      expect(cellBtn(i).disabled).toBe(true)
      expect(within(screen.getByTestId(`ttt-examples-${i}`)).getByText(new RegExp(`예시${i}가`))).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: '턴 넘기기' })).toBeNull()
  })

  test('examples_duplicate_names_no_key_warning', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const examples = Array.from({ length: 9 }, () => ['같은 이름', '같은 이름'])
    render(<Game {...props(base({ examples }), { finished: true })} />)
    expect(within(screen.getByTestId('ttt-examples-0')).getAllByText('같은 이름')).toHaveLength(2)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
    spy.mockRestore()
  })

  test('theme_label_in_corner', () => {
    const a = render(<Game {...props(base())} />)
    expect(screen.getByTestId('ttt-corner').textContent).toBe('잉글랜드')
    a.unmount()
    const labels: [string, string][] = [['esp', '스페인'], ['ita', '이탈리아'], ['ger', '독일'], ['eur', '유럽 전체']]
    for (const [t, l] of labels) {
      const r = render(<Game {...props(base({ theme: t }))} />)
      expect(screen.getByTestId('ttt-corner').textContent).toBe(l)
      r.unmount()
    }
    // 테마를 모르면(옛 판) 비운다
    const c = render(<Game {...props(base({ theme: null }))} />)
    expect(screen.getByTestId('ttt-corner').textContent).toBe('')
    c.unmount()
    render(<Game {...props(base({ theme: 'zzz' }))} />)
    expect(screen.getByTestId('ttt-corner').textContent).toBe('')
  })

  test('last_move_line', () => {
    const a = render(<Game {...props(base({ last: { seat: 1, type: 'guess', cell: 3, name: '앙리', correct: false, steal: false } }))} />)
    expect(screen.getByText(/나나: 앙리 → 틀림/)).toBeTruthy()
    a.unmount()
    const b = render(<Game {...props(base({ last: { seat: 0, type: 'guess', cell: 3, name: '앙리', correct: true, steal: true } }))} />)
    expect(screen.getByText(/가가: 앙리 → 스틸 성공/)).toBeTruthy()
    b.unmount()
    render(<Game {...props(base({ last: { seat: 1, type: 'pass', offeredDraw: true } }))} />)
    expect(screen.getByText(/나나: 턴 넘김/)).toBeTruthy()
  })
})
