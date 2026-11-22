import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { Game } from './Game.tsx'
import { logic, scoreOf, type Action, type State } from './logic.ts'
import { getExam } from './exam.ts'
import { MAX_ACTION_TICKS, MAX_CATCHUP, PROCTORS, SEND_TICKS, TICK_HZ, TOOLS } from './constants.ts'
import { QUESTIONS } from './questions.ts'
import type { SimState } from './sim.ts'
import { createScene } from './render/scene.ts'
import type { GameProps } from '../ui.ts'

vi.mock('./render/scene.ts', () => ({
  createScene: vi.fn(() => ({ render: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
}))

const ctx = { now: 0, startedAt: 0, deadline: null }
const SEED = '0123456789abcdef0123456789abcdef'
const EXAM = getExam(SEED)
const INITIAL: State = logic.initState({ seed: SEED }, ctx)
const PHONE = TOOLS[3]!.name
const GLASSES = TOOLS[1]!.name

function withSim(over: Partial<SimState>): unknown {
  return logic.publicState({ seed: SEED, sim: { ...INITIAL.sim, ...over } })
}

function props(over: Partial<GameProps> = {}): GameProps {
  return {
    publicState: logic.publicState(INITIAL), finished: false, score: null, busy: false, error: null,
    onAction: vi.fn(), remainingMs: null, ...over,
  }
}

// ---- 가짜 시계: performance.now와 rAF를 직접 돌린다 (볼 런 Game.test.tsx와 같은 방식).
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
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  return r
}

const scene = (k = -1) => vi.mocked(createScene).mock.results.at(k)!.value as { render: Mock; resize: Mock; dispose: Mock }
const lastCur = (): SimState => scene().render.mock.calls.at(-1)![1]
const sent = (onAction: Mock): Action[] => onAction.mock.calls.map(([a]) => a as Action)
const lastSent = (onAction: Mock): Action => sent(onAction).at(-1)!
const btn = (name: string) => screen.getByRole('button', { name })
const start = () => fireEvent.click(btn('시작'))

describe('sneak-exam Game', () => {
  test('shows the proctor type before start and does not tick', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    expect(screen.getByText(/오늘의 감독관/)).toHaveTextContent(PROCTORS[EXAM.proctorType].name)
    expect(btn('시작')).toBeInTheDocument()
    advance(1000)
    expect(onAction).not.toHaveBeenCalled()
    expect(lastCur().tick).toBe(0)
  })

  test('sends a heartbeat every 30 ticks', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    expect(screen.queryByText(/오늘의 감독관/)).not.toBeInTheDocument()
    advance(500)
    expect(sent(onAction)).toEqual([{ type: 's', n: SEND_TICKS }])
  })

  test('sends a tool command with elapsed ticks', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    frames(10)
    fireEvent.click(btn(PHONE))
    expect(sent(onAction)).toEqual([{ type: 's', n: 10, c: ['t', 3] }])
    expect(btn(PHONE)).toHaveAttribute('aria-pressed', 'true')
  })

  test('toggles a tool off with the same button', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    fireEvent.click(btn(PHONE))
    frames(5)
    fireEvent.click(btn(PHONE))
    expect(lastSent(onAction)).toEqual({ type: 's', n: 5, c: ['t', 0] })
    expect(within(btn(PHONE)).getByText('숨기는 중')).toBeInTheDocument()
  })

  test('sends nothing for a tool press the logic would reject', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    fireEvent.click(btn(PHONE))
    const calls = onAction.mock.calls.length
    expect(btn(GLASSES)).toBeDisabled()
    fireEvent.click(btn(GLASSES))
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' }) // 키는 disabled를 거치지 않는다
    expect(onAction).toHaveBeenCalledTimes(calls)
    // 숨기는 중에도 다른 도구는 켤 수 없다
    fireEvent.click(btn(PHONE))
    expect(btn(GLASSES)).toBeDisabled()
    fireEvent.click(btn(GLASSES))
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    expect(onAction).toHaveBeenCalledTimes(calls + 1)
    expect(lastSent(onAction).c).toEqual(['t', 0])
  })

  test('reveals the answer when solved', async () => {
    const { container } = await mount(props())
    start()
    fireEvent.click(btn(PHONE))
    frames(119)
    expect(container.querySelector('[data-known="true"]')).toBeNull()
    frame()
    expect(lastCur().end).toBeNull()
    const known = container.querySelectorAll('[data-known="true"]')
    expect(known).toHaveLength(1)
    const q = QUESTIONS.find((x) => x.id === EXAM.questionIds[0])!
    expect(known[0]).toHaveTextContent(q.choices[EXAM.answers[0]])
    expect(screen.getByRole('progressbar', { name: '풀이 진행' })).toHaveAttribute('aria-valuenow', '100')
  })

  test('marks and unmarks', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    fireEvent.click(btn('3번 마킹'))
    expect(lastSent(onAction)).toEqual({ type: 's', n: 0, c: ['m', 0, 2] })
    expect(btn('3번 마킹')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn('3번 마킹'))
    expect(lastSent(onAction)).toEqual({ type: 's', n: 0, c: ['m', 0, -1] })
    expect(btn('3번 마킹')).toHaveAttribute('aria-pressed', 'false')
  })

  test('question navigation', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    expect(screen.getByText('문제 1 / 8')).toBeInTheDocument()
    expect(btn('이전 문제')).toBeDisabled()
    fireEvent.click(btn('다음 문제'))
    expect(lastSent(onAction)).toEqual({ type: 's', n: 0, c: ['q', 1] })
    expect(screen.getByText('문제 2 / 8')).toBeInTheDocument()
    expect(btn('이전 문제')).toBeEnabled()
  })

  test('submit needs a confirmation', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    frames(3)
    fireEvent.click(btn('제출'))
    expect(onAction).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '정말 제출할까요?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '정말 제출할까요?' }))
    expect(sent(onAction)).toEqual([{ type: 's', n: 3, c: ['x'] }])
  })

  test('sends nothing after the game ended', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    fireEvent.click(btn('제출'))
    fireEvent.click(screen.getByRole('button', { name: '정말 제출할까요?' }))
    const calls = onAction.mock.calls.length
    fireEvent.click(btn(PHONE))
    fireEvent.click(btn('1번 마킹'))
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    advance(2000)
    expect(onAction).toHaveBeenCalledTimes(calls)
    expect(screen.getByText('제출했어요')).toBeInTheDocument()
  })

  test('pauses', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    frames(12)
    fireEvent.click(btn('일시정지'))
    // 멈추며 모아 둔 틱을 보낸다
    expect(sent(onAction)).toEqual([{ type: 's', n: 12 }])
    const tick = lastCur().tick
    advance(1000)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(lastCur().tick).toBe(tick)
    fireEvent.click(screen.getByText('계속하려면 누르기'))
    advance(1000)
    expect(lastCur().tick).toBe(tick + 60)
    expect(onAction).toHaveBeenCalledTimes(3)
  })

  test('does not catch up after the tab was hidden', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    frames(10)
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    const tick = lastCur().tick
    const calls = onAction.mock.calls.length
    advance(5000)
    expect(onAction).toHaveBeenCalledTimes(calls)
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    frame(5000)
    const firstFrame = sent(onAction).slice(calls).reduce((s, a) => s + a.n, 0)
    expect(firstFrame).toBeLessThanOrEqual(MAX_CATCHUP)
    // 돌아오면 일시정지 상태다. 계속을 누른 첫 프레임은 1틱
    fireEvent.click(screen.getByText('계속하려면 누르기'))
    frame()
    expect(lastCur().tick - tick).toBe(1)
  })

  test('never sends a batch over 120 ticks', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    advance(200)
    const tick = lastCur().tick
    frame(3000)
    expect(lastCur().tick - tick).toBeLessThanOrEqual(MAX_CATCHUP)
    advance(1000)
    expect(onAction).toHaveBeenCalled()
    expect(sent(onAction).every((a) => a.n <= MAX_ACTION_TICKS)).toBe(true)
  })

  test('resumes from a mid-game public state', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction, publicState: withSim({ tick: 600, tool: 3, stow: 20 }) }))
    expect(screen.queryByText(/오늘의 감독관/)).not.toBeInTheDocument()
    expect(screen.getByText('계속하려면 누르기')).toBeInTheDocument()
    advance(500)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('계속하려면 누르기'))
    frames(19)
    expect(btn(PHONE)).toHaveAttribute('aria-pressed', 'true')
    frame()
    expect(btn(PHONE)).toHaveAttribute('aria-pressed', 'false')
    expect(lastCur().tick).toBe(620)
  })

  test('shows the edge indicator when the proctor is beside me', async () => {
    const beside = { ...INITIAL.sim.proctor, x: 0, z: 1000 }
    const r = await mount(props({ publicState: withSim({ proctor: beside }) }))
    expect(screen.getByTestId('se-edge')).toHaveAttribute('data-side', 'left')
    r.unmount()
    const front = { ...INITIAL.sim.proctor, x: 0, z: 8200 }
    await mount(props({ publicState: withSim({ proctor: front }) }))
    expect(screen.queryByTestId('se-edge')).not.toBeInTheDocument()
  })

  test('shows glasses and earphone effects', async () => {
    const r = await mount(props({ publicState: withSim({ tick: 10, tool: 1 }) }))
    expect(screen.getByTestId('se-stage')).toHaveAttribute('data-glasses', 'true')
    expect(screen.queryByLabelText('이어폰 켜짐')).not.toBeInTheDocument()
    r.unmount()
    await mount(props({ publicState: withSim({ tick: 10, tool: 2 }) }))
    expect(screen.getByTestId('se-stage')).not.toHaveAttribute('data-glasses', 'true')
    expect(screen.getByLabelText('이어폰 켜짐')).toBeInTheDocument()
  })

  test('shows suspicion and remaining time', async () => {
    await mount(props({ publicState: withSim({ tick: 7200 - 61 * 60, susp: 4567 }) }))
    expect(screen.getByRole('progressbar', { name: '의심도' })).toHaveAttribute('aria-valuenow', '45')
    expect(screen.getByTestId('se-time')).toHaveTextContent('1:01')
  })

  test('keyboard: tools, questions, marking, submit with confirmation, pause', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    fireEvent.keyDown(window, { key: '3', code: 'Digit3' })
    expect(lastSent(onAction).c).toEqual(['t', 3])
    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(lastSent(onAction).c).toEqual(['q', 1])
    fireEvent.keyDown(window, { key: 'ㄷ', code: 'KeyE' }) // 한글 자판에서도
    expect(lastSent(onAction).c).toEqual(['m', 1, 2])
    fireEvent.keyDown(window, { key: 'ArrowLeft', code: 'ArrowLeft' })
    expect(lastSent(onAction).c).toEqual(['q', 0])
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(screen.getByText('계속하려면 누르기')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(screen.queryByText('계속하려면 누르기')).not.toBeInTheDocument()
    const calls = onAction.mock.calls.length
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })
    expect(onAction).toHaveBeenCalledTimes(calls)
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })
    expect(lastSent(onAction).c).toEqual(['x'])
  })

  test('the platform reaches the same state from what was sent', async () => {
    const onAction = vi.fn()
    await mount(props({ onAction }))
    start()
    fireEvent.click(btn(PHONE))
    frames(125)
    fireEvent.click(btn(`${EXAM.answers[0] + 1}번 마킹`))
    fireEvent.click(btn('다음 문제'))
    frames(47)
    fireEvent.click(btn(PHONE))
    frames(50)
    fireEvent.click(btn('제출'))
    fireEvent.click(screen.getByRole('button', { name: '정말 제출할까요?' }))
    let st = INITIAL
    for (const a of sent(onAction)) {
      const r = logic.apply({ seed: SEED }, st, a, ctx)
      if ('error' in r) throw new Error(r.error)
      st = r.state
    }
    frame()
    expect(st.sim).toEqual(lastCur())
    expect(st.sim.end).toBe('submit')
    expect(scoreOf(st.sim, EXAM)).toBeGreaterThanOrEqual(100)
  })

  test('shows the result with the reason', async () => {
    await mount(props({ publicState: withSim({ tick: 900, tool: 3, susp: 10000, end: 'caught' }), finished: true, score: 0 }))
    expect(screen.getByText(/휴대폰 적발/)).toBeInTheDocument()
    expect(screen.getByText('0점')).toBeInTheDocument()
    expect(screen.getByText('0 / 8')).toBeInTheDocument()
  })

  test('waits for the caught animation before the result', async () => {
    // 휴대폰을 켠 채 의심도 9990: 다음 틱(감독관이 앞에서 보는 중, far) 적발
    await mount(props({ publicState: withSim({ tick: 10, tool: 3, susp: 9990 }) }))
    fireEvent.click(screen.getByText('계속하려면 누르기'))
    frame()
    expect(lastCur().end).toBe('caught')
    expect(screen.queryByText(/적발/)).not.toBeInTheDocument()
    advance(900)
    expect(screen.getByText(/휴대폰 적발/)).toBeInTheDocument()
  })

  test('stops and disposes on unmount', async () => {
    const onAction = vi.fn()
    const { unmount } = await mount(props({ onAction }))
    start()
    advance(200)
    const calls = onAction.mock.calls.length
    unmount()
    advance(2000)
    expect(onAction).toHaveBeenCalledTimes(calls)
    expect(scene().dispose).toHaveBeenCalledTimes(1)
    expect(rafQ.size).toBe(0)
  })

  test('shows a fallback without WebGL', async () => {
    vi.mocked(createScene).mockImplementationOnce(() => { throw new Error('no webgl') })
    const onAction = vi.fn()
    await mount(props({ onAction }))
    expect(screen.getByText('이 기기에서는 3D 화면을 지원하지 않아요')).toBeInTheDocument()
    advance(1000)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(btn('포기'))
    expect(onAction).toHaveBeenCalledWith({ type: 'give_up' })
  })
})
