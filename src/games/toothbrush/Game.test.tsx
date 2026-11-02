import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { Game } from './Game.tsx'
import { logic, type PublicState } from './logic.ts'
import { rngFromSeed } from '../../shared/rng.ts'
import type { GameProps } from '../ui.ts'

// jsdom의 PointerEvent는 clientX·pointerId를 빠뜨릴 수 있어 MouseEvent를 상속한 최소 폴리필을 쓴다.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}
const OriginalPointerEvent = window.PointerEvent
beforeAll(() => {
  ;(window as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent
})
afterAll(() => {
  ;(window as unknown as { PointerEvent: unknown }).PointerEvent = OriginalPointerEvent
})

const ctx = { now: 0, startedAt: 0, deadline: null }
const PUZZLE = logic.pickPuzzle(rngFromSeed(new Uint8Array(16).fill(7)), {})
const INITIAL = logic.initState(PUZZLE, ctx)
const fresh = (): PublicState => logic.publicState(INITIAL)
const started = (): PublicState => {
  const r = logic.apply(PUZZLE, INITIAL, { type: 'b', s: [100, 100] }, ctx)
  if ('error' in r) throw new Error(r.error)
  return logic.publicState(r.state)
}

function props(over: Partial<GameProps> = {}): GameProps {
  return {
    publicState: fresh(), finished: false, score: null, busy: false, error: null,
    onAction: vi.fn(), remainingMs: null, ...over,
  }
}

let rect = { left: 0, top: 0, width: 480, height: 320 }
beforeEach(() => {
  rect = { left: 0, top: 0, width: 480, height: 320 }
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setInterval', 'clearInterval'] })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON() {} }) as DOMRect,
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const canvas = () => screen.getByLabelText('양치 화면')
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

/** onAction으로 보낸 문지르기 샘플 전부를 [x, y] 쌍으로 */
function sentSamples(onAction: Mock): [number, number][] {
  const out: [number, number][] = []
  for (const [a] of onAction.mock.calls) {
    if (a.type !== 'b') continue
    for (let k = 0; k < a.s.length; k += 2) out.push([a.s[k], a.s[k + 1]])
  }
  return out
}

describe('toothbrush Game', () => {
  test('renders_and_zone_buttons_disabled_before_start', () => {
    render(<Game {...props()} />)
    expect(canvas()).toBeInTheDocument()
    expect(screen.getByText('화면을 눌러 양치를 시작하세요')).toBeInTheDocument()
    expect(screen.getByText('남은 시간 60초')).toBeInTheDocument()
    expect(screen.getByText('잇몸 손상 0초')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(6)
    for (const b of buttons) expect(b).toBeDisabled()
    expect(screen.getByRole('button', { name: '바깥 0%' })).toBeInTheDocument()
  })

  test('no_actions_before_press', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    advance(500)
    expect(onAction).not.toHaveBeenCalled()
  })

  test('pointer_down_starts_and_sends_chunks', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    fireEvent.pointerDown(canvas(), { clientX: 100, clientY: 100, pointerId: 1 })
    advance(100)
    expect(onAction).toHaveBeenCalled()
    for (const [a] of onAction.mock.calls) {
      expect(a.type).toBe('b')
      expect(a.s.length).toBeLessThanOrEqual(60)
      expect(a.s.length % 2).toBe(0)
    }
    const s = sentSamples(onAction)
    expect(s.length).toBeGreaterThanOrEqual(5)
    expect(s.length).toBeLessThanOrEqual(7)
    for (const p of s) expect(p).toEqual([100, 100])
  })

  test('long_hold_splits_into_chunks_of_at_most_30', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    fireEvent.pointerDown(canvas(), { clientX: 10, clientY: 10, pointerId: 1 })
    // 탭이 잠깐 멈춘 것처럼 한 번에 오래 진행해도 묶음은 30샘플 이하
    advance(2000)
    for (const [a] of onAction.mock.calls) expect(a.s.length).toBeLessThanOrEqual(60)
    expect(sentSamples(onAction).length).toBeGreaterThan(60)
  })

  test('zone_button_sends_switch', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction, publicState: started() })} />)
    const btn = screen.getByRole('button', { name: /^위 씹는 면 \d+%$/ })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(onAction).toHaveBeenCalledWith({ type: 'z', zone: 2 })
  })

  test('ignores_second_pointer', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    fireEvent.pointerDown(canvas(), { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerDown(canvas(), { clientX: 400, clientY: 300, pointerId: 2 })
    fireEvent.pointerMove(canvas(), { clientX: 400, clientY: 300, pointerId: 2 })
    advance(100)
    const s = sentSamples(onAction)
    expect(s.length).toBeGreaterThan(0)
    expect(s.some(([x]) => x === 400)).toBe(false)
  })

  test('pointercancel_ends_contact', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    fireEvent.pointerDown(canvas(), { clientX: 100, clientY: 100, pointerId: 1 })
    advance(50)
    fireEvent.pointerCancel(canvas(), { pointerId: 1 })
    advance(100)
    const s = sentSamples(onAction)
    expect(s[s.length - 1]).toEqual([-1, -1])
  })

  test('maps_with_current_rect_after_resize', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    fireEvent.pointerDown(canvas(), { clientX: 0, clientY: 0, pointerId: 1 })
    advance(50)
    rect = { left: 0, top: 0, width: 240, height: 160 }
    fireEvent.pointerMove(canvas(), { clientX: 120, clientY: 80, pointerId: 1 })
    advance(100)
    const s = sentSamples(onAction)
    expect(s[s.length - 1]).toEqual([240, 160])
  })

  test('clamps_outside_points_to_edges', () => {
    const onAction = vi.fn()
    render(<Game {...props({ onAction })} />)
    fireEvent.pointerDown(canvas(), { clientX: 600, clientY: -20, pointerId: 1 })
    advance(100)
    const s = sentSamples(onAction)
    expect(s[s.length - 1]).toEqual([479, 0])
  })

  test('no_actions_after_unmount', () => {
    const onAction = vi.fn()
    const { unmount } = render(<Game {...props({ onAction })} />)
    fireEvent.pointerDown(canvas(), { clientX: 100, clientY: 100, pointerId: 1 })
    advance(100)
    unmount()
    onAction.mockClear()
    advance(300)
    expect(onAction).not.toHaveBeenCalled()
  })

  test('stops_after_finish', () => {
    const onAction = vi.fn()
    const { rerender } = render(<Game {...props({ onAction })} />)
    fireEvent.pointerDown(canvas(), { clientX: 100, clientY: 100, pointerId: 1 })
    advance(100)
    const done: PublicState = { ...started(), ticksLeft: 0, gumTicks: 130 }
    rerender(<Game {...props({ onAction, publicState: done, finished: true, score: 8.37 })} />)
    onAction.mockClear()
    advance(300)
    expect(onAction).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '양치 끝' })).toBeInTheDocument()
    expect(screen.getByText('8.37점')).toBeInTheDocument()
    expect(screen.getByText('잇몸 손상 2초')).toBeInTheDocument()
    expect(screen.getByText(/혀/)).toBeInTheDocument()
  })
})
