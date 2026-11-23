import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { availableHeight, canvasScale, fitScene, Game } from './Game.tsx'
import { ApiError, world } from '../../lib/api.ts'
import { drawWorld, releaseSceneCache } from './scene.ts'
import { barResult } from './minigame.ts'
import { HOOK_WINDOW_MS, MIN_FIGHT_MS, SPECIES } from './data.ts'
import { price, type PendingView, type View } from './logic.ts'

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/api.ts')>()
  return { ...orig, world: vi.fn() }
})
vi.mock('./scene.ts', () => ({ drawWorld: vi.fn(), releaseSceneCache: vi.fn(), SCENE_W: 160, SCENE_H: 240 }))
vi.mock('./sprites.ts', () => ({
  spriteDataUrl: vi.fn((name: string, _scale: number, opts?: { silhouette?: boolean }) =>
    `data:${name}${opts?.silhouette ? ':silhouette' : ''}`),
}))
// 미니게임 결과만 테스트에서 정할 수 있게 하고 나머지는 실제 물리를 쓴다.
vi.mock('./minigame.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./minigame.ts')>()
  return { ...orig, barResult: vi.fn(orig.barResult) }
})

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

const worldMock = vi.mocked(world)
const actualMinigame = await vi.importActual<typeof import('./minigame.ts')>('./minigame.ts')

function makeView(over: Partial<View> = {}): View {
  return { gold: 1234, totalEarned: 0, rodTier: 1, bagTier: 1, areas: ['pier'], bag: [], dex: {}, pending: null, ...over }
}

type Body = { game: string; action: 'load' } | { game: string; action: 'act'; payload: { type: string } & Record<string, unknown> }
type Handler = (body: Body) => Promise<{ view: View; result: unknown; server_now: number }>

/** world 요청을 행동 종류별로 응답한다. 없는 종류는 실패로 둔다. */
function route(handlers: Record<string, Handler>) {
  worldMock.mockImplementation(((body: Body) => {
    const key = body.action === 'load' ? 'load' : body.payload.type
    const h = handlers[key]
    if (!h) return Promise.reject(new Error(`unexpected ${key}`))
    return h(body)
  }) as unknown as typeof world)
}
const ok = (view: View, result: unknown = null) =>
  Promise.resolve({ view, result, server_now: Date.now() })

const calls = (type: string) =>
  worldMock.mock.calls
    .map(([b]) => b as Body)
    .filter((b) => (type === 'load' ? b.action === 'load' : b.action === 'act' && b.payload.type === type))

function pending(biteDelayMs = 3000): PendingView {
  return { biteDelayMs, startedAt: Date.now(), hooked: false, species: null, sizeCm: null }
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date', 'performance'],
  })
  vi.setSystemTime(1_700_000_000_000)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({}) as unknown as CanvasRenderingContext2D,
  )
  worldMock.mockReset()
  vi.mocked(drawWorld).mockClear()
  vi.mocked(barResult).mockReset().mockImplementation(actualMinigame.barResult)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 무대(.fish-stage)의 너비·높이·문서 위치와 창 높이를 정한다. 되돌리는 함수를 돌려준다. */
function stubStage({ width, height = 0, top = 0, innerH }: { width: number; height?: number; top?: number; innerH: number }) {
  const prevInnerH = window.innerHeight
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerH })
  const rect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('fish-stage') ? new DOMRect(0, top, width, height) : rect.call(this)
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('fish-stage') ? width : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('fish-stage') ? height : 0
  })
  return () => Object.defineProperty(window, 'innerHeight', { configurable: true, value: prevInnerH })
}

const flush = () => act(async () => { await Promise.resolve() })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const canvas = () => screen.getByLabelText('낚시터')
const press = () => fireEvent.pointerDown(canvas())
const release = () => fireEvent.pointerUp(canvas())

async function mount(view = makeView()) {
  route({ load: () => ok(view) })
  const r = render(<Game gameId="fishing" />)
  await flush()
  return r
}

/** 던지고 cast 응답까지 받은 상태(waiting)로 만든다. */
async function castAndWait(view = makeView(), biteDelayMs = 3000) {
  await mount(view)
  // 서버가 cast를 처리한 시각이 startedAt이다
  route({ load: () => ok(view), cast: () => { const p = pending(biteDelayMs); return ok({ ...view, pending: p }, p) } })
  press()
  await advance(400)
  release()
  await flush()
}

describe('fishing Game', () => {
  test('loads and shows gold and bag count', async () => {
    await mount(makeView({ gold: 12345, bag: [{ species: 'anchovy', sizeCm: 10, perfect: false }] }))
    expect(worldMock).toHaveBeenCalledWith({ game: 'fishing', action: 'load' })
    expect(screen.getByText('12,345 G')).toBeInTheDocument()
    expect(screen.getByText('1/20')).toBeInTheDocument()
  })

  test('load failure shows retry and retries', async () => {
    worldMock.mockRejectedValueOnce(new ApiError('network', 0))
    render(<Game gameId="fishing" />)
    await flush()
    expect(screen.getByText('연결이 불안정해요. 다시 시도해 주세요')).toBeInTheDocument()
    route({ load: () => ok(makeView({ gold: 7 })) })
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await flush()
    expect(calls('load')).toHaveLength(2)
    expect(screen.getByText('7 G')).toBeInTheDocument()
  })

  test('press-release sends cast with power in [0,1]', async () => {
    await mount()
    const p = pending()
    route({ cast: () => ok(makeView({ pending: p }), p) })
    press()
    await advance(400)
    release()
    await flush()
    const sent = calls('cast')
    expect(sent).toHaveLength(1)
    const payload = (sent[0] as unknown as { payload: { area: string; power: number } }).payload
    expect(payload.area).toBe('pier')
    expect(payload.power).toBeGreaterThanOrEqual(0)
    expect(payload.power).toBeLessThanOrEqual(1)
    expect(payload.power).toBeGreaterThan(0.3) // 400ms 모으면 게이지가 절반쯤 찬다
  })

  test('pressing before the bite sends resolve success:false', async () => {
    const view = makeView()
    await castAndWait(view, 3000)
    route({ resolve: () => ok(view, { caught: null }) })
    await advance(1000)
    press()
    release()
    await flush()
    expect(calls('hook')).toHaveLength(0)
    expect(calls('resolve')).toEqual([
      { game: 'fishing', action: 'act', payload: { type: 'resolve', success: false, perfect: false } },
    ])
  })

  test('missing the hook window sends resolve success:false', async () => {
    const view = makeView()
    await castAndWait(view, 3000)
    route({ resolve: () => ok(view, { caught: null }) })
    await advance(3000 + HOOK_WINDOW_MS - 100)
    expect(calls('resolve')).toHaveLength(0)
    await advance(300)
    expect(calls('resolve')).toEqual([
      { game: 'fishing', action: 'act', payload: { type: 'resolve', success: false, perfect: false } },
    ])
  })

  test('a won fight waits for MIN_FIGHT_MS, sends resolve success:true and shows the catch', async () => {
    const view = makeView()
    await castAndWait(view, 3000)
    route({
      hook: () => ok(view, { species: 'mackerel', sizeCm: 40 }),
      resolve: (b) => {
        const perfect = (b as unknown as { payload: { perfect: boolean } }).payload.perfect
        const fish = { species: 'mackerel', sizeCm: 40, perfect }
        return ok({ ...view, bag: [fish], dex: { mackerel: { count: 1, maxCm: 40 } } }, { caught: fish })
      },
    })
    await advance(3100)
    press()
    release()
    await flush()
    expect(calls('hook')).toHaveLength(1)
    vi.mocked(barResult).mockImplementation(() => 'caught')
    await advance(200)
    expect(calls('resolve')).toHaveLength(0) // 2초가 지나기 전에는 보내지 않는다
    await advance(MIN_FIGHT_MS)
    const sent = calls('resolve') as unknown as { payload: { success: boolean; perfect: boolean } }[]
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.success).toBe(true)
    expect(screen.getByText('새로운 물고기!')).toBeInTheDocument()
    expect(screen.getByText(/고등어 40cm/)).toBeInTheDocument()
    expect(screen.getByText(`${price('mackerel', 40, sent[0].payload.perfect).toLocaleString('ko-KR')} G`)).toBeInTheDocument()
    await advance(1300)
    expect(screen.queryByText('새로운 물고기!')).not.toBeInTheDocument()
  })

  test('shop: sell calls act sell and updates gold from the response', async () => {
    const view = makeView({ gold: 100, bag: [{ species: 'anchovy', sizeCm: 10, perfect: false }] })
    await mount(view)
    route({ sell: () => ok({ ...view, gold: 1600, bag: [] }, { earned: 1500 }) })
    fireEvent.click(screen.getByRole('button', { name: '상점' }))
    fireEvent.click(screen.getByRole('button', { name: '전부 팔기' }))
    await flush()
    expect(calls('sell')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'sell' } }])
    expect(screen.getByText('1,600 G')).toBeInTheDocument()
    expect(screen.getByText('1,500 G를 벌었어요')).toBeInTheDocument()
    expect(screen.getByText('0/20')).toBeInTheDocument()
  })

  test('shop: buy button disabled when gold is short; enabled and calls buyRod when enough', async () => {
    const { unmount } = await mount(makeView({ gold: 1000 }))
    fireEvent.click(screen.getByRole('button', { name: '상점' }))
    expect(screen.getByRole('button', { name: '구매' })).toBeDisabled()
    expect(screen.getByText('골드가 부족해요')).toBeInTheDocument()
    expect(screen.getAllByText('이전 단계를 먼저 사야 해요')).toHaveLength(2)
    unmount()

    const rich = makeView({ gold: 2000 })
    await mount(rich)
    route({ buyRod: () => ok({ ...rich, gold: 500, rodTier: 2 }) })
    fireEvent.click(screen.getByRole('button', { name: '상점' }))
    const buy = screen.getByRole('button', { name: '구매' })
    expect(buy).toBeEnabled()
    fireEvent.click(buy)
    await flush()
    expect(calls('buyRod')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'buyRod', tier: 2 } }])
    expect(screen.getByText('500 G')).toBeInTheDocument()
  })

  test('shop: a not_enough_gold failure on buy shows the Korean message', async () => {
    const rich = makeView({ gold: 2000 })
    await mount(rich)
    route({ buyRod: () => Promise.reject(new ApiError('not_enough_gold', 400)), load: () => ok(rich) })
    fireEvent.click(screen.getByRole('button', { name: '상점' }))
    fireEvent.click(screen.getByRole('button', { name: '구매' }))
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('골드가 부족해요')
  })

  test('shop shows the top-tier message when the best rod is owned', async () => {
    await mount(makeView({ rodTier: 4 }))
    fireEvent.click(screen.getByRole('button', { name: '상점' }))
    expect(screen.getByText('최고 단계예요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '구매' })).not.toBeInTheDocument()
  })

  test('dex shows silhouettes for undiscovered species and names for discovered', async () => {
    await mount(makeView({ dex: { anchovy: { count: 3, maxCm: 14 } } }))
    fireEvent.click(screen.getByRole('button', { name: '도감' }))
    const dex = screen.getByRole('region', { name: '도감' })
    expect(within(dex).getByText('멸치')).toBeInTheDocument()
    expect(within(dex).queryByText('망둥어')).not.toBeInTheDocument()
    expect(within(dex).getAllByText('???')).toHaveLength(SPECIES.length - 1)
    const imgs = within(dex).getAllByRole('img') as HTMLImageElement[]
    expect(imgs.filter((i) => i.src.endsWith(':silhouette'))).toHaveLength(SPECIES.length - 1)
    expect(imgs.some((i) => i.src === 'data:fish-anchovy')).toBe(true)
  })

  test('bag_full on cast shows the shop hint', async () => {
    await mount()
    route({ cast: () => Promise.reject(new ApiError('bag_full', 400)) })
    press()
    await advance(200)
    release()
    await flush()
    const hint = screen.getByText('가방이 가득 찼어요. 상점에서 팔아 주세요')
    expect(hint).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '상점 열기' }))
    expect(screen.getByRole('button', { name: '전부 팔기' })).toBeInTheDocument()
  })

  test('no_pending on resolve reloads and returns to idle without an error screen', async () => {
    const view = makeView()
    await castAndWait(view, 3000)
    const reloaded = makeView({ gold: 999 })
    route({ resolve: () => Promise.reject(new ApiError('no_pending', 400)), load: () => ok(reloaded) })
    await advance(500)
    press()
    release()
    await flush()
    await flush()
    expect(calls('load')).toHaveLength(2)
    expect(screen.getByText('999 G')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    // idle로 돌아와 다시 던질 수 있다
    const p = pending()
    route({ cast: () => ok({ ...reloaded, pending: p }, p) })
    press()
    await advance(300)
    release()
    await flush()
    expect(calls('cast')).toHaveLength(2)
  })

  test('network error on resolve reloads', async () => {
    const view = makeView()
    await castAndWait(view, 3000)
    route({ resolve: () => Promise.reject(new ApiError('network', 0)), load: () => ok(makeView({ gold: 42 })) })
    await advance(500)
    press()
    release()
    await flush()
    await flush()
    expect(calls('load')).toHaveLength(2)
    expect(screen.getByText('42 G')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })

  test('input is ignored while a request is in flight', async () => {
    await mount()
    route({ cast: () => new Promise(() => {}) })
    press()
    await advance(300)
    release()
    await flush()
    press()
    await advance(300)
    release()
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    await flush()
    expect(calls('cast')).toHaveLength(1)
  })

  test('input is ignored while a resolve request is in flight', async () => {
    await castAndWait(makeView(), 3000)
    route({ resolve: () => new Promise(() => {}) })
    await advance(500)
    press()
    release()
    await flush()
    press()
    release()
    await flush()
    expect(calls('resolve')).toHaveLength(1)
  })

  test('space key casts like a press', async () => {
    await mount()
    const p = pending()
    route({ cast: () => ok(makeView({ pending: p }), p) })
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    await advance(300)
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    await flush()
    expect(calls('cast')).toHaveLength(1)
  })

  test('canvas input is ignored while a menu is open; menus are disabled while fighting', async () => {
    const view = makeView()
    await mount(view)
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    press()
    await advance(300)
    release()
    await flush()
    expect(calls('cast')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))

    route({
      cast: () => { const p = pending(); return ok({ ...view, pending: p }, p) },
      hook: () => ok(view, { species: 'anchovy', sizeCm: 10 }),
    })
    press()
    await advance(300)
    release()
    await flush()
    await advance(3100)
    press()
    release()
    await flush()
    expect(screen.getByRole('button', { name: '상점' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '전체화면' })).toBeDisabled()
  })

  test('canvas size uses the height left below the stage, not a fixed allowance', async () => {
    const restore = stubStage({ width: 688, top: 191, innerH: 650 })
    try {
      await mount()
      // 남은 높이 650 - 191 - 8 = 451 → fitScene(688, 451) = 1배, 320×451
      expect(canvas().style.width).toBe('320px')
      expect(canvas().style.height).toBe('451px')
    } finally {
      restore()
    }
  })

  test('the canvas backing store is fitScene w×h and the scene is drawn at that size', async () => {
    // 폰: 무대 너비 390, 남은 높이 650 - 82 - 8 = 560
    const restore = stubStage({ width: 390, top: 82, innerH: 650 })
    try {
      await mount()
      const fit = fitScene(390, 560)
      expect(fit).toEqual({ scale: 2, w: 195, h: 280 })
      const c = canvas() as HTMLCanvasElement
      expect(c.width).toBe(fit.w)
      expect(c.height).toBe(fit.h)
      expect(c.style.width).toBe(`${fit.w * fit.scale}px`)
      expect(c.style.height).toBe(`${fit.h * fit.scale}px`)
      await advance(100)
      const last = vi.mocked(drawWorld).mock.calls.at(-1)
      expect(last?.[2]).toEqual({ w: fit.w, h: fit.h })
    } finally {
      restore()
    }
  })

  test('fullscreen toggle covers the page, locks scroll, and Escape leaves', async () => {
    document.documentElement.style.overflow = 'auto'
    const { container } = await mount()
    const root = container.querySelector('.fish') as HTMLElement
    const toggle = screen.getByRole('button', { name: '전체화면' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(root).not.toHaveClass('fish-full')

    fireEvent.click(toggle)
    expect(root).toHaveClass('fish-full')
    expect(document.documentElement.style.overflow).toBe('hidden')
    const exit = screen.getByRole('button', { name: '나가기' })
    expect(exit).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(root).not.toHaveClass('fish-full')
    expect(document.documentElement.style.overflow).toBe('auto')
    expect(screen.getByRole('button', { name: '전체화면' })).toHaveAttribute('aria-pressed', 'false')

    // 나가기 버튼으로도 나간다
    fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
    fireEvent.click(screen.getByRole('button', { name: '나가기' }))
    expect(root).not.toHaveClass('fish-full')
    document.documentElement.style.overflow = ''
  })

  test('Escape with a menu open keeps fullscreen; menus open inside the overlay', async () => {
    const { container } = await mount()
    const root = container.querySelector('.fish') as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
    fireEvent.click(screen.getByRole('button', { name: '상점' }))
    const shop = screen.getByRole('region', { name: '상점' })
    expect(root.contains(shop)).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(root).toHaveClass('fish-full')
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(root).not.toHaveClass('fish-full')
  })

  test('unmounting in fullscreen restores page scroll', async () => {
    const { unmount } = await mount()
    fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
    expect(document.documentElement.style.overflow).toBe('hidden')
    unmount()
    expect(document.documentElement.style.overflow).toBe('')
  })

  test('in fullscreen the canvas fits the canvas area box', async () => {
    const restore = stubStage({ width: 390, height: 700, top: 82, innerH: 650 })
    try {
      await mount()
      expect((canvas() as HTMLCanvasElement).height).toBe(280) // 보통: 남은 높이 560
      fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
      const fit = fitScene(390, 700)
      expect(fit).toEqual({ scale: 2, w: 195, h: 350 })
      const c = canvas() as HTMLCanvasElement
      expect([c.width, c.height]).toEqual([fit.w, fit.h])
      expect(c.style.height).toBe('700px')
      fireEvent.keyDown(window, { key: 'Escape' })
      expect((canvas() as HTMLCanvasElement).height).toBe(280)
    } finally {
      restore()
    }
  })

  test('uses element fullscreen when available and leaves when the browser exits it', async () => {
    let fsEl: Element | null = null
    const request = vi.fn(function (this: Element) {
      fsEl = this
      return Promise.resolve()
    })
    const exitFs = vi.fn(() => {
      fsEl = null
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFs })
    try {
      const { container, unmount } = await mount()
      const root = container.querySelector('.fish') as HTMLElement
      fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
      await flush() // 요청이 끝난다
      expect(request).toHaveBeenCalledTimes(1)
      expect(request.mock.contexts[0]).toBe(root)
      act(() => { document.dispatchEvent(new Event('fullscreenchange')) }) // 들어감 알림: 그대로
      expect(root).toHaveClass('fish-full')

      // Esc·뒤로 가기로 브라우저가 전체화면을 끝냄
      fsEl = null
      act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
      expect(root).not.toHaveClass('fish-full')
      expect(document.documentElement.style.overflow).toBe('')

      // 버튼으로 나가면 브라우저 전체화면도 끝낸다
      fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
      fireEvent.click(screen.getByRole('button', { name: '나가기' }))
      expect(exitFs).toHaveBeenCalledTimes(1)

      // 전체화면 중 페이지를 떠나도 끝낸다
      fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
      unmount()
      expect(exitFs).toHaveBeenCalledTimes(2)
      expect(fsEl).toBeNull()
    } finally {
      delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen
      delete (document as { fullscreenElement?: unknown }).fullscreenElement
      delete (document as { exitFullscreen?: unknown }).exitFullscreen
    }
  })

  test('a rejected element fullscreen request still shows the overlay', async () => {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.reject(new Error('denied')),
    })
    try {
      const { container } = await mount()
      fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
      await flush()
      expect(container.querySelector('.fish')).toHaveClass('fish-full')
    } finally {
      delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen
    }
  })

  test('the toggle gives focus back to the game so Space does not press it', async () => {
    const { container } = await mount()
    const root = container.querySelector('.fish') as HTMLElement
    const toggle = screen.getByRole('button', { name: '전체화면' })
    toggle.focus()
    fireEvent.click(toggle)
    const exit = screen.getByRole('button', { name: '나가기' })
    expect(document.activeElement).not.toBe(exit)
    expect(document.activeElement).toBe(root)
    exit.focus()
    fireEvent.click(exit)
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '전체화면' }))
    expect(document.activeElement).toBe(root)
  })

  test('in fullscreen notices sit over the canvas area and do not resize the canvas', async () => {
    const restore = stubStage({ width: 390, height: 700, top: 82, innerH: 650 })
    try {
      const { container } = await mount()
      fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
      const c = canvas() as HTMLCanvasElement
      const before = [c.width, c.height]
      route({ cast: () => Promise.reject(new ApiError('bag_full', 400)) })
      press()
      await advance(200)
      release()
      await flush()
      const note = screen.getByText('가방이 가득 찼어요. 상점에서 팔아 주세요')
      const stage = container.querySelector('.fish-stage') as HTMLElement
      expect(stage.contains(note)).toBe(true)
      expect([c.width, c.height]).toEqual(before)
      // 보통 화면에서는 예전처럼 무대 아래
      fireEvent.keyDown(window, { key: 'Escape' })
      const again = screen.getByText('가방이 가득 찼어요. 상점에서 팔아 주세요')
      expect(stage.contains(again)).toBe(false)
    } finally {
      restore()
    }
  })

  test('leaving before the element fullscreen request settles exits native fullscreen when it does', async () => {
    let fsEl: Element | null = null
    let resolveRequest: () => void = () => {}
    const request = vi.fn(function (this: Element) {
      const el = this
      return new Promise<void>((res) => {
        resolveRequest = () => {
          fsEl = el
          document.dispatchEvent(new Event('fullscreenchange'))
          res()
        }
      })
    })
    const exitFs = vi.fn(() => {
      fsEl = null
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFs })
    try {
      const { container } = await mount()
      const root = container.querySelector('.fish') as HTMLElement
      fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
      // 요청이 아직 끝나지 않았을 때 오는 알림(전체화면 요소 없음)으로는 나가지 않는다
      act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
      expect(root).toHaveClass('fish-full')
      fireEvent.click(screen.getByRole('button', { name: '나가기' }))
      expect(root).not.toHaveClass('fish-full')
      expect(exitFs).not.toHaveBeenCalled()
      await act(async () => {
        resolveRequest()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(exitFs).toHaveBeenCalledTimes(1)
      expect(fsEl).toBeNull()
      expect(root).not.toHaveClass('fish-full')
    } finally {
      delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen
      delete (document as { fullscreenElement?: unknown }).fullscreenElement
      delete (document as { exitFullscreen?: unknown }).exitFullscreen
    }
  })

  test('unmount releases the scene background cache', async () => {
    vi.mocked(releaseSceneCache).mockClear()
    const { unmount } = await mount()
    expect(releaseSceneCache).not.toHaveBeenCalled()
    unmount()
    expect(releaseSceneCache).toHaveBeenCalledTimes(1)
  })

  test('stops drawing after unmount', async () => {
    const { unmount } = await mount()
    await advance(100)
    expect(vi.mocked(drawWorld).mock.calls.length).toBeGreaterThan(0)
    unmount()
    const n = vi.mocked(drawWorld).mock.calls.length
    await advance(200)
    expect(vi.mocked(drawWorld).mock.calls.length).toBe(n)
  })
})

describe('fitScene', () => {
  test('integer scale and a logical size that fills the area, within 160–320 × 240–480', () => {
    expect(fitScene(390, 560)).toEqual({ scale: 2, w: 195, h: 280 })
    expect(fitScene(358, 565)).toEqual({ scale: 2, w: 179, h: 282 })
    expect(fitScene(1280, 696)).toEqual({ scale: 2, w: 320, h: 348 })
    expect(fitScene(688, 371)).toEqual({ scale: 1, w: 320, h: 371 })
    expect(fitScene(150, 200)).toEqual({ scale: 1, w: 160, h: 240 })
  })

  test('zero, negative and non-finite sizes give the minimum scene', () => {
    expect(fitScene(0, 0)).toEqual({ scale: 1, w: 160, h: 240 })
    expect(fitScene(NaN, -5)).toEqual({ scale: 1, w: 160, h: 240 })
    expect(fitScene(Infinity, 600)).toEqual({ scale: 1, w: 160, h: 480 })
  })
})

describe('canvasScale', () => {
  test('largest integer scale that fits both width and height, between 1 and 4', () => {
    expect(canvasScale(688, 600)).toBe(2)
    expect(canvasScale(358, 700)).toBe(2)
    expect(canvasScale(288, 700)).toBe(1)
    expect(canvasScale(1000, 2000)).toBe(4)
    expect(canvasScale(0, 0)).toBe(1)
  })
})

describe('availableHeight', () => {
  test('window height minus stage top, controls below and an 8px margin', () => {
    expect(availableHeight(650, 191, 80)).toBe(371)
    expect(canvasScale(688, 371)).toBe(1)
    expect(availableHeight(844, 191, 80)).toBe(565)
    expect(canvasScale(358, 565)).toBe(2)
    expect(availableHeight(1300, 191, 80)).toBe(1021)
    expect(canvasScale(688, 1021)).toBe(4)
  })

  test('a negative result still gives scale 1', () => {
    const h = availableHeight(200, 191, 80)
    expect(h).toBeLessThan(0)
    expect(canvasScale(688, h)).toBe(1)
  })
})
