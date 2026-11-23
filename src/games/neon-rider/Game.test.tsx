import { StrictMode, useRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { Game } from './Game.tsx'
import { logic } from './logic.ts'
import { decodeHold } from './input.ts'
import { MAX_CATCHUP, SEND_TICKS, TICK_HZ } from './constants.ts'
import { createRenderer } from './render.ts'
import type { SimState } from './sim.ts'
import type { State } from './logic.ts'
import type { GameProps } from '../ui.ts'

vi.mock('./render.ts', () => ({
  createRenderer: vi.fn(() => ({ render: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
}))

// jsdom의 PointerEvent는 pointerId를 빠뜨릴 수 있어 MouseEvent를 상속한 최소 폴리필을 쓴다.
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
const PUZZLE = { seed: '00000001000000020000000300000004' }
const INITIAL = logic.initState(PUZZLE, ctx)

function props(over: Partial<GameProps> = {}): GameProps {
  return {
    publicState: logic.publicState(INITIAL), finished: false, score: null, busy: false, error: null,
    onAction: vi.fn(), remainingMs: null, ...over,
  }
}

const TICK_MS = 1000 / TICK_HZ
let now = 0
let rafId = 0
let rafQ = new Map<number, FrameRequestCallback>()
let visibility: DocumentVisibilityState = 'visible'
let rect = { width: 390, height: 600 }

beforeEach(() => {
  now = 1000
  rafId = 0
  rafQ = new Map()
  visibility = 'visible'
  rect = { width: 390, height: 600 }
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQ.set(++rafId, cb)
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQ.delete(id)
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ left: 0, top: 0, ...rect, right: rect.width, bottom: rect.height, x: 0, y: 0, toJSON() {} }) as DOMRect,
  )
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.mocked(createRenderer).mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (document as unknown as { visibilityState?: unknown }).visibilityState
})

function frame(dt = TICK_MS) {
  act(() => {
    now += dt
    const cbs = [...rafQ.values()]
    rafQ.clear()
    for (const cb of cbs) cb(now)
  })
}
function frames(n: number) {
  for (let i = 0; i < n; i++) frame()
}

function mount(p: GameProps) {
  return render(<Game {...p} />)
}

const canvas = () => screen.getByLabelText('네온 라이더 화면')
const renderer = (k = -1) => vi.mocked(createRenderer).mock.results.at(k)!.value as {
  render: Mock; resize: Mock; dispose: Mock
}
const lastCur = (): SimState => renderer().render.mock.calls.at(-1)![1]
const holds = (onAction: Mock): boolean[][] =>
  onAction.mock.calls.map(([a]) => a).filter((a) => a.type === 'i').map((a) => decodeHold(a.d)!)
const space = (type: 'keyDown' | 'keyUp', init: object = {}) => fireEvent[type](window, { key: ' ', code: 'Space', ...init })

describe('neon-rider Game', () => {
  test('waits for the first press', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    expect(canvas()).toBeInTheDocument()
    expect(screen.getByText('눌러서 시작')).toBeInTheDocument()
    frames(120)
    expect(lastCur().tick).toBe(0)
    expect(onAction).not.toHaveBeenCalled()
  })

  test('first press starts the run and holds from the first tick', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    expect(screen.queryByText('눌러서 시작')).not.toBeInTheDocument()
    frames(SEND_TICKS)
    expect(onAction).toHaveBeenCalledTimes(1)
    const [a] = onAction.mock.calls[0]
    expect(a.type).toBe('i')
    const h = decodeHold(a.d)!
    expect(h).toHaveLength(SEND_TICKS)
    expect(h.every(Boolean)).toBe(true)
  })

  test('pointercancel releases the hold', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    fireEvent.pointerCancel(canvas(), { pointerId: 1 })
    frames(SEND_TICKS)
    const h = holds(onAction)[0]
    expect(h).toHaveLength(SEND_TICKS)
    expect(h.every((b) => !b)).toBe(true)
  })

  test('tracks pointers by id', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    fireEvent.pointerDown(canvas(), { pointerId: 2 })
    fireEvent.pointerUp(canvas(), { pointerId: 2 })
    frames(10)
    fireEvent.pointerUp(canvas(), { pointerId: 1 })
    frames(20)
    const h = holds(onAction)[0]
    expect(h.slice(0, 10).every(Boolean)).toBe(true)
    expect(h.slice(10).every((b) => !b)).toBe(true)
  })

  test('pointerleave releases the hold', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(5)
    fireEvent.pointerLeave(canvas(), { pointerId: 1 })
    frames(SEND_TICKS - 5)
    const h = holds(onAction)[0]
    expect(h.slice(0, 5).every(Boolean)).toBe(true)
    expect(h.slice(5).every((b) => !b)).toBe(true)
  })

  test('window blur releases pointers and space', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    space('keyDown')
    frames(5)
    act(() => { window.dispatchEvent(new Event('blur')) })
    frames(SEND_TICKS - 5)
    const h = holds(onAction)[0]
    expect(h.slice(0, 5).every(Boolean)).toBe(true)
    expect(h.slice(5).every((b) => !b)).toBe(true)
  })

  test('hidden tab flushes pending input, stops ticks, and resumes released', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(10)
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(holds(onAction)).toHaveLength(1)
    expect(holds(onAction)[0]).toHaveLength(10)
    const tick = lastCur().tick
    frames(100)
    expect(lastCur().tick).toBe(tick)
    expect(onAction).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    frames(SEND_TICKS)
    expect(lastCur().tick).toBeGreaterThan(tick)
    const h = holds(onAction)[1]
    expect(h.every((b) => !b)).toBe(true)
  })

  test('a long rAF gap advances at most MAX_CATCHUP ticks', () => {
    mount(props())
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(2)
    const tick = lastCur().tick
    frame(500)
    expect(lastCur().tick - tick).toBeLessThanOrEqual(MAX_CATCHUP)
    expect(lastCur().tick).toBeGreaterThan(tick)
  })

  test('space holds and releases, ignores repeat, prevents scroll', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    const down = new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true })
    act(() => { window.dispatchEvent(down) })
    expect(down.defaultPrevented).toBe(true)
    expect(screen.queryByText('눌러서 시작')).not.toBeInTheDocument()
    frames(10)
    space('keyDown', { repeat: true })
    space('keyUp')
    space('keyDown', { repeat: true }) // 떼고 난 뒤의 반복 이벤트는 누름이 아니다
    frames(SEND_TICKS - 10)
    const h = holds(onAction)[0]
    expect(h.slice(0, 10).every(Boolean)).toBe(true)
    expect(h.slice(10).every((b) => !b)).toBe(true)
  })

  test('space is ignored while typing in an input', () => {
    mount(props())
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: ' ', code: 'Space' })
    expect(screen.getByText('눌러서 시작')).toBeInTheDocument()
    input.remove()
  })

  test('pause button stops ticks and sends pending input', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(6)
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    expect(holds(onAction)[0]).toHaveLength(6)
    expect(screen.getByText('계속하려면 누르기')).toBeInTheDocument()
    const tick = lastCur().tick
    frames(60)
    expect(lastCur().tick).toBe(tick)
    fireEvent.click(screen.getByText('계속하려면 누르기'))
    frames(3)
    expect(lastCur().tick).toBe(tick + 3)
  })

  test('ignores input and stops sending once finished', () => {
    const onAction = vi.fn()
    const p = props({ onAction })
    const r = mount(p)
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(5)
    const tick = lastCur().tick
    const calls = onAction.mock.calls.length
    r.rerender(<Game {...p} finished score={12} publicState={{ ...INITIAL, sim: { ...INITIAL.sim, dead: 'give_up' } }} />)
    fireEvent.pointerUp(canvas(), { pointerId: 1 })
    fireEvent.pointerDown(canvas(), { pointerId: 2 })
    space('keyDown')
    frames(SEND_TICKS * 2)
    expect(onAction).toHaveBeenCalledTimes(calls)
    expect(lastCur().tick).toBe(tick)
    expect(screen.getByText('게임 끝')).toBeInTheDocument()
    expect(screen.getByText('12점')).toBeInTheDocument()
    expect(screen.getByText('포기했어요')).toBeInTheDocument()
  })

  test('keeps rendering after finish for the death burst, then stops the loop', () => {
    const p = props()
    const r = mount(p)
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(2)
    r.rerender(<Game {...p} finished score={0} publicState={{ ...INITIAL, sim: { ...INITIAL.sim, dead: 'give_up' } }} />)
    const before = renderer().render.mock.calls.length
    frames(30)
    expect(renderer().render.mock.calls.length).toBeGreaterThan(before + 20)
    frame(4000)
    frame(100)
    expect(rafQ.size).toBe(0)
  })

  test('resizes the renderer before the first render and on window resize', () => {
    mount(props())
    const rd = renderer()
    expect(rd.resize).toHaveBeenCalledWith(390, 600, expect.any(Number))
    frame()
    expect(rd.resize.mock.invocationCallOrder[0]).toBeLessThan(rd.render.mock.invocationCallOrder[0])
    expect(rd.resize).toHaveBeenCalledTimes(1)
    vi.stubGlobal('devicePixelRatio', 2)
    rect = { width: 780, height: 500 }
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(rd.resize).toHaveBeenLastCalledWith(780, 500, 2)
    rect = { width: 300, height: 640 }
    act(() => { window.dispatchEvent(new Event('orientationchange')) })
    expect(rd.resize).toHaveBeenLastCalledWith(300, 640, 2)
  })

  test('unmount cancels rAF, removes listeners and disposes', () => {
    const onAction = vi.fn()
    const { unmount } = mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(5)
    const rd = renderer()
    unmount()
    expect(rafQ.size).toBe(0)
    expect(rd.dispose).toHaveBeenCalledTimes(1)
    space('keyDown')
    act(() => { window.dispatchEvent(new Event('blur')) })
    frames(60)
    expect(onAction).not.toHaveBeenCalled()
  })

  test('survives a StrictMode remount', () => {
    const onAction = vi.fn()
    render(<StrictMode><Game {...props({ onAction })} /></StrictMode>)
    const results = vi.mocked(createRenderer).mock.results
    const live = results.filter((r) => (r.value as { dispose: Mock }).dispose.mock.calls.length === 0)
    expect(live).toHaveLength(1)
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(SEND_TICKS)
    expect(onAction).toHaveBeenCalledTimes(1)
  })
  test('a tap that begins and ends within one frame still holds for one tick', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(3)
    fireEvent.pointerUp(canvas(), { pointerId: 1 })
    frames(3)
    fireEvent.pointerDown(canvas(), { pointerId: 2 })
    fireEvent.pointerUp(canvas(), { pointerId: 2 })
    frames(3)
    space('keyDown')
    space('keyUp')
    frames(SEND_TICKS - 9)
    const h = holds(onAction)[0]
    expect(h.slice(0, 9)).toEqual([true, true, true, false, false, false, true, false, false])
    expect(h[9]).toBe(true)
    expect(h.slice(10).every((b) => !b)).toBe(true)
  })

  test('the very first tap starts the run and counts as one held tick', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    fireEvent.pointerUp(canvas(), { pointerId: 1 })
    frames(SEND_TICKS)
    const h = holds(onAction)[0]
    expect(h[0]).toBe(true)
    expect(h.slice(1).every((b) => !b)).toBe(true)
  })

  test('space keyup releases even when focus moved into a text field', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    space('keyDown')
    frames(5)
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyUp(input, { key: ' ', code: 'Space' })
    frames(SEND_TICKS - 5)
    const h = holds(onAction)[0]
    expect(h.slice(0, 5).every(Boolean)).toBe(true)
    expect(h.slice(5).every((b) => !b)).toBe(true)
    input.remove()
  })

  test('re-renders one frame on resize after the loop has stopped', () => {
    const p = props()
    const r = mount(p)
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(2)
    r.rerender(<Game {...p} finished score={0} publicState={{ ...INITIAL, sim: { ...INITIAL.sim, dead: 'give_up' } }} />)
    frame()
    frame(4000)
    expect(rafQ.size).toBe(0)
    const rd = renderer()
    const before = rd.render.mock.calls.length
    rect = { width: 640, height: 360 }
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(rd.resize).toHaveBeenLastCalledWith(640, 360, expect.any(Number))
    expect(rd.render.mock.calls.length).toBe(before + 1)
    expect(rd.resize.mock.invocationCallOrder.at(-1)!).toBeLessThan(rd.render.mock.invocationCallOrder.at(-1)!)
    expect(rafQ.size).toBe(0)
  })

  test('resize while the loop runs does not draw an extra frame', () => {
    mount(props())
    frame()
    const rd = renderer()
    const before = rd.render.mock.calls.length
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(rd.render.mock.calls.length).toBe(before)
  })

  test('포기 버튼(일시정지 화면): 남은 입력을 보낸 뒤 give_up을 보낸다', () => {
    const onAction = vi.fn()
    mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(6)
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    fireEvent.click(screen.getByRole('button', { name: '포기' }))
    const types = onAction.mock.calls.map(([a]) => a.type)
    expect(types).toEqual(['i', 'give_up'])
    expect(holds(onAction)[0]).toHaveLength(6)
  })

  test('포기 버튼은 일시정지 중에만 보인다', () => {
    mount(props())
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(2)
    expect(screen.queryByRole('button', { name: '포기' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    expect(screen.getByRole('button', { name: '포기' })).toBeInTheDocument()
  })

  test('마우스로 누른 버튼은 초점을 가져가지 않는다(스페이스가 버튼을 누르지 않고 차를 누르게)', () => {
    mount(props())
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(2)
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: '일시정지' }))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    expect(fireEvent.mouseDown(screen.getByText('계속하려면 누르기'))).toBe(false)
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: '포기' }))).toBe(false)
  })

  test('오류 코드는 한국어 문구로 보여 준다', () => {
    const r = mount(props({ error: 'invalid_input' }))
    expect(screen.getByRole('alert').textContent).not.toContain('invalid_input')
    expect(screen.getByRole('alert').textContent).toMatch(/[가-힣]/)
    r.rerender(<Game {...props({ error: 'finished' })} />)
    expect(screen.getByRole('alert').textContent).not.toContain('finished')
    r.rerender(<Game {...props({ error: 'something_else' })} />)
    expect(screen.getByRole('alert').textContent).toMatch(/[가-힣]/)
  })

  test('플랫폼과 화면이 판 전체에서 같다: 일시정지·탭 숨김을 지나 죽을 때까지', () => {
    // 플랫폼 LocalRunner처럼 onAction마다 logic.apply를 적용하고 그 결과로 Game을 다시 그린다.
    const batches: boolean[][] = []
    const errors: string[] = []
    let platform: State = INITIAL
    function Harness() {
      const [state, setState] = useState<State>(INITIAL)
      const ref = useRef<State>(INITIAL)
      const onAction = (a: unknown) => {
        if (logic.isFinished(ref.current, ctx)) return
        const r = logic.apply(PUZZLE, ref.current, a as never, ctx)
        if ('error' in r) {
          errors.push(r.error)
          return
        }
        if ((a as { type: string }).type === 'i') batches.push(decodeHold((a as { d: number[] }).d)!)
        ref.current = r.state
        platform = r.state
        setState(r.state)
      }
      const finished = logic.isFinished(state, ctx)
      return (
        <Game
          publicState={logic.publicState(state)}
          finished={finished}
          score={finished ? logic.score(state, ctx) : null}
          busy={false}
          error={null}
          remainingMs={null}
          onAction={onAction}
        />
      )
    }
    render(<Harness />)
    fireEvent.pointerDown(canvas(), { pointerId: 1 })
    frames(100)
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    frames(20)
    fireEvent.click(screen.getByText('계속하려면 누르기'))
    fireEvent.pointerDown(canvas(), { pointerId: 2 })
    frames(100)
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    frames(20)
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    fireEvent.pointerDown(canvas(), { pointerId: 3 })
    for (let i = 0; i < 3000 && platform.sim.dead === null; i++) frame()
    frames(5)
    expect(errors).toEqual([])
    expect(platform.sim.dead).not.toBeNull()
    const cur = lastCur()
    expect(cur.dead).toBe(platform.sim.dead)
    expect(platform.sim).toEqual(cur)
    expect(platform.sim.tick).toBe(cur.tick)
    expect(batches.flat()).toHaveLength(platform.sim.tick) // 마지막 묶음이 죽은 틱에서 끝난다
    expect(screen.getByText('게임 끝')).toBeInTheDocument()
  })
})
