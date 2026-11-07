import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, onTestFinished, test, vi, type Mock } from 'vitest'
import { Game } from './Game.tsx'
import { logic, type State } from './logic.ts'
import { getCourse } from './course.ts'
import { decodeInputs } from './input.ts'
import { KEY_STEP, MAX_ACTION_TICKS, MAX_CATCHUP, SEND_TICKS, TICK_HZ } from './constants.ts'
import type { SimState } from './sim.ts'
import { createScene } from './render/scene.ts'
import { rngFromSeed } from '../../shared/rng.ts'
import type { GameProps } from '../ui.ts'

vi.mock('./render/scene.ts', () => ({
  createScene: vi.fn(() => ({ render: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
}))

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
// 시드 1: 첫 블록이 col 1, row 55 (그 열로 가면 328틱에 hit). 120 m 근처에서도 30틱은 산다.
const PUZZLE = logic.pickPuzzle(rngFromSeed(new Uint8Array(16).fill(1)), {})
const INITIAL: State = logic.initState(PUZZLE, ctx)

function props(over: Partial<GameProps> = {}): GameProps {
  return {
    publicState: logic.publicState(INITIAL), finished: false, score: null, busy: false, error: null,
    onAction: vi.fn(), remainingMs: null, ...over,
  }
}

// ---- 가짜 시계: performance.now와 rAF를 직접 돌린다. setTimeout은 vitest 가짜 타이머.
const TICK_MS = 1000 / TICK_HZ
let now = 0
let timerNow = 0
let rafId = 0
let rafQ = new Map<number, FrameRequestCallback>()
let rect = { left: 0, top: 0, width: 390, height: 600 }
let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  now = 1000
  timerNow = 1000
  rafId = 0
  rafQ = new Map()
  rect = { left: 0, top: 0, width: 390, height: 600 }
  visibility = 'visible'
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQ.set(++rafId, cb)
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQ.delete(id)
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON() {} }) as DOMRect,
  )
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.mocked(createScene).mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (document as unknown as { visibilityState?: unknown }).visibilityState
})

/** 한 프레임: 시계를 dt만큼 옮기고 대기 중인 rAF 콜백을 부른다. */
function frame(dt = TICK_MS) {
  act(() => {
    now += dt
    const t = Math.floor(now)
    vi.advanceTimersByTime(t - timerNow)
    timerNow = t
    const cbs = [...rafQ.values()]
    rafQ.clear()
    for (const cb of cbs) cb(now)
  })
}
function frames(n: number) {
  for (let i = 0; i < n; i++) frame()
}
const advance = (ms: number) => frames(Math.round(ms / TICK_MS))

async function mount(p: GameProps) {
  const r = render(<Game {...p} />)
  await settle()
  return r
}
async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled()
  })
}

const canvas = () => screen.getByLabelText('볼 런 화면')
const scene = (k = -1) => vi.mocked(createScene).mock.results.at(k)!.value as {
  render: Mock; resize: Mock; dispose: Mock
}
const lastCur = (): SimState => scene().render.mock.calls.at(-1)![1]
const batches = (onAction: Mock): number[][] =>
  onAction.mock.calls.map(([a]) => a).filter((a) => a.type === 'i').map((a) => a.d)
const reps = (d: number[]): number => d.reduce((s, v, k) => (k % 2 === 1 ? s + v : s), 0)
const lastValue = (d: number[]): number => d[d.length - 2]

describe('ball-run Game', () => {
  test('waits for first touch', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    expect(screen.getByText('화면을 눌러 시작')).toBeInTheDocument()
    advance(2000)
    expect(onAction).not.toHaveBeenCalled()
    expect(screen.getByText('화면을 눌러 시작')).toBeInTheDocument()
  })

  test('sends 30-tick batches', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    expect(screen.queryByText('화면을 눌러 시작')).not.toBeInTheDocument()
    advance(1000)
    expect(onAction).toHaveBeenCalledTimes(2)
    for (const [a] of onAction.mock.calls) {
      expect(a.type).toBe('i')
      expect(reps(a.d)).toBe(SEND_TICKS)
    }
  })

  test('maps drag to target', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(canvas(), { clientX: 295, pointerId: 1 })
    advance(500)
    const b = batches(onAction)
    expect(b).toHaveLength(1)
    expect(lastValue(b[0])).toBe(3000)
  })

  test('flushes on death', async () => {
    const course = getCourse(PUZZLE.seed)
    let block: [number, number] | null = null
    for (let row = 0; row < 400 && !block; row++) {
      for (let col = -3; col <= 3; col++) if (course.cell(col, row).block) { block = [col, row]; break }
    }
    expect(block).not.toBeNull()
    const onAction = vi.fn()
    await mount(props({ onAction }))
    // 블록 열 중심으로: dx = col * 1000 / DRAG_SPAN(6000) * 폭(390)
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(canvas(), { clientX: 100 + (block![0] * 1000 * 390) / 6000, pointerId: 1 })
    let dead: SimState | null = null
    for (let i = 0; i < 1200 && !dead; i++) {
      frame()
      if (lastCur().dead !== null) dead = lastCur()
    }
    expect(dead?.dead).toBe('hit')
    // 사망 틱이 담긴 프레임 안에서 남은 입력이 모두 나갔다
    const b = batches(onAction)
    const total = b.reduce((s, d) => s + reps(d), 0)
    expect(total).toBe(dead!.tick)
    expect(reps(b.at(-1)!)).toBe(dead!.tick % SEND_TICKS || SEND_TICKS)
    // 같은 행동을 플랫폼처럼 적용하면 같은 틱에 죽는다
    let st = INITIAL
    for (const [a] of onAction.mock.calls) {
      const r = logic.apply(PUZZLE, st, a, ctx)
      if ('error' in r) throw new Error(r.error)
      st = r.state
    }
    expect(st.sim).toEqual(dead)
    // 이후 전송 없음, 사망 연출은 계속 그린다
    const calls = onAction.mock.calls.length
    const renders = scene().render.mock.calls.length
    advance(2000)
    expect(onAction).toHaveBeenCalledTimes(calls)
    expect(scene().render.mock.calls.length).toBeGreaterThan(renders + 30)
  })

  test('pause stops ticks', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    advance(200)
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    // 일시정지에 들어가며 모아 둔 입력을 보낸다
    expect(batches(onAction)).toHaveLength(1)
    expect(reps(batches(onAction)[0])).toBe(12)
    expect(screen.getByText('계속하려면 누르기')).toBeInTheDocument()
    const tick = lastCur().tick
    advance(2000)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(lastCur().tick).toBe(tick)
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    expect(screen.queryByText('계속하려면 누르기')).not.toBeInTheDocument()
    advance(1000)
    expect(batches(onAction).length).toBe(3)
  })

  test('pause overlay resumes when pressed', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    advance(100)
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    fireEvent.click(screen.getByText('계속하려면 누르기'))
    const tick = lastCur().tick
    advance(100)
    expect(lastCur().tick).toBe(tick + 6)
  })

  test('pauses when the tab is hidden and resumes only on tap', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    advance(500)
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    const calls = onAction.mock.calls.length
    const tick = lastCur().tick
    advance(10_000)
    expect(onAction).toHaveBeenCalledTimes(calls)
    expect(lastCur().tick).toBe(tick)
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    // 돌아와도 탭하기 전에는 한 틱도 가지 않는다
    expect(screen.getByText('계속하려면 누르기')).toBeInTheDocument()
    advance(2000)
    expect(lastCur().tick).toBe(tick)
    fireEvent.click(screen.getByText('계속하려면 누르기'))
    // 재개 직후 첫 프레임은 정확히 1틱 (acc가 초기화됐다)
    frame()
    expect(lastCur().tick - tick).toBe(1)
  })

  test('does not pause on hidden before the first touch or after death', async () => {
    await mount(props())
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(screen.queryByText('계속하려면 누르기')).not.toBeInTheDocument()
    expect(screen.getByText('화면을 눌러 시작')).toBeInTheDocument()
  })

  test('window blur releases held keys and pauses', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    frames(5)
    act(() => { window.dispatchEvent(new Event('blur')) })
    const tick = lastCur().tick
    expect(tick).toBeGreaterThanOrEqual(5)
    expect(screen.getByText('계속하려면 누르기')).toBeInTheDocument()
    // 멈추며 모아 둔 입력을 보냈고, 이후 움직임·틱이 없다
    const held = lastValue(batches(onAction).at(-1)!)
    expect(held).toBe(tick * KEY_STEP)
    advance(2000)
    expect(lastCur().tick).toBe(tick)
    // 재개해도 키는 놓인 것으로 취급돼 타깃이 더 움직이지 않는다
    fireEvent.click(screen.getByText('계속하려면 누르기'))
    advance(1000)
    expect(lastCur().tick).toBeGreaterThan(tick)
    for (const d of batches(onAction).slice(1)) expect(decodeInputs(d)!.every((v) => v === held)).toBe(true)
  })

  test('never sends a batch over 120 ticks', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    advance(200)
    const tick = lastCur().tick
    frame(3000) // rAF가 3초 동안 오지 않았다
    expect(lastCur().tick - tick).toBeLessThanOrEqual(MAX_CATCHUP)
    advance(1000)
    expect(onAction).toHaveBeenCalled()
    for (const d of batches(onAction)) expect(reps(d)).toBeLessThanOrEqual(MAX_ACTION_TICKS)
  })

  test('ignores a second pointer while dragging', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(canvas(), { clientX: 165, pointerId: 1 }) // +1000
    fireEvent.pointerDown(canvas(), { clientX: 300, pointerId: 2 })
    fireEvent.pointerMove(canvas(), { clientX: 390, pointerId: 2 })
    fireEvent.pointerUp(canvas(), { clientX: 390, pointerId: 2 })
    advance(500)
    expect(lastValue(batches(onAction)[0])).toBe(1000)
    fireEvent.pointerMove(canvas(), { clientX: 230, pointerId: 1 }) // 첫 손가락은 아직 잡고 있다: +2000
    advance(500)
    expect(lastValue(batches(onAction)[1])).toBe(2000)
  })

  test('resizes renderer on window resize', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    // 첫 render 전에 resize
    const s = scene()
    expect(s.resize).toHaveBeenCalledWith(390, 600, expect.any(Number))
    frame()
    expect(s.render).toHaveBeenCalled()
    expect(s.resize.mock.invocationCallOrder[0]).toBeLessThan(s.render.mock.invocationCallOrder[0])
    rect = { left: 0, top: 0, width: 780, height: 500 }
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(s.resize).toHaveBeenLastCalledWith(780, 500, expect.any(Number))
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(canvas(), { clientX: 295, pointerId: 1 }) // 195 / 780 * 6000
    advance(500)
    expect(lastValue(batches(onAction)[0])).toBe(1500)
  })

  test('stops and disposes on unmount', async () => {
    const onAction = vi.fn()
    const { unmount } = await mount(props({ onAction }))
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    advance(200)
    const calls = onAction.mock.calls.length
    unmount()
    advance(2000)
    expect(onAction).toHaveBeenCalledTimes(calls)
    expect(scene().dispose).toHaveBeenCalledTimes(1)
    expect(rafQ.size).toBe(0)
  })

  test('survives a StrictMode remount on the same canvas', async () => {
    const onAction = vi.fn()
    render(<StrictMode><Game {...props({ onAction })} /></StrictMode>)
    await settle()
    const made = vi.mocked(createScene).mock.results.length
    const disposed = vi.mocked(createScene).mock.results
      .reduce((n, r) => n + (r.value as { dispose: Mock }).dispose.mock.calls.length, 0)
    expect(made - disposed).toBe(1)
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    advance(1000)
    expect(onAction).toHaveBeenCalledTimes(2)
  })

  test('shows fallback when WebGL fails', async () => {
    vi.mocked(createScene).mockImplementationOnce(() => { throw new Error('no webgl') })
    const onAction = vi.fn()
    await mount(props({ onAction }))
    expect(screen.getByText('이 기기에서는 3D 화면을 지원하지 않아요')).toBeInTheDocument()
    expect(screen.queryByText('화면을 눌러 시작')).not.toBeInTheDocument()
    advance(1000)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '포기' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'give_up' })
  })

  test('keyboard moves target', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    frames(10)
    fireEvent.keyUp(window, { key: 'ArrowRight' })
    frames(SEND_TICKS - 10)
    const b = batches(onAction)
    expect(b).toHaveLength(1)
    const targets = decodeInputs(b[0])!
    expect(targets[9]).toBe(10 * KEY_STEP)
    expect(lastValue(b[0])).toBe(10 * KEY_STEP)
  })

  test('speed banner', async () => {
    // 속도는 지나온 터널 수로 오른다. 화면과 같은 코스 인스턴스(getCourse 캐시)에서 120행부터 터널 하나를 지난 것으로 둔다.
    const BOOST_ROW = 120
    const boosts = vi.spyOn(getCourse(PUZZLE.seed), 'boostsBefore').mockImplementation((row) => (row >= BOOST_ROW ? 1 : 0))
    onTestFinished(() => boosts.mockRestore())
    // 점수는 틱으로 센다: 359틱 = 11점, 두 틱 뒤 361틱 = 12점.
    const near = { ...INITIAL, sim: { ...INITIAL.sim, tick: 359, z: BOOST_ROW * 1000 - 300 } }
    await mount(props({ publicState: logic.publicState(near) }))
    expect(screen.getByLabelText('점수')).toHaveTextContent('11')
    fireEvent.pointerDown(canvas(), { clientX: 100, pointerId: 1 })
    expect(screen.queryByText('속도 증가')).not.toBeInTheDocument()
    frames(2)
    expect(lastCur().speedLevel).toBe(1)
    expect(screen.getByText('속도 증가')).toBeInTheDocument()
    expect(screen.getByLabelText('점수')).toHaveTextContent('12')
    advance(1300)
    expect(screen.queryByText('속도 증가')).not.toBeInTheDocument()
  })

  test.each([
    ['hit', '장애물에 부딪혔어요'],
    ['fall', '떨어졌어요'],
    ['give_up', '포기했어요'],
  ] as const)('shows the result overlay when finished (%s)', async (dead, reason) => {
    const state: State = { ...INITIAL, sim: { ...INITIAL.sim, dead } }
    const p = props()
    const r = await mount(p)
    expect(screen.queryByText('게임 끝')).not.toBeInTheDocument()
    r.rerender(<Game {...p} publicState={logic.publicState(state)} finished score={137} />)
    expect(screen.getByText('게임 끝')).toBeInTheDocument()
    expect(screen.getByText('137점')).toBeInTheDocument()
    expect(screen.getByText(reason)).toBeInTheDocument()
    // 사망 연출을 그리는 캔버스는 그대로 있다
    expect(canvas()).toBeInTheDocument()
  })

  test('result overlay rounds the score down to an integer', async () => {
    const state: State = { ...INITIAL, sim: { ...INITIAL.sim, dead: 'hit' } }
    const p = props()
    const r = await mount(p)
    r.rerender(<Game {...p} publicState={logic.publicState(state)} finished score={137.9} />)
    expect(screen.getByText('137점')).toBeInTheDocument()
  })
})
