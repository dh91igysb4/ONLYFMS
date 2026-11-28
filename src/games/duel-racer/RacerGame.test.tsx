import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Controls } from './physics/controls.ts'

type Snap = Record<string, unknown> & { car: Record<string, unknown>; nitro: { gauge: number; burning: boolean } }
const h = vi.hoisted(() => ({
  snap: null as unknown as Snap,
  advanced: [] as Controls[],
  resets: 0,
  races: 0,
  sceneFail: false,
  rapierFail: false,
}))
const baseSnap = (): Snap => ({
  tick: -180, countdown: 3, progress: 0, finishTicks: null,
  car: { speed: 0, grounded: true, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } },
  nitro: { gauge: 0.3, burning: false },
})

vi.mock('./physics/rapier.ts', () => ({
  loadRapier: async () => {
    if (h.rapierFail) throw new Error('wasm')
    return {}
  },
}))
vi.mock('./race.ts', () => ({
  createRace: () => { h.races++; return { acc: 0, course: {} } },
  advance: (_r: unknown, _ms: number, c: Controls) => { h.advanced.push(c) },
  snapshot: () => h.snap,
  requestReset: () => { h.resets++ },
  disposeRace: () => {},
}))
vi.mock('./render/scene.ts', () => ({
  createScene: () => {
    if (h.sceneFail) throw new Error('webgl')
    return { draw: () => {}, resize: () => {}, dispose: () => {} }
  },
}))

import { RacerGame } from './RacerGame.tsx'

let frames: ((t: number) => void)[] = []
let now = 0
async function frame(ms = 200) {
  now += ms
  const q = frames
  frames = []
  await act(async () => { for (const f of q) f(now) })
}
async function loaded() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  await frame()
}

const onExit = vi.fn()
beforeEach(() => {
  h.snap = baseSnap()
  h.advanced = []
  h.resets = 0
  h.races = 0
  h.sceneFail = false
  h.rapierFail = false
  onExit.mockReset()
  frames = []
  now = 0
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mount = () => render(<RacerGame gameId="duel-racer" mode="practice" onExit={onExit} />)

test('shows loading, then the countdown', async () => {
  mount()
  expect(screen.getByText('불러오는 중…')).toBeTruthy()
  await loaded()
  expect(screen.getByTestId('racer-countdown').textContent).toBe('3')
})

test('HUD shows km/h, nitro cells and elapsed time', async () => {
  h.snap = { ...baseSnap(), tick: 3600, countdown: null, car: { ...baseSnap().car, speed: 50 }, nitro: { gauge: 0.6, burning: false } }
  mount()
  await loaded()
  await frame()
  expect(screen.getByTestId('racer-speed').textContent).toBe('180')
  expect(screen.getAllByTestId('nitro-cell-on')).toHaveLength(3)
  expect(screen.getAllByTestId(/nitro-cell/)).toHaveLength(5)
  expect(screen.getByTestId('racer-time').textContent).toBe('01:00.00')
})

test('finish shows the result and restarting makes a new race with a session best', async () => {
  mount()
  await loaded()
  h.snap = { ...baseSnap(), tick: 4260, countdown: null, finishTicks: 4260, progress: 1 }
  await frame()
  expect(screen.getByTestId('racer-result-time').textContent).toBe('01:11.00')
  fireEvent.click(screen.getByRole('button', { name: '다시 달리기' }))
  await loaded()
  expect(h.races).toBe(2)
  h.snap = { ...baseSnap(), tick: 4500, countdown: null, finishTicks: 4500, progress: 1 }
  await frame()
  expect(screen.getByTestId('racer-result-best').textContent).toBe('01:11.00')
})

test('WebGL failure shows a Korean error with an exit button', async () => {
  h.sceneFail = true
  mount()
  await loaded()
  expect(screen.getByText('이 브라우저에서는 레이스를 열 수 없어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '나가기' }))
  expect(onExit).toHaveBeenCalled()
})

test('Rapier failure shows the same error', async () => {
  h.rapierFail = true
  mount()
  await loaded()
  expect(screen.getByText('이 브라우저에서는 레이스를 열 수 없어요')).toBeTruthy()
})

test('window blur releases held keys', async () => {
  mount()
  await loaded()
  fireEvent.keyDown(window, { code: 'ArrowUp' })
  await frame()
  expect(h.advanced.at(-1)!.throttle).toBe(1)
  fireEvent.blur(window)
  await frame()
  expect(h.advanced.at(-1)!.throttle).toBe(0)
})

test('game keys do not scroll the page, other keys pass through', async () => {
  mount()
  await loaded()
  const space = new KeyboardEvent('keydown', { code: 'Space', cancelable: true })
  window.dispatchEvent(space)
  expect(space.defaultPrevented).toBe(true)
  const other = new KeyboardEvent('keydown', { code: 'KeyZ', cancelable: true })
  window.dispatchEvent(other)
  expect(other.defaultPrevented).toBe(false)
})

test('Escape exits and R resets', async () => {
  mount()
  await loaded()
  fireEvent.keyDown(window, { code: 'KeyR' })
  expect(h.resets).toBe(1)
  fireEvent.keyDown(window, { code: 'Escape' })
  expect(onExit).toHaveBeenCalled()
})

test('in the air the arrow keys turn and tilt instead of steering (tilt only for keys pressed after takeoff)', async () => {
  h.snap = { ...baseSnap(), tick: 100, countdown: null }
  mount()
  await loaded()
  // 땅에서 가속(W)을 누른 채 공중으로
  fireEvent.keyDown(window, { code: 'KeyW' })
  await frame()
  h.snap = { ...baseSnap(), tick: 120, countdown: null, car: { ...baseSnap().car, grounded: false } }
  await frame()
  await frame()
  expect(h.advanced.at(-1)!.pitch).toBe(0)
  expect(h.advanced.at(-1)!.throttle).toBe(1)
  // 공중에서 다시 누르면 기울인다
  fireEvent.keyUp(window, { code: 'KeyW' })
  fireEvent.keyDown(window, { code: 'KeyW' })
  fireEvent.keyDown(window, { code: 'KeyD' })
  await frame()
  const c = h.advanced.at(-1)!
  expect(c.yaw).toBe(1)
  expect(c.pitch).toBe(1)
  expect(c.steer).toBe(0)
})
