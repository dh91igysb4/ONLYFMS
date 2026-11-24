import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { conditionsAt } from './clock.ts'
import { decodeOutfit } from './outfit.ts'

vi.mock('./scene.ts', async (orig) => ({
  ...(await orig<typeof import('./scene.ts')>()),
  drawWorld: vi.fn(),
  releaseSceneCache: vi.fn(),
}))

import { drawWorld, releaseSceneCache } from './scene.ts'
import { Preview } from './Preview.tsx'
import { DEFAULT_AREAS } from './data.ts'

/** 실제 10초 경계에 맞춘, 날씨가 정해진 시각 */
function timeWith(weather: 'sun' | 'rain'): number {
  for (let t = 1_800_000_000_000; ; t += 1_440_000) if (conditionsAt(t).weather === weather) return t
}

let observers: { cb: IntersectionObserverCallback; disconnected: boolean }[] = []
class FakeIO {
  private entry: { cb: IntersectionObserverCallback; disconnected: boolean }
  constructor(cb: IntersectionObserverCallback) {
    this.entry = { cb, disconnected: false }
    observers.push(this.entry)
  }
  observe() {}
  unobserve() {}
  disconnect() { this.entry.disconnected = true }
  takeRecords() { return [] }
}
function intersect(on: boolean) {
  act(() => {
    for (const o of observers) o.cb([{ isIntersecting: on } as IntersectionObserverEntry], {} as IntersectionObserver)
  })
}
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

const onFail = vi.fn()
const draws = () => vi.mocked(drawWorld).mock.calls.length
const lastScene = () => vi.mocked(drawWorld).mock.calls.at(-1)![1]
const lastSize = () => vi.mocked(drawWorld).mock.calls.at(-1)![2]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(timeWith('sun'))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({}) as unknown as CanvasRenderingContext2D)
  vi.stubGlobal('IntersectionObserver', FakeIO)
  observers = []
  localStorage.clear()
  vi.mocked(drawWorld).mockReset()
  vi.mocked(releaseSceneCache).mockReset()
  onFail.mockReset()
  setHidden(false)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const mount = (size = 320, online: { id: string; handle: string; area: string; act: 'walk' | 'fish'; tx: number; ty: number }[] = []) =>
  render(<Preview userId="u1" records={[]} size={size} onFail={onFail} online={online} />)

describe('Preview', () => {
  test('접속 중 친구가 있으면 요약 문구, 없으면 없음', () => {
    const { container, unmount } = mount(320, [{ id: 'u2', handle: 'son', area: 'forest', act: 'fish', tx: 1, ty: 1 }])
    expect(container.querySelector('.home-valley-online')?.textContent).toBe('접속 중 1명 · son 숲에서 낚시 중')
    unmount()
    const again = mount(320, [])
    expect(again.container.querySelector('.home-valley-online')).toBeNull()
  })

  test('마운트하면 대기 장면을 한 번 그린다', () => {
    mount()
    expect(draws()).toBe(1)
    const s = lastScene()
    expect(s.phase).toBe('idle')
    expect(s.bobber).toBeNull()
    expect(s.bar).toBeNull()
    expect(s.fade).toBe(0)
    expect(s.hudTop).toBe(0)
    expect(s.teleporterOn).toBe(false)
    expect(s.outfit).toEqual(decodeOutfit(''))
    expect([...s.opened].sort()).toEqual([...DEFAULT_AREAS].sort())
    expect(s.player.moving).toBe(false)
  })

  test('size 320 → 배율 2: 캔버스 160×160(논리), CSS 320px로 확대', () => {
    const { container } = mount(320)
    const c = container.querySelector('canvas')!
    expect(c.width).toBe(160)
    expect(c.height).toBe(160)
    expect(c.style.width).toBe('320px')
    expect(lastSize()).toEqual({ w: 160, h: 160 })
  })

  test('캔버스는 aria-hidden이고 포인터 처리가 없다', () => {
    const { container } = mount()
    const c = container.querySelector('canvas')!
    expect(c.getAttribute('aria-hidden')).toBe('true')
    expect(c.onpointerdown).toBeNull()
    expect(c.ontouchstart ?? null).toBeNull()
  })

  test('맑은 날: 9초에는 다시 그리지 않고 10초에 한 번 더', () => {
    mount()
    act(() => { vi.advanceTimersByTime(9_000) })
    expect(draws()).toBe(1)
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(draws()).toBe(2)
  })

  test('비 오는 날: 100ms마다', () => {
    vi.setSystemTime(timeWith('rain'))
    mount()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(draws()).toBeGreaterThanOrEqual(10)
  })

  test('탭이 숨으면 그리지 않고, 다시 보이면 즉시 한 번 그린다', () => {
    mount()
    setHidden(true)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(draws()).toBe(1)
    setHidden(false)
    expect(draws()).toBe(2)
  })

  test('화면 밖으로 나가면 그리지 않는다', () => {
    mount()
    intersect(false)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(draws()).toBe(1)
    intersect(true)
    expect(draws()).toBe(2)
  })

  test('언마운트하면 타이머·관찰자를 정리하고 장면 캐시를 놓는다', () => {
    const { unmount } = mount()
    unmount()
    expect(releaseSceneCache).toHaveBeenCalledTimes(1)
    expect(observers.every((o) => o.disconnected)).toBe(true)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(draws()).toBe(1)
  })

  test('getContext가 null이면 onFail 한 번, 예외 없음', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => null)
    mount()
    expect(onFail).toHaveBeenCalledTimes(1)
    expect(draws()).toBe(0)
  })

  test('drawWorld가 던지면 onFail 한 번, 그 뒤로 다시 그리지 않는다', () => {
    vi.mocked(drawWorld).mockImplementation(() => { throw new Error('boom') })
    mount()
    expect(onFail).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(draws()).toBe(1)
    expect(onFail).toHaveBeenCalledTimes(1)
  })
})
