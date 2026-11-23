import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { availableHeight, canvasScale, fitScene, Game, hudTopFor, TOUCH_HINT_BAND } from './Game.tsx'
import { ApiError, world } from '../../lib/api.ts'
import { drawWorld, releaseSceneCache } from './scene.ts'
import { releaseMinimapCache } from './minimap.ts'
import { barResult } from './minigame.ts'
import { HOOK_WINDOW_MS, MIN_FIGHT_MS, SPECIES } from './data.ts'
import { conditionsAt } from './clock.ts'
import { BagPanel, conditionLabel, DexPanel } from './Menus.tsx'
import { price, type PendingView, type View } from './logic.ts'
import { DEFAULT_OUTFIT } from './wardrobe.ts'
import { TILE, exitAt, interactionAt, pierEnd, tileOf, type Facing, type MapDef, type Vec } from './map.ts'
import { VILLAGE } from './maps/village.ts'
import { RIVER } from './maps/river.ts'
import { FOREST } from './maps/forest.ts'
import { CAVE } from './maps/cave.ts'
import { ISLAND } from './maps/island.ts'
import { DEFAULT_AREAS } from './data.ts'
import { feetBlocked } from './walk.ts'
import { teleportFee } from './teleport.ts'
import type { AreaId } from './data.ts'
import fishingCss from './fishing.css?raw'
import { WALK_SPEED, type Player } from './walk.ts'

const SPAWN = VILLAGE.spawn
const PIER_END = pierEnd(VILLAGE)!

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/api.ts')>()
  return { ...orig, world: vi.fn() }
})
vi.mock('../../platform/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('./scene.ts', () => ({ drawWorld: vi.fn(), releaseSceneCache: vi.fn(), SCENE_W: 160, SCENE_H: 240 }))
/** 지역 전환 테스트가 강 맵을 없는 것처럼 만들 때 쓴다 */
const mapGate = vi.hoisted(() => ({ hideRiver: false }))
vi.mock('./maps/index.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./maps/index.ts')>()
  return { ...orig, mapFor: (area: AreaId) => (mapGate.hideRiver && area === 'river' ? null : orig.mapFor(area)) }
})
vi.mock('./minimap.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./minimap.ts')>()
  return { ...orig, minimapUrl: vi.fn(() => 'data:mini'), spotHighlightUrl: vi.fn(() => 'data:hl'), releaseMinimapCache: vi.fn() }
})
vi.mock('./sprites.ts', async (importOriginal) => ({
  // 옷장 미리보기 합성은 실제 그림 자료(SPRITES)를 쓴다
  SPRITES: (await importOriginal<typeof import('./sprites.ts')>()).SPRITES,
  drawSpriteData: vi.fn(),
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
  return { gold: 1234, totalEarned: 0, rodTier: 1, bagTier: 1, areas: ['village'], bag: [], dex: {}, legends: [], tackles: [], equipped: [], challenges: {}, wardrobe: [], outfit: { ...DEFAULT_OUTFIT }, pending: null, ...over }
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
  localStorage.clear()
  vi.mocked(drawWorld).mockClear()
  vi.mocked(barResult).mockReset().mockImplementation(actualMinigame.barResult)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
/** 행동(데스크톱 스페이스): 물가면 충전·던지기, 상점 문 앞이면 상점, 낚시 중이면 챔·감기 */
const press = () => fireEvent.keyDown(window, { key: ' ', code: 'Space' })
const release = () => fireEvent.keyUp(window, { key: ' ', code: 'Space' })
const tapCanvas = () => {
  fireEvent.pointerDown(canvas(), { pointerId: 9 })
  fireEvent.pointerUp(canvas(), { pointerId: 9 })
}
const key = (code: string, down: boolean) =>
  down ? fireEvent.keyDown(window, { code, key: code }) : fireEvent.keyUp(window, { code, key: code })

const POS_KEY = 'fishing-pos:u1'
const tileCenter = (tx: number, ty: number): Vec => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
type At = { pos: Vec; facing: Facing; area?: AreaId }
/** 부두 끝에서 바다를 본다 → 낚시(pier) */
const PIER: At = { pos: tileCenter(PIER_END.tx, PIER_END.ty), facing: 'down' }
/** 모래사장 맨 아래 줄(10, 25)에서 바다를 본다 → 낚시(shore) */
const SHORE: At = { pos: tileCenter(10, 25), facing: 'down' }
/** 모래밭 한가운데, 앞도 모래 → 행동 없음 */
const SAND: At = { pos: tileCenter(5, 20), facing: 'down' }

/** 저장 위치(null이면 저장 없음 → SPAWN)를 넣고 화면을 띄운다. 기본은 부두 끝. */
async function mount(view = makeView(), at: At | null = PIER) {
  if (at) localStorage.setItem(POS_KEY, JSON.stringify(at))
  else localStorage.removeItem(POS_KEY)
  route({ load: () => ok(view) })
  const r = render(<Game gameId="fishing" />)
  await flush()
  return r
}

/** 마지막으로 그린 장면의 캐릭터 */
const lastPlayer = (): Player => {
  const call = vi.mocked(drawWorld).mock.calls.at(-1)
  if (!call) throw new Error('drawWorld was not called')
  return call[1].player
}

/** 터치 입력이 있는 기기((any-pointer: coarse))로 만든다: 조이스틱·행동 버튼이 보인다 */
function stubTouch() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === '(any-pointer: coarse)',
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}
const actionButton = () => screen.getByTestId('fish-action')
const stick = () => screen.getByTestId('fish-stick')
const pointer = (type: 'down' | 'move' | 'up', el: Element, pointerId: number, x = 0, y = 0) => {
  const init = { pointerId, clientX: x, clientY: y }
  if (type === 'down') fireEvent.pointerDown(el, init)
  else if (type === 'move') fireEvent.pointerMove(el, init)
  else fireEvent.pointerUp(el, init)
}

/** 상점 문 앞(저장 위치 없음 = SPAWN)에서 스페이스로 상점을 열고, 유령 클릭 방지 시간(300ms)을 넘긴다 */
async function mountAtShop(view = makeView()) {
  const r = await mount(view, null)
  press()
  release()
  await advance(300)
  return r
}
/** 마지막으로 그린 장면의 미니게임 바 */
const lastBar = () => {
  const bar = vi.mocked(drawWorld).mock.calls.at(-1)?.[1].bar
  if (!bar) throw new Error('no bar drawn')
  return bar
}
/** 터치: 행동 버튼으로 던지고 입질까지 기다린다 */
async function touchCastToBite(view = makeView()) {
  stubTouch()
  await mount(view, PIER)
  route({
    cast: () => { const p = pending(3000); return ok({ ...view, pending: p }, p) },
    hook: () => ok(view, { species: 'anchovy', sizeCm: 10 }),
    resolve: () => new Promise(() => {}),
  })
  pointer('down', actionButton(), 2)
  await advance(300)
  pointer('up', actionButton(), 2)
  await flush()
  await advance(3100)
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
    const payload = (sent[0] as unknown as { payload: { area: string; power: number; spot: string } }).payload
    expect(payload.area).toBe('village')
    expect(payload.spot).toBe('pier') // 부두 위에서 던졌다
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

  test('전설을 잡으면 알림에 "전설의 물고기!"와 "세이브당 한 마리 · 가방에 잠가 뒀어요"', async () => {
    const view = makeView({ rodTier: 3 })
    await castAndWait(view, 3000)
    const fish = { species: 'grouper', sizeCm: 100, perfect: false, locked: true as const }
    route({
      hook: () => ok(view, { species: 'grouper', sizeCm: 100 }),
      resolve: () => ok({ ...view, bag: [fish], dex: { grouper: { count: 1, maxCm: 100 } }, legends: ['grouper'] }, { caught: fish }),
    })
    await advance(3100)
    press()
    release()
    await flush()
    vi.mocked(barResult).mockImplementation(() => 'caught')
    await advance(200 + MIN_FIGHT_MS)
    expect(screen.getByText('전설의 물고기!')).toBeInTheDocument()
    expect(screen.queryByText('새로운 물고기!')).not.toBeInTheDocument()
    expect(screen.getByText('세이브당 한 마리 · 가방에 잠가 뒀어요')).toBeInTheDocument()
    // 보통 물고기(1.2초)보다 오래, 2.5초 보이고 좁은 화면에서 줄을 바꾼다
    expect(document.querySelector('.fish-toast')).toHaveClass('fish-toast-wrap')
    await advance(2000)
    expect(screen.getByText('전설의 물고기!')).toBeInTheDocument()
    await advance(600)
    expect(screen.queryByText('전설의 물고기!')).not.toBeInTheDocument()
  })

  test('모르는 어종(더 새 서버)을 잡아도 알림이 죽지 않고 가격 줄만 빠진다', async () => {
    const view = makeView()
    await castAndWait(view, 3000)
    const fish = { species: 'fish-from-the-future', sizeCm: 33, perfect: false }
    route({
      hook: () => ok(view, { species: fish.species, sizeCm: 33 }),
      resolve: () => ok({ ...view, bag: [fish], dex: { [fish.species]: { count: 1, maxCm: 33 } } }, { caught: fish }),
    })
    await advance(3100)
    press()
    release()
    await flush()
    vi.mocked(barResult).mockImplementation(() => 'caught')
    await advance(200 + MIN_FIGHT_MS)
    expect(screen.getByText(/fish-from-the-future 33cm/)).toBeInTheDocument()
    expect(document.querySelector('.fish-toast-price')).toBeNull()
  })

  test('shop: sell calls act sell and updates gold from the response', async () => {
    const view = makeView({ gold: 100, bag: [{ species: 'anchovy', sizeCm: 10, perfect: false }] })
    await mountAtShop(view)
    route({ sell: () => ok({ ...view, gold: 1600, bag: [] }, { earned: 1500 }) })
    fireEvent.click(screen.getByRole('button', { name: '전부 팔기' }))
    await flush()
    expect(calls('sell')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'sell' } }])
    expect(screen.getByText('1,600 G')).toBeInTheDocument()
    expect(screen.getByText('1,500 G를 벌었어요')).toBeInTheDocument()
    expect(screen.getByText('0/20')).toBeInTheDocument()
  })

  test('가방: 물고기 칸을 누르면 lock을 보내고, 응답 뒤 잠금 표시가 바뀐다', async () => {
    const fish = { species: 'anchovy', sizeCm: 10, perfect: false }
    const view = makeView({ bag: [fish] })
    await mount(view)
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    route({
      lock: (b) => ok({ ...view, bag: [b.action === 'act' && b.payload.locked ? { ...fish, locked: true as const } : fish] }),
    })
    const cell = () => within(screen.getByRole('region', { name: '가방' })).getByRole('button', { name: /멸치 10cm/ })
    expect(cell()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(cell())
    await flush()
    expect(calls('lock')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'lock', index: 0, locked: true } }])
    expect(cell()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(cell())
    await flush()
    expect(calls('lock')[1]).toEqual({ game: 'fishing', action: 'act', payload: { type: 'lock', index: 0, locked: false } })
    expect(cell()).toHaveAttribute('aria-pressed', 'false')
  })

  test('상점: 잠긴 물고기는 마릿수·예상 금액에서 빠지고, 전부 잠겨 있으면 팔기 버튼이 꺼진다', async () => {
    const anchovy = { species: 'anchovy', sizeCm: 10, perfect: false }
    const grouper = { species: 'grouper', sizeCm: 120, perfect: false, locked: true as const }
    const { unmount } = await mountAtShop(makeView({ bag: [anchovy, grouper] }))
    const value = price('anchovy', 10, false).toLocaleString('ko-KR')
    expect(screen.getByText(`팔 물고기 1마리 · 잠금 1마리 · 예상 ${value} G`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전부 팔기' })).toBeEnabled()
    unmount()
    await mountAtShop(makeView({ bag: [grouper] }))
    expect(screen.getByText('팔 물고기 0마리 · 잠금 1마리 · 예상 0 G')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전부 팔기' })).toBeDisabled()
  })

  test('shop: buy button disabled when gold is short; enabled and calls buyRod when enough', async () => {
    const { unmount } = await mountAtShop(makeView({ gold: 1000 }))
    const rods = screen.getByRole('list', { name: '낚싯대 목록' })
    expect(within(rods).getByRole('button', { name: '구매' })).toBeDisabled()
    expect(within(rods).getByText('골드가 부족해요')).toBeInTheDocument()
    expect(within(rods).getAllByText('이전 단계를 먼저 사야 해요')).toHaveLength(4)
    // 5·6단계는 고급 장비: 신화 말고는 없어도 모든 물고기를 낚는다
    expect(within(rods).getAllByText('고급 장비 · 신화 말고는 없어도 모든 물고기를 낚아요')).toHaveLength(2)
    unmount()

    const rich = makeView({ gold: 2000 })
    await mountAtShop(rich)
    route({ buyRod: () => ok({ ...rich, gold: 500, rodTier: 2 }) })
    const buy = screen.getByRole('button', { name: '구매' })
    expect(buy).toBeEnabled()
    fireEvent.click(buy)
    await flush()
    expect(calls('buyRod')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'buyRod', tier: 2 } }])
    expect(screen.getByText('500 G')).toBeInTheDocument()
  })

  test('shop: a not_enough_gold failure on buy shows the Korean message', async () => {
    const rich = makeView({ gold: 2000 })
    await mountAtShop(rich)
    route({ buyRod: () => Promise.reject(new ApiError('not_enough_gold', 400)), load: () => ok(rich) })
    fireEvent.click(screen.getByRole('button', { name: '구매' }))
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('골드가 부족해요')
  })

  test('shop shows the top-tier message when the best rod is owned', async () => {
    await mountAtShop(makeView({ rodTier: 6 }))
    expect(screen.getByText('최고 단계예요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '구매' })).not.toBeInTheDocument()
  })

  test('dex shows silhouettes for undiscovered species and names for discovered', async () => {
    await mount(makeView({ dex: { anchovy: { count: 3, maxCm: 14 } } }))
    fireEvent.click(screen.getByRole('button', { name: '도감' }))
    const dex = screen.getByRole('region', { name: '도감' })
    const village = SPECIES.filter((s) => s.area === 'village').length
    expect(within(dex).getByText('멸치')).toBeInTheDocument()
    expect(within(dex).queryByText('망둥어')).not.toBeInTheDocument()
    expect(within(dex).getAllByText('???')).toHaveLength(village - 1)
    const imgs = within(dex).getAllByRole('img') as HTMLImageElement[]
    expect(imgs.filter((i) => i.src.endsWith(':silhouette'))).toHaveLength(village - 1)
    expect(imgs.some((i) => i.src === 'data:fish-anchovy')).toBe(true)
  })

  test('dex has a tab per area with species, opens on the current area, and filters by tab', async () => {
    const entry = VILLAGE.exits[0].entry
    await mount(makeView(), { area: 'river', pos: tileCenter(entry.tx, entry.ty), facing: 'up' })
    fireEvent.click(screen.getByRole('button', { name: '도감' }))
    const dex = screen.getByRole('region', { name: '도감' })
    const tabs = within(dex).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['바닷가 마을 0/16', '마을 강 0/9', '숲 0/8', '산 호수 0/8', '동굴 0/7', '섬 0/8', '갯벌 0/9', '늪지 0/10'])
    expect(within(dex).getByRole('tab', { name: /마을 강/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(dex).getAllByText('???')).toHaveLength(9)
    fireEvent.click(within(dex).getByRole('tab', { name: /숲/ }))
    expect(within(dex).getByRole('tab', { name: /숲/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(dex).getByRole('tab', { name: /마을 강/ })).toHaveAttribute('aria-selected', 'false')
    expect(within(dex).getAllByText('???')).toHaveLength(8)
  })

  test('dex shows per-area counts and the overall n/75 on top; caught names only on their tab', async () => {
    await mount(makeView({ dex: { anchovy: { count: 1, maxCm: 10 }, 'pale-chub': { count: 2, maxCm: 12 } } }))
    fireEvent.click(screen.getByRole('button', { name: '도감' }))
    const dex = screen.getByRole('region', { name: '도감' })
    expect(within(dex).getByText('2/75종')).toBeInTheDocument()
    expect(within(dex).getByRole('tab', { name: /바닷가 마을/ })).toHaveTextContent('1/16')
    expect(within(dex).getByRole('tab', { name: /마을 강/ })).toHaveTextContent('1/9')
    expect(within(dex).getByText('멸치')).toBeInTheDocument()
    expect(within(dex).queryByText('피라미')).not.toBeInTheDocument()
    fireEvent.click(within(dex).getByRole('tab', { name: /마을 강/ }))
    expect(within(dex).getByText('피라미')).toBeInTheDocument()
    expect(within(dex).queryByText('멸치')).not.toBeInTheDocument()
  })

  test('dex: 8 tabs in AREAS order, new spot names shown for caught species', async () => {
    await mount(makeView({ dex: { 'bat-catfish': { count: 1, maxCm: 50 }, lionfish: { count: 1, maxCm: 30 }, 'rainbow-trout': { count: 1, maxCm: 40 } } }))
    fireEvent.click(screen.getByRole('button', { name: '도감' }))
    const dex = screen.getByRole('region', { name: '도감' })
    expect(within(dex).getAllByRole('tab')).toHaveLength(8)
    fireEvent.click(within(dex).getByRole('tab', { name: /동굴/ }))
    expect(within(dex).getByText('수정 웅덩이 · 사계절')).toBeInTheDocument()
    fireEvent.click(within(dex).getByRole('tab', { name: /섬/ }))
    expect(within(dex).getByText('석호 · 사계절 · 20~5시')).toBeInTheDocument()
    fireEvent.click(within(dex).getByRole('tab', { name: /산 호수/ }))
    expect(within(dex).getByText('사계절')).toBeInTheDocument()
  })

  test('dex marks an uncaught legend slot with a border but keeps its name hidden', async () => {
    await mount(makeView())
    fireEvent.click(screen.getByRole('button', { name: '도감' }))
    const dex = screen.getByRole('region', { name: '도감' })
    expect(within(dex).queryByText('다금바리')).not.toBeInTheDocument()
    expect(within(dex).queryByText('전설')).not.toBeInTheDocument()
    expect(dex.querySelectorAll('.fish-dex-item-legend')).toHaveLength(1)
    expect(dex.querySelectorAll('.fish-dex-item-legend')[0]).toHaveTextContent('???')
  })

  test('도감 전설: 잡았든 아니든 테두리, 안 잡으면 "세이브당 한 마리", 잡으면 "세이브당 한 마리 · 잡았어요"', async () => {
    const { unmount } = await mount(makeView())
    fireEvent.click(screen.getByRole('button', { name: '도감' }))
    let dex = screen.getByRole('region', { name: '도감' })
    expect(dex.querySelectorAll('.fish-dex-item-legend')[0]).toHaveTextContent('세이브당 한 마리')
    unmount()

    await mount(makeView({ dex: { grouper: { count: 1, maxCm: 90 } }, legends: ['grouper'] }))
    fireEvent.click(screen.getByRole('button', { name: '도감' }))
    dex = screen.getByRole('region', { name: '도감' })
    const items = dex.querySelectorAll('.fish-dex-item-legend')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('다금바리')
    expect(items[0]).toHaveTextContent('세이브당 한 마리 · 잡았어요')
  })

  test('가방 전설 칸은 테두리 표시와 이름에 "전설"', async () => {
    const view = makeView({ bag: [{ species: 'grouper', sizeCm: 100, perfect: false, locked: true }, { species: 'anchovy', sizeCm: 10, perfect: false }] })
    await mount(view)
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    const bag = screen.getByRole('region', { name: '가방' })
    const legend = within(bag).getByRole('button', { name: /^전설 다금바리 100cm/ })
    expect(legend).toHaveClass('fish-cell-legend')
    expect(within(bag).getByRole('button', { name: /^멸치 10cm/ })).not.toHaveClass('fish-cell-legend')
  })

  test('bag_full on cast tells the player to go and sell at the shop, with no open-shop button', async () => {
    await mount()
    route({ cast: () => Promise.reject(new ApiError('bag_full', 400)) })
    press()
    await advance(200)
    release()
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('상점에 가서 팔아 주세요')
    expect(screen.queryByRole('button', { name: /상점/ })).not.toBeInTheDocument()
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
    fireEvent.pointerDown(canvas(), { pointerId: 9 })
    await advance(300)
    fireEvent.pointerUp(canvas(), { pointerId: 9 })
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
    expect(screen.getByRole('button', { name: '가방' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '도감' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '지도' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '전체화면' })).toBeDisabled()
    // 낚시 중에는 M 키도 지도를 열지 않는다
    fireEvent.keyDown(window, { code: 'KeyM', key: 'm' })
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument()
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
    const { container } = await mount(makeView(), null)
    const root = container.querySelector('.fish') as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
    press() // 상점 문 앞: 떼면 상점이 열린다
    release()
    const shop = screen.getByRole('region', { name: '상점' })
    expect(root.contains(shop)).toBe(true)
    await advance(300)
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
      const note = screen.getByText(/상점에 가서 팔아 주세요/)
      const stage = container.querySelector('.fish-stage') as HTMLElement
      expect(stage.contains(note)).toBe(true)
      expect([c.width, c.height]).toEqual(before)
      // 보통 화면에서는 예전처럼 무대 아래
      fireEvent.keyDown(window, { key: 'Escape' })
      const again = screen.getByText(/상점에 가서 팔아 주세요/)
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

  test('canvas taps hook during a bite but do not cast from idle', async () => {
    const view = makeView()
    await mount(view)
    tapCanvas()
    await advance(300)
    expect(calls('cast')).toHaveLength(0)
    route({
      cast: () => { const p = pending(); return ok({ ...view, pending: p }, p) },
      hook: () => ok(view, { species: 'anchovy', sizeCm: 10 }),
    })
    press()
    await advance(300)
    release()
    await flush()
    await advance(3100)
    tapCanvas()
    await flush()
    expect(calls('hook')).toHaveLength(1)
  })
  test('dex shows spawn conditions only for caught species, legend mark, and n/75', async () => {
    await mount(makeView({ dex: { pufferfish: { count: 1, maxCm: 20 }, grouper: { count: 1, maxCm: 90 } }, legends: ['grouper'] }))
    fireEvent.click(screen.getByRole('button', { name: '도감' }))
    const dex = screen.getByRole('region', { name: '도감' })
    expect(within(dex).getByText('2/75종')).toBeInTheDocument()
    expect(within(dex).getByText('여름 · 12~16시 · 맑음')).toBeInTheDocument()
    expect(within(dex).getByText('부두 · 겨울')).toBeInTheDocument()
    expect(within(dex).getByText('전설')).toBeInTheDocument()
    expect(within(dex).queryByText('봄 · 가을')).not.toBeInTheDocument() // 못 잡은 멸치
    expect(within(dex).getAllByText('???')).toHaveLength(14)
  })

  test('server_now가 기기 시각과 같으면 cond는 conditionsAt(Date.now())', async () => {
    await mount()
    await advance(100)
    expect(vi.mocked(drawWorld).mock.calls.at(-1)?.[1].cond).toEqual(conditionsAt(Date.now()))
  })

  test('cond follows server_now: 3h-ahead response gives conditionsAt(Date.now() + 3h)', async () => {
    const H3 = 3 * 3_600_000
    localStorage.setItem(POS_KEY, JSON.stringify(PIER))
    worldMock.mockImplementation((() =>
      Promise.resolve({ view: makeView(), result: null, server_now: Date.now() + H3 })) as unknown as typeof world)
    render(<Game gameId="fishing" />)
    await flush()
    await advance(100)
    const call = vi.mocked(drawWorld).mock.calls.at(-1)
    expect(call?.[1].cond).toEqual(conditionsAt(Date.now() + H3))
  })
})

describe('conditionLabel', () => {
  const sp = (id: string) => SPECIES.find((s) => s.id === id)!
  test('formats season, hours, weather and legend spot', () => {
    expect(conditionLabel(sp('pufferfish'))).toBe('여름 · 12~16시 · 맑음')
    expect(conditionLabel(sp('conger'))).toBe('봄 · 가을 · 16~2시 · 비')
    expect(conditionLabel(sp('goby'))).toBe('사계절')
    expect(conditionLabel(sp('grouper'))).toBe('부두 · 겨울')
  })
  test('spots가 있는 어종은 전설이 아니어도 자리를 앞에 붙이고, 없으면 붙이지 않는다', () => {
    expect(conditionLabel(sp('stream-minnow'))).toBe('폭포 · 사계절')
    expect(conditionLabel(sp('snakehead'))).toBe('연못 · 여름 · 가을 · 20~5시')
    expect(conditionLabel(sp('catfish'))).toBe('봄 · 여름 · 가을 · 비')
    expect(conditionLabel(sp('pale-chub'))).toBe('사계절')
  })
  test('legend spot comes from spots: shore → 해안, unknown id stays as is', () => {
    const grouper = sp('grouper')
    expect(conditionLabel({ ...grouper, spots: ['shore'] })).toBe('해안 · 겨울')
    expect(conditionLabel({ ...grouper, spots: ['zzz'] })).toBe('zzz · 겨울')
  })
})

describe('fishing Game: walking and interaction', () => {
  test('at the spawn spot the touch action reads 상점; the shop opens on release, not on press', async () => {
    stubTouch()
    await mount(makeView(), null)
    expect(actionButton()).toHaveTextContent('상점')
    expect(actionButton()).toHaveAttribute('aria-disabled', 'false')
    const btn = actionButton()
    pointer('down', btn, 2)
    expect(screen.queryByRole('region', { name: '상점' })).not.toBeInTheDocument()
    pointer('up', btn, 2)
    expect(screen.getByRole('region', { name: '상점' })).toBeInTheDocument()
    // 메뉴가 열린 동안 조작은 숨는다
    expect(screen.queryByTestId('fish-action')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전부 팔기' })).toBeInTheDocument()
  })

  test('Space opens the shop on keyup, not keydown', async () => {
    await mount(makeView(), null)
    press()
    expect(screen.queryByRole('region', { name: '상점' })).not.toBeInTheDocument()
    release()
    expect(screen.getByRole('region', { name: '상점' })).toBeInTheDocument()
  })

  test('a click landing on a shop button within 300ms of opening does nothing (no ghost click)', async () => {
    stubTouch()
    const rich = makeView({ gold: 2000 })
    await mount(rich, null)
    route({ buyRod: () => ok({ ...rich, gold: 500, rodTier: 2 }) })
    pointer('down', actionButton(), 2)
    pointer('up', actionButton(), 2)
    fireEvent.click(screen.getByRole('button', { name: '구매' }))
    await advance(250)
    fireEvent.click(screen.getByRole('button', { name: '구매' }))
    await flush()
    expect(calls('buyRod')).toHaveLength(0)
    await advance(60)
    fireEvent.click(screen.getByRole('button', { name: '구매' }))
    await flush()
    expect(calls('buyRod')).toHaveLength(1)
  })

  test('releasing the shop action after walking away from the door does not open the shop', async () => {
    await mount(makeView(), null)
    press()
    key('ArrowRight', true)
    await advance(500)
    key('ArrowRight', false)
    release()
    expect(screen.queryByRole('region', { name: '상점' })).not.toBeInTheDocument()
  })

  test('touch: a press on the joystick during a bite hooks like a canvas press', async () => {
    await touchCastToBite()
    expect(calls('hook')).toHaveLength(0)
    pointer('down', stick(), 5, 100, 100)
    await flush()
    expect(calls('hook')).toHaveLength(1)
  })

  test('touch: holding the joystick during a fight reels, and it does not walk', async () => {
    await touchCastToBite()
    pointer('down', stick(), 5, 100, 100) // 챔
    await flush()
    pointer('move', stick(), 5, 140, 100)
    await advance(100)
    expect(lastBar().barVel).toBeGreaterThan(0)
    expect(lastPlayer().pos).toEqual(PIER.pos)
    pointer('up', stick(), 5, 140, 100)
    await advance(100)
    expect(lastBar().barVel).toBeLessThan(0)
  })

  test('fight: lifting another finger does not release the bar while the action button is held', async () => {
    await touchCastToBite()
    pointer('down', actionButton(), 2) // 챔, 계속 누르고 있다
    await flush()
    await advance(50)
    fireEvent.pointerDown(canvas(), { pointerId: 9 })
    fireEvent.pointerUp(canvas(), { pointerId: 9 })
    await advance(100)
    expect(lastBar().barVel).toBeGreaterThan(0)
    pointer('up', actionButton(), 2)
    await advance(100)
    expect(lastBar().barVel).toBeLessThan(0)
  })

  test('a lost pointer capture on the joystick stops walking; on the action button it ends the press', async () => {
    stubTouch()
    const view = makeView()
    const p = pending()
    const { unmount } = await mount(view, SAND)
    pointer('down', stick(), 1, 100, 100)
    pointer('move', stick(), 1, 160, 100)
    await advance(200)
    expect(lastPlayer().moving).toBe(true)
    fireEvent(stick(), new TestPointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }))
    await advance(50)
    const stopped = lastPlayer().pos
    await advance(200)
    expect(lastPlayer().pos).toEqual(stopped)
    unmount()

    await mount(view, SHORE)
    route({ cast: () => ok({ ...view, pending: p }, p) })
    pointer('down', actionButton(), 2)
    await advance(300)
    fireEvent(actionButton(), new TestPointerEvent('lostpointercapture', { bubbles: true, pointerId: 2 }))
    await flush()
    expect(calls('cast')).toHaveLength(1)
  })

  test('the joystick knob is drawn from where the finger first touched', async () => {
    stubTouch()
    await mount(makeView(), SAND)
    const knob = stick().querySelector('.fish-stick-knob') as HTMLElement
    pointer('down', stick(), 1, 30, 70) // 받침 왼쪽 위 (jsdom 상자는 0,0)
    expect(knob.style.left).toBe('30px')
    expect(knob.style.top).toBe('70px')
    pointer('move', stick(), 1, 50, 70)
    expect(knob.style.left).toBe('50px')
    pointer('move', stick(), 1, 130, 70) // 반지름(36) 넘게 밀면 손잡이는 반지름에서 멈춘다
    expect(knob.style.left).toBe('66px')
    pointer('up', stick(), 1, 130, 70)
    expect(knob.style.left).toBe('')
  })

  test('at the pier end the action reads 낚시 and a cast sends spot pier; on the sand shore spot shore', async () => {
    stubTouch()
    const view = makeView()
    const p = pending()
    const { unmount } = await mount(view, PIER)
    route({ cast: () => ok({ ...view, pending: p }, p) })
    expect(actionButton()).toHaveTextContent('낚시')
    expect(actionButton()).toHaveAttribute('aria-disabled', 'false')
    pointer('down', actionButton(), 2)
    await advance(300)
    pointer('up', actionButton(), 2)
    await flush()
    expect((calls('cast')[0] as unknown as { payload: { spot: string } }).payload.spot).toBe('pier')
    unmount()

    await mount(view, SHORE)
    route({ cast: () => ok({ ...view, pending: p }, p) })
    expect(actionButton()).toHaveTextContent('낚시')
    pointer('down', actionButton(), 2)
    await advance(300)
    pointer('up', actionButton(), 2)
    await flush()
    expect((calls('cast')[1] as unknown as { payload: { spot: string } }).payload.spot).toBe('shore')
  })

  test('the action button is disabled where there is neither water nor the shop door', async () => {
    stubTouch()
    await mount(makeView(), SAND)
    expect(actionButton()).toHaveTextContent('낚시')
    // disabled 속성 대신 aria-disabled: 눌렀다 뗀 알림이 늘 온다
    expect(actionButton()).toHaveAttribute('aria-disabled', 'true')
    expect(actionButton()).not.toHaveAttribute('disabled')
  })

  test('the bottom row has bag, dex, challenges, map and fullscreen but no shop; the bag says where to sell', async () => {
    const { container } = await mount()
    const bottom = container.querySelector('.fish-bottom') as HTMLElement
    expect(within(bottom).getAllByRole('button').map((b) => b.textContent)).toEqual(['가방', '도감', '과제', '지도', '전체화면'])
    expect(screen.queryByRole('button', { name: '상점' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    expect(within(screen.getByRole('region', { name: '가방' })).getByText('상점에서 팔 수 있어요')).toBeInTheDocument()
  })

  test('the bag panel has no sell hint when standing at the shop', async () => {
    await mount(makeView(), null)
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    expect(screen.queryByText('상점에서 팔 수 있어요')).not.toBeInTheDocument()
  })

  test('터치에서는 시계를 안내 줄 아래(hudTopFor)에, 데스크톱은 맨 위(0)에 그린다', async () => {
    const { unmount } = await mount()
    await advance(50)
    expect(vi.mocked(drawWorld).mock.calls.at(-1)?.[1].hudTop).toBe(0)
    unmount()
    stubTouch()
    await mount()
    await advance(50)
    const call = vi.mocked(drawWorld).mock.calls.at(-1)
    const scale = parseInt((canvas() as HTMLCanvasElement).style.width) / (canvas() as HTMLCanvasElement).width
    expect(call?.[1].hudTop).toBe(hudTopFor(true, scale))
    expect(call?.[1].hudTop).toBeGreaterThan(0)
  })

  test('desktop hides the touch controls and shows the keyboard hint', async () => {
    await mount()
    expect(screen.queryByTestId('fish-action')).not.toBeInTheDocument()
    expect(screen.queryByTestId('fish-stick')).not.toBeInTheDocument()
    expect(screen.getByText('방향키로 이동 · 스페이스로 낚시/상점')).toBeInTheDocument()
  })

  test('desktop: arrow keys and WASD walk the character', async () => {
    const { unmount } = await mount(makeView(), PIER)
    await advance(50)
    expect(lastPlayer().pos).toEqual(PIER.pos)
    key('ArrowUp', true)
    await advance(500)
    const up = lastPlayer()
    expect(up.pos.x).toBe(PIER.pos.x)
    expect(up.pos.y).toBeLessThan(PIER.pos.y - 20) // 48px/s × 0.5s ≈ 24px
    expect(up.facing).toBe('up')
    expect(up.moving).toBe(true)
    key('ArrowUp', false)
    await advance(50)
    expect(lastPlayer().moving).toBe(false)
    unmount()

    await mount(makeView(), SAND)
    key('KeyD', true)
    await advance(500)
    expect(lastPlayer().pos.x).toBeGreaterThan(SAND.pos.x + 20)
    expect(lastPlayer().facing).toBe('right')
  })

  test('the camera follows the rounded player position', async () => {
    // 홀수 폭(195)에서 반올림하지 않은 x(392.6)로 재면 295, 반올림한 x(393)로 재면 296
    const restore = stubStage({ width: 390, top: 82, innerH: 650 })
    try {
      await mount(makeView(), { pos: { x: 392.6, y: 328 }, facing: 'down' })
      await advance(50)
      const call = vi.mocked(drawWorld).mock.calls.at(-1)
      expect(call?.[2]).toEqual({ w: 195, h: 280 })
      expect(call?.[1].camera).toEqual({ x: 296, y: 188 })
    } finally {
      restore()
    }
  })

  test('stopping saves the position, and unmounting saves it too', async () => {
    const { unmount } = await mount(makeView(), PIER)
    key('ArrowUp', true)
    await advance(300)
    key('ArrowUp', false)
    await advance(50)
    const stopped = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as At
    expect(stopped.pos).toEqual(lastPlayer().pos)
    expect(stopped.pos.y).toBeLessThan(PIER.pos.y)
    expect(stopped.facing).toBe('up')

    key('ArrowUp', true)
    await advance(200)
    const walking = lastPlayer().pos
    expect(walking.y).toBeLessThan(stopped.pos.y)
    unmount()
    expect((JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as At).pos).toEqual(walking)
  })

  test('an unusable saved position starts at the spawn spot', async () => {
    stubTouch()
    await mount(makeView(), { pos: tileCenter(10, 30), facing: 'down' }) // 바다 한가운데
    await advance(50)
    expect(lastPlayer().pos).toEqual(SPAWN.pos)
    expect(lastPlayer().facing).toBe(SPAWN.facing)
    expect(actionButton()).toHaveTextContent('상점')
  })

  test('losing window focus or opening a menu clears held movement keys', async () => {
    await mount(makeView(), PIER)
    key('ArrowUp', true)
    await advance(200)
    act(() => { window.dispatchEvent(new Event('blur')) })
    await advance(50)
    const afterBlur = lastPlayer().pos
    await advance(300)
    expect(lastPlayer().pos).toEqual(afterBlur)

    key('ArrowUp', true)
    await advance(100)
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await advance(50)
    const afterMenu = lastPlayer().pos
    await advance(300)
    expect(lastPlayer().pos).toEqual(afterMenu)
  })

  test('touch: the joystick walks the character and letting go stops it', async () => {
    stubTouch()
    await mount(makeView(), SAND)
    pointer('down', stick(), 1, 100, 100)
    pointer('move', stick(), 1, 160, 100)
    await advance(500)
    const moved = lastPlayer()
    expect(moved.pos.x).toBeGreaterThan(SAND.pos.x + 20)
    expect(moved.facing).toBe('right')
    pointer('up', stick(), 1, 160, 100)
    await advance(50)
    const stopped = lastPlayer().pos
    await advance(300)
    expect(lastPlayer().pos).toEqual(stopped)
    expect(lastPlayer().moving).toBe(false)
  })

  test('while charging, joystick input moves nothing and does not turn the character', async () => {
    stubTouch()
    const view = makeView()
    const p = pending()
    await mount(view, SHORE)
    route({ cast: () => ok({ ...view, pending: p }, p) })
    pointer('down', actionButton(), 2)
    pointer('down', stick(), 1, 100, 100)
    pointer('move', stick(), 1, 40, 100) // 왼쪽으로 끝까지
    await advance(400)
    expect(lastPlayer().pos).toEqual(SHORE.pos)
    expect(lastPlayer().facing).toBe('down')
    pointer('up', actionButton(), 2)
    await flush()
    expect((calls('cast')[0] as unknown as { payload: { spot: string } }).payload.spot).toBe('shore')
  })

  test('two fingers: action down/up does not cut the joystick, and lifting the joystick does not cut a charge', async () => {
    stubTouch()
    const view = makeView()
    const p = pending()
    const { unmount } = await mount(view, SAND)
    // 걷는 중 다른 손가락으로 (비활성) 행동 버튼을 눌렀다 뗀다 → 계속 걷는다
    pointer('down', stick(), 1, 100, 100)
    pointer('move', stick(), 1, 160, 100)
    await advance(200)
    const x1 = lastPlayer().pos.x
    expect(x1).toBeGreaterThan(SAND.pos.x)
    pointer('down', actionButton(), 2)
    pointer('up', actionButton(), 2)
    await advance(200)
    expect(lastPlayer().pos.x).toBeGreaterThan(x1 + 5)
    expect(lastPlayer().moving).toBe(true)
    unmount()

    // 물가에서 행동 버튼으로 충전하는 동안 조이스틱 손가락을 떼도 충전은 이어진다
    await mount(view, SHORE)
    route({ cast: () => ok({ ...view, pending: p }, p) })
    pointer('down', actionButton(), 2)
    pointer('down', stick(), 1, 100, 100)
    pointer('move', stick(), 1, 100, 140)
    await advance(200)
    pointer('up', stick(), 1, 100, 140)
    await advance(200)
    expect(calls('cast')).toHaveLength(0)
    expect(screen.getByText('떼면 던져요')).toBeInTheDocument()
    pointer('up', actionButton(), 2)
    await flush()
    const sent = calls('cast') as unknown as { payload: { power: number; spot: string } }[]
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.power).toBeGreaterThan(0.3) // 400ms 내내 모았다
  })

  test('touch fullscreen: notices sit at the top, let presses through, and the action button still works', async () => {
    stubTouch()
    const restore = stubStage({ width: 390, height: 700, top: 82, innerH: 650 })
    try {
      const view = makeView()
      const { container } = await mount(view, PIER)
      fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
      route({ cast: () => Promise.reject(new ApiError('bag_full', 400)) })
      pointer('down', actionButton(), 2)
      await advance(200)
      pointer('up', actionButton(), 2)
      await flush()
      const layer = container.querySelector('.fish-notices') as HTMLElement
      expect(layer).toHaveTextContent('상점에 가서 팔아 주세요')
      // 조작이 있는 아래쪽이 아니라 위쪽에 뜬다
      expect(layer).toHaveClass('fish-notices-top')
      // 알림 층은 누르기를 받지 않는다(알림 안의 버튼만 받는다)
      const rule = (sel: string) => fishingCss.match(new RegExp(`(^|\\n)${sel.replace(/[.*]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[2] ?? ''
      expect(rule('.fish-notices')).toMatch(/pointer-events:\s*none/)
      expect(rule('.fish-notices-top')).toMatch(/top:\s*8px/)
      expect(rule('.fish-notices-top')).toMatch(/bottom:\s*auto/)
      expect(rule('.fish-notices button')).toMatch(/pointer-events:\s*auto/)
      // 알림이 떠 있어도 행동 버튼은 누르기를 받는다
      const p = pending()
      route({ cast: () => ok({ ...view, pending: p }, p) })
      pointer('down', actionButton(), 3)
      expect(screen.getByText('떼면 던져요')).toBeInTheDocument()
      await advance(200)
      pointer('up', actionButton(), 3)
      await flush()
      expect(calls('cast')).toHaveLength(2)
    } finally {
      restore()
    }
  })

  test('desktop fullscreen notices stay at the bottom of the canvas', async () => {
    const restore = stubStage({ width: 390, height: 700, top: 82, innerH: 650 })
    try {
      const { container } = await mount()
      fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
      route({ cast: () => Promise.reject(new ApiError('bag_full', 400)) })
      press()
      await advance(200)
      release()
      await flush()
      const layer = container.querySelector('.fish-notices') as HTMLElement
      expect(layer).toHaveTextContent('상점에 가서 팔아 주세요')
      expect(layer).not.toHaveClass('fish-notices-top')
    } finally {
      restore()
    }
  })

  test('losing focus while charging returns to idle and never casts (Space and the touch button)', async () => {
    const view = makeView()
    const p = pending()
    const { unmount } = await mount(view, PIER)
    route({ cast: () => ok({ ...view, pending: p }, p) })
    press()
    await advance(300)
    expect(screen.getByText('떼면 던져요')).toBeInTheDocument()
    act(() => { window.dispatchEvent(new Event('blur')) })
    await advance(50)
    expect(screen.queryByText('떼면 던져요')).not.toBeInTheDocument()
    expect(vi.mocked(drawWorld).mock.calls.at(-1)?.[1].phase).toBe('idle')
    release()
    await flush()
    expect(calls('cast')).toHaveLength(0)
    unmount()

    stubTouch()
    await mount(view, PIER)
    route({ cast: () => ok({ ...view, pending: p }, p) })
    pointer('down', actionButton(), 2)
    await advance(300)
    expect(screen.getByText('떼면 던져요')).toBeInTheDocument()
    act(() => { window.dispatchEvent(new Event('blur')) })
    await flush()
    expect(screen.queryByText('떼면 던져요')).not.toBeInTheDocument()
    expect(actionButton()).not.toHaveClass('fish-action-on')
    pointer('up', actionButton(), 2)
    await flush()
    expect(calls('cast')).toHaveLength(0)
  })

  test('the page being hidden while charging also returns to idle without casting', async () => {
    const view = makeView()
    const p = pending()
    await mount(view, PIER)
    route({ cast: () => ok({ ...view, pending: p }, p) })
    press()
    await advance(300)
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    vis.mockReturnValue('visible')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await advance(50)
    expect(vi.mocked(drawWorld).mock.calls.at(-1)?.[1].phase).toBe('idle')
    release()
    await flush()
    expect(calls('cast')).toHaveLength(0)
  })

  test('after losing focus with Space held, the fight bar is not pulled up without input', async () => {
    const view = makeView()
    await castAndWait(view, 3000)
    route({ hook: () => ok(view, { species: 'anchovy', sizeCm: 10 }), resolve: () => new Promise(() => {}) })
    await advance(3100)
    press() // 챔, 스페이스를 계속 누르고 있다
    await flush()
    await advance(100)
    expect(lastBar().barVel).toBeGreaterThan(0)
    // 창이 초점을 잃어 keyup이 오지 않는다
    act(() => { window.dispatchEvent(new Event('blur')) })
    await advance(150)
    expect(lastBar().barVel).toBeLessThan(0)
  })

  test('a stale shop press (release lost) does not swallow the next cast release at the water', async () => {
    const view = makeView()
    const p = pending()
    await mount(view, null) // 상점 문 앞 (12, 6)
    press() // 상점 행동을 눌렀지만 뗀 알림을 잃었다 (창 초점은 그대로)
    // (13, 6)으로 한 칸 옮긴 뒤 아래로 곧장 내려가 (13, 25) 물가에서 바다를 본다
    key('ArrowRight', true)
    await advance(Math.round((TILE * 1000) / WALK_SPEED) + 20) // 한 칸 남짓
    key('ArrowRight', false)
    key('ArrowDown', true)
    await advance(7500)
    key('ArrowDown', false)
    await advance(50)
    expect(Math.floor(lastPlayer().pos.y / TILE)).toBe(25)
    expect(lastPlayer().facing).toBe('down')
    route({ cast: () => ok({ ...view, pending: p }, p) })
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    await advance(300)
    release()
    await flush()
    expect(calls('cast')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: '상점' })).not.toBeInTheDocument()
  })

  test('a lost pointer capture on the canvas releases its press', async () => {
    const view = makeView()
    await castAndWait(view, 3000)
    route({ hook: () => ok(view, { species: 'anchovy', sizeCm: 10 }), resolve: () => new Promise(() => {}) })
    await advance(3100)
    fireEvent.pointerDown(canvas(), { pointerId: 9 }) // 챔, 계속 누른다
    await flush()
    await advance(100)
    expect(lastBar().barVel).toBeGreaterThan(0)
    fireEvent(canvas(), new TestPointerEvent('lostpointercapture', { bubbles: true, pointerId: 9 }))
    await advance(150)
    expect(lastBar().barVel).toBeLessThan(0)
  })

  test('touch: a press on the disabled action button does nothing, but its release is still handled', async () => {
    stubTouch()
    const view = makeView()
    const p = pending()
    await mount(view, SAND)
    route({ cast: () => ok({ ...view, pending: p }, p) })
    pointer('down', actionButton(), 2)
    expect(actionButton()).not.toHaveClass('fish-action-on')
    pointer('up', actionButton(), 2)
    await flush()
    expect(calls('cast')).toHaveLength(0)
  })

  test('touch: a joystick touch that starts while the catch is shown walks once the phase is idle, without lifting', async () => {
    stubTouch()
    const view = makeView()
    await mount(view, PIER)
    route({
      cast: () => { const p = pending(3000); return ok({ ...view, pending: p }, p) },
      hook: () => ok(view, { species: 'mackerel', sizeCm: 40 }),
      resolve: () => {
        const fish = { species: 'mackerel', sizeCm: 40, perfect: false }
        return ok({ ...view, bag: [fish], dex: { mackerel: { count: 1, maxCm: 40 } } }, { caught: fish })
      },
    })
    pointer('down', actionButton(), 2)
    await advance(300)
    pointer('up', actionButton(), 2)
    await flush()
    await advance(3100)
    pointer('down', actionButton(), 2) // 챔
    pointer('up', actionButton(), 2)
    await flush()
    vi.mocked(barResult).mockImplementation(() => 'caught')
    await advance(MIN_FIGHT_MS + 200)
    expect(screen.getByText(/고등어 40cm/)).toBeInTheDocument()
    vi.mocked(barResult).mockImplementation(actualMinigame.barResult)
    // 결과가 떠 있는 동안 조이스틱을 위로 밀고 있다
    pointer('down', stick(), 5, 100, 100)
    pointer('move', stick(), 5, 100, 40)
    await advance(300)
    expect(lastPlayer().pos).toEqual(PIER.pos)
    await advance(1200) // 결과가 닫히고 대기로 돌아온다
    expect(screen.queryByText(/고등어 40cm/)).not.toBeInTheDocument()
    await advance(300)
    expect(lastPlayer().pos.y).toBeLessThan(PIER.pos.y - 5)
    expect(calls('resolve')).toHaveLength(1)
  })

  test('touch: a joystick tap while waiting for a bite sends nothing', async () => {
    stubTouch()
    const view = makeView()
    await mount(view, PIER)
    route({
      cast: () => { const p = pending(3000); return ok({ ...view, pending: p }, p) },
      resolve: () => ok(view, { caught: null }),
    })
    pointer('down', actionButton(), 2)
    await advance(300)
    pointer('up', actionButton(), 2)
    await flush()
    await advance(1000)
    expect(screen.getByText('입질을 기다리는 중…')).toBeInTheDocument()
    pointer('down', stick(), 5, 100, 100)
    await advance(100)
    pointer('up', stick(), 5, 100, 100)
    await flush()
    expect(calls('resolve')).toHaveLength(0)
    expect(calls('hook')).toHaveLength(0)
    expect(screen.getByText('입질을 기다리는 중…')).toBeInTheDocument()
  })

  test('desktop: after the bag or dex button (and the panel close button) focus returns to the game so Space casts', async () => {
    const view = makeView()
    const { container } = await mount(view, PIER)
    const root = container.querySelector('.fish') as HTMLElement
    for (const name of ['가방', '도감']) {
      const btn = screen.getByRole('button', { name })
      btn.focus()
      fireEvent.click(btn)
      expect(document.activeElement).toBe(root)
      const close = screen.getByRole('button', { name: '닫기' })
      close.focus()
      fireEvent.click(close)
      expect(document.activeElement).toBe(root)
    }
    const p = pending()
    route({ cast: () => ok({ ...view, pending: p }, p) })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: ' ', code: 'Space' })
    await advance(300)
    fireEvent.keyUp(document.activeElement as HTMLElement, { key: ' ', code: 'Space' })
    await flush()
    expect(calls('cast')).toHaveLength(1)
  })

  test('shop: a bag upgrade is buyable with exactly enough gold and sends buyBag', async () => {
    const view = makeView({ gold: 800 })
    await mountAtShop(view)
    route({ buyBag: () => ok({ ...view, gold: 0, bagTier: 2 }) })
    const bags = screen.getByRole('list', { name: '가방 목록' })
    const buy = within(bags).getByRole('button', { name: '30칸 가방 구매' })
    expect(buy).toBeEnabled()
    expect(within(bags).getByText('800 G')).toBeInTheDocument()
    fireEvent.click(buy)
    await flush()
    expect(calls('buyBag')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'buyBag', tier: 2 } }])
    expect(screen.getByText('0/30')).toBeInTheDocument()
  })

  test('shop: a bag upgrade is disabled one gold short, and the top bag says so', async () => {
    const { unmount } = await mountAtShop(makeView({ gold: 799 }))
    const bags = screen.getByRole('list', { name: '가방 목록' })
    expect(within(bags).getByRole('button', { name: '30칸 가방 구매' })).toBeDisabled()
    expect(within(bags).getByText('골드가 부족해요')).toBeInTheDocument()
    unmount()

    await mountAtShop(makeView({ gold: 99999, bagTier: 5, rodTier: 1 }))
    const top = screen.getByRole('list', { name: '가방 목록' })
    expect(within(top).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('최고 단계예요')).toBeInTheDocument()
    expect(screen.getByText('0/60')).toBeInTheDocument()
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

describe('hudTopFor', () => {
  test('데스크톱은 0, 터치는 안내 줄 띠(CSS px)를 배율로 나눠 올림한 논리 px', () => {
    expect(hudTopFor(false, 1)).toBe(0)
    expect(hudTopFor(false, 2)).toBe(0)
    expect(hudTopFor(true, 1)).toBe(44)
    expect(hudTopFor(true, 2)).toBe(22)
    expect(hudTopFor(true, 3)).toBe(15)
    expect(hudTopFor(true, 4)).toBe(11)
  })

  test('안내 줄 띠는 .fish-hint-top의 위 여백 + 한 줄 높이 + 틈 4px', () => {
    const rule = (sel: string) => fishingCss.match(new RegExp(`(^|\\n)${sel.replace(/[.*]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[2] ?? ''
    const px = (css: string, prop: string) => Number(css.match(new RegExp(`${prop}:\\s*(\\d+)px`))?.[1])
    const top = px(rule('.fish-hint-top'), 'top')
    const lineHeight = px(rule('.fish-hint-top'), 'line-height')
    const padY = px(rule('.fish-hint'), 'padding')
    const nowrap = rule('.fish-hint-top')
    expect(nowrap).toMatch(/white-space:\s*nowrap/)
    expect(TOUCH_HINT_BAND).toBe(top + padY * 2 + lineHeight + 4)
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


const lastScene = () => {
  const call = vi.mocked(drawWorld).mock.calls.at(-1)
  if (!call) throw new Error('drawWorld was not called')
  return call[1]
}
/** 맵에서 낚시 자리 id가 spot인 걸을 수 있는 자리와 방향. 기본 지역만 열린 것으로 본다(잠긴 문 칸 위는 고르지 않는다) */
function fishingAt(map: MapDef, spot: string): At {
  const base = new Set<AreaId>(DEFAULT_AREAS)
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++)
      for (const facing of ['up', 'down', 'left', 'right'] as const) {
        const pos = tileCenter(tx, ty)
        if (feetBlocked(map, pos.x, pos.y, base)) continue
        const at = interactionAt(map, pos, facing, base)
        if (at?.kind === 'fish' && at.spot === spot) return { area: map.id, pos, facing }
      }
  throw new Error(`no ${spot} spot in ${map.id}`)
}

describe('fishing Game: 지역 전환', () => {
  /** 마을 북쪽 출구 바로 아래 칸에서 위를 보고 시작 */
  const NEAR_EXIT: At = { area: 'village', pos: tileCenter(24, 1), facing: 'up' }
  const ENTRY = VILLAGE.exits[0].entry

  /** 마을 북쪽 출구를 걸어 나가 페이드가 끝날 때까지 기다린다 */
  async function walkToRiver() {
    await mount(makeView(), NEAR_EXIT)
    key('ArrowUp', true)
    await advance(200)
    key('ArrowUp', false)
    expect(lastScene().fade).toBeGreaterThan(0) // 전환 중
    await advance(400)
  }

  test('북쪽 출구로 걸어가면 페이드 뒤 강 맵의 entry 자리에 서고, 위치가 {area:river}로 저장된다', async () => {
    await mount(makeView(), NEAR_EXIT)
    await advance(50)
    expect(lastScene().map.id).toBe('village')
    key('ArrowUp', true)
    await advance(200)
    key('ArrowUp', false)
    // 페이드 아웃 중에는 아직 마을
    expect(lastScene().map.id).toBe('village')
    expect(lastScene().fade).toBeGreaterThan(0)
    await advance(400)
    const scene = lastScene()
    expect(scene.map.id).toBe('river')
    expect(scene.fade).toBe(0)
    expect(scene.player.pos).toEqual(tileCenter(ENTRY.tx, ENTRY.ty))
    expect(scene.player.facing).toBe(ENTRY.facing)
    expect(JSON.parse(localStorage.getItem(POS_KEY) ?? 'null')).toEqual({
      area: 'river', pos: tileCenter(ENTRY.tx, ENTRY.ty), facing: ENTRY.facing,
    })
  })

  test('장면의 opened는 서버 상태 areas의 집합이다', async () => {
    await mount(makeView({ areas: ['village', 'river', 'forest', 'lake'] }), NEAR_EXIT)
    await advance(50)
    expect([...lastScene().opened].sort()).toEqual(['forest', 'lake', 'river', 'village'])
  })

  test('전환 중(페이드 아웃·인)에는 방향키를 눌러도 움직이지 않는다', async () => {
    await mount(makeView(), NEAR_EXIT)
    await advance(50)
    key('ArrowUp', true)
    await advance(130)
    key('ArrowUp', false)
    const before = { ...lastScene().player.pos }
    expect(lastScene().fade).toBeGreaterThan(0)
    key('ArrowLeft', true)
    await advance(15)
    expect(lastScene().player.pos).toEqual(before) // 페이드 아웃 중
    await advance(160)
    expect(lastScene().map.id).toBe('river') // 페이드 인 중
    expect(lastScene().fade).toBeGreaterThan(0)
    expect(lastScene().player.pos).toEqual(tileCenter(ENTRY.tx, ENTRY.ty))
    key('ArrowLeft', false)
    await advance(400)
    expect(lastScene().player.pos).toEqual(tileCenter(ENTRY.tx, ENTRY.ty))
  })

  test('도착 직후 0.5초 동안 입력이 없거나 반대 방향으로 한 걸음 걸어도 다시 마을로 가지 않는다', async () => {
    await walkToRiver()
    await advance(500)
    expect(lastScene().map.id).toBe('river')
    key('ArrowDown', true) // 들어온 출구 쪽(entry는 출구 두 칸 안쪽)
    await advance(150)
    key('ArrowDown', false)
    await advance(500)
    expect(lastScene().map.id).toBe('river')
    expect(JSON.parse(localStorage.getItem(POS_KEY) ?? 'null').area).toBe('river')
  })

  test('지역에 들어가면 지역 이름 알림이 1.5초 보인다', async () => {
    await walkToRiver()
    expect(screen.getByText('마을 강')).toBeInTheDocument()
    await advance(1600)
    expect(screen.queryByText('마을 강')).not.toBeInTheDocument()
  })

  test('저장된 {area:river}에서 시작하면 강 맵으로 시작한다', async () => {
    await mount(makeView(), { area: 'river', pos: tileCenter(ENTRY.tx, ENTRY.ty), facing: 'up' })
    await advance(100)
    expect(lastScene().map.id).toBe('river')
  })

  test('강에서 물을 보고 던지면 cast 페이로드가 {area:river, spot:river}', async () => {
    const view = makeView()
    const p = pending()
    await mount(view, fishingAt(RIVER, 'river'))
    route({ cast: () => ok({ ...view, pending: p }, p) })
    press()
    await advance(300)
    release()
    await flush()
    const payload = (calls('cast')[0] as unknown as { payload: { area: string; spot: string } }).payload
    expect(payload.area).toBe('river')
    expect(payload.spot).toBe('river')
  })

  test('숲 연못에서 던지면 {area:forest, spot:pond}', async () => {
    const view = makeView()
    const p = pending()
    await mount(view, fishingAt(FOREST, 'pond'))
    route({ cast: () => ok({ ...view, pending: p }, p) })
    press()
    await advance(300)
    release()
    await flush()
    const payload = (calls('cast')[0] as unknown as { payload: { area: string; spot: string } }).payload
    expect(payload.area).toBe('forest')
    expect(payload.spot).toBe('pond')
  })

  test('조이스틱을 누른 채 출구를 지나면 새 pointermove 없이도 페이드 뒤에 이어서 걷는다', async () => {
    stubTouch()
    await mount(makeView(), NEAR_EXIT)
    await advance(50)
    pointer('down', stick(), 1, 100, 100)
    pointer('move', stick(), 1, 100, 40) // 위로 끝까지, 이후 움직이지 않는다
    await advance(200)
    expect(lastScene().fade).toBeGreaterThan(0)
    await advance(400)
    expect(lastScene().map.id).toBe('river')
    expect(lastScene().fade).toBe(0)
    const arrived = { ...lastScene().player.pos }
    await advance(300)
    expect(lastScene().player.pos.y).toBeLessThan(arrived.y)
    expect(lastScene().player.moving).toBe(true)
  })

  test('출구 칸의 위치는 저장하지 않고 도착 위치만 저장한다', async () => {
    await mount(makeView(), NEAR_EXIT)
    const saved: { area: string; pos: Vec }[] = []
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === POS_KEY) saved.push(JSON.parse(v))
      return setItem.call(this, k, v)
    })
    await advance(50)
    key('ArrowUp', true)
    await advance(200)
    key('ArrowUp', false)
    await advance(400)
    expect(lastScene().map.id).toBe('river')
    expect(saved.length).toBeGreaterThan(0)
    expect(saved.at(-1)).toMatchObject({ area: 'river' })
    for (const s of saved) expect(exitAt(s.area === 'river' ? RIVER : VILLAGE, s.pos)).toBeNull()
  })

  test('맵이 없는 지역으로 가는 출구는 무시한다: 페이드를 시작하지 않고 갇히지 않는다', async () => {
    mapGate.hideRiver = true
    try {
      await mount(makeView(), NEAR_EXIT)
      await advance(50)
      key('ArrowUp', true)
      await advance(600)
      key('ArrowUp', false)
      expect(lastScene().map.id).toBe('village')
      expect(lastScene().fade).toBe(0)
      const stuck = lastScene().player.pos.y
      key('ArrowDown', true) // 갇히지 않는다
      await advance(200)
      key('ArrowDown', false)
      expect(lastScene().player.pos.y).toBeGreaterThan(stuck)
    } finally {
      mapGate.hideRiver = false
    }
  })

  test('큰 dt 한 번(맵 캐시를 만드는 프레임의 멈칫)이 와도 페이드 인이 건너뛰어지지 않는다', async () => {
    await mount(makeView(), NEAR_EXIT)
    await advance(50)
    key('ArrowUp', true)
    await advance(200)
    key('ArrowUp', false)
    const tr = lastScene().fade
    expect(tr).toBeGreaterThan(0)
    // 한 프레임이 500ms 걸린 것처럼 시간을 뛰어도 한 번에 끝나지 않는다
    const raf = vi.spyOn(performance, 'now')
    raf.mockReturnValue(performance.now() + 500)
    await advance(16)
    raf.mockRestore()
    expect(lastScene().fade).toBeGreaterThan(0)
  })
})

/** 산 호수 남쪽 출구 두 칸 안쪽(강에서 들어오는 자리) */
const LAKE_ENTRY = RIVER.exits.find((e) => e.target === 'lake')!.entry

describe('fishing Game: 지역 해금·배 타기', () => {
  const BASE: AreaId[] = [...DEFAULT_AREAS]
  const unlockPanel = () => screen.getByRole('region', { name: '지역 열기' })
  const savedPos = () => JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as At
  /** 강 골짜기 무너진 다리 남쪽 길에서 위(다리)를 본다 */
  const RIVER_GATE = RIVER.gates[0]
  const AT_BRIDGE: At = { area: 'river', pos: tileCenter(RIVER_GATE.front.tx, RIVER_GATE.front.ty), facing: RIVER_GATE.front.facing }
  const VILLAGE_DOCK = VILLAGE.docks[0]
  const AT_VILLAGE_DOCK: At = { area: 'village', pos: tileCenter(VILLAGE_DOCK.front.tx, VILLAGE_DOCK.front.ty), facing: VILLAGE_DOCK.front.facing }
  const ISLAND_DOCK = ISLAND.docks[0]
  const AT_ISLAND_DOCK: At = { area: 'island', pos: tileCenter(ISLAND_DOCK.front.tx, ISLAND_DOCK.front.ty), facing: ISLAND_DOCK.front.facing }
  /** 행동(스페이스)을 눌렀다 떼고, 창이 열렸으면 유령 클릭 방지 시간을 넘긴다 */
  async function interact() {
    press()
    release()
    await advance(300)
  }

  test('잠긴 다리 앞: 안내는 살펴보기, 행동 → 해금 창(무너진 다리 수리 · 5,000 G · 보유 골드); 골드가 모자라면 열기 비활성·문구', async () => {
    const { unmount } = await mount(makeView({ gold: 4999, areas: BASE }), AT_BRIDGE)
    await advance(50)
    expect(screen.getByText('방향키로 이동 · 스페이스로 살펴보기')).toBeInTheDocument()
    await interact()
    const panel = unlockPanel()
    expect(within(panel).getByText('무너진 다리 수리')).toBeInTheDocument()
    expect(within(panel).getByText('5,000 G')).toBeInTheDocument()
    expect(within(panel).getByText('보유 4,999 G')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '열기' })).toBeDisabled()
    expect(within(panel).getByText('골드가 모자라요')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '산 호수' })).toBeInTheDocument()
    unmount()

    await mount(makeView({ gold: 5000, areas: BASE }), AT_BRIDGE)
    await interact()
    expect(within(unlockPanel()).getByRole('button', { name: '열기' })).toBeEnabled()
    expect(within(unlockPanel()).queryByText('골드가 모자라요')).not.toBeInTheDocument()
  })

  test('터치: 잠긴 다리 앞 행동 버튼은 살펴보기, 선착장 앞은 배 타기', async () => {
    stubTouch()
    const { unmount } = await mount(makeView({ areas: BASE }), AT_BRIDGE)
    await advance(50)
    expect(actionButton()).toHaveTextContent('살펴보기')
    unmount()
    await mount(makeView({ areas: BASE }), AT_VILLAGE_DOCK)
    await advance(50)
    expect(actionButton()).toHaveTextContent('배 타기')
  })

  test('열기 → unlockArea lake; 응답 areas에 lake → 창이 닫히고 알림, 다리를 걸어 지나 산 호수로 넘어간다', async () => {
    const view = makeView({ gold: 6000, areas: BASE })
    await mount(view, AT_BRIDGE)
    await advance(50)
    // 열기 전에는 다리 칸을 지나갈 수 없다
    key('ArrowUp', true)
    await advance(300)
    key('ArrowUp', false)
    expect(tileOf(lastScene().player.pos)).toEqual({ tx: RIVER_GATE.front.tx, ty: RIVER_GATE.front.ty })
    await interact()
    route({ unlockArea: () => ok({ ...view, gold: 1000, areas: [...BASE, 'lake'] }) })
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(calls('unlockArea')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'unlockArea', area: 'lake' } }])
    expect(screen.queryByRole('region', { name: '지역 열기' })).not.toBeInTheDocument()
    expect(screen.getByText('산 호수 가는 다리를 고쳤어요')).toBeInTheDocument()
    expect(screen.getByText('1,000 G')).toBeInTheDocument()
    key('ArrowUp', true)
    await advance(1200)
    key('ArrowUp', false)
    await advance(400)
    expect(lastScene().map.id).toBe('lake')
    expect(savedPos().area).toBe('lake')
  })

  test('해금 창이 뜬 지 300ms 안의 클릭(여는 손가락의 유령 클릭)은 열기를 누르지 않는다', async () => {
    const view = makeView({ gold: 6000, areas: BASE })
    await mount(view, AT_BRIDGE)
    route({ unlockArea: () => ok({ ...view, areas: [...BASE, 'lake'] }) })
    press()
    release()
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(calls('unlockArea')).toHaveLength(0)
    await advance(300)
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(calls('unlockArea')).toHaveLength(1)
  })

  test('서버 오류(not_enough_gold) → 해금 창은 그대로, 오류 문구', async () => {
    const view = makeView({ gold: 6000, areas: BASE })
    await mount(view, AT_BRIDGE)
    await interact()
    route({ unlockArea: () => Promise.reject(new ApiError('not_enough_gold', 400)), load: () => ok(view) })
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(unlockPanel()).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('골드가 부족해요')
  })

  test('already_open(다른 기기에서 이미 엶) → 창이 닫히고 알림, view를 다시 불러와 다리를 지나갈 수 있다', async () => {
    const view = makeView({ gold: 6000, areas: BASE })
    await mount(view, AT_BRIDGE)
    await interact()
    route({
      unlockArea: () => Promise.reject(new ApiError('already_open', 400)),
      load: () => ok({ ...view, gold: 1000, areas: [...BASE, 'lake'] }),
    })
    const loadsBefore = calls('load').length
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    await flush()
    expect(screen.queryByRole('region', { name: '지역 열기' })).not.toBeInTheDocument()
    expect(screen.getByText('이미 열려 있어요')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls('load')).toHaveLength(loadsBefore + 1)
    expect(screen.getByText('1,000 G')).toBeInTheDocument()
    key('ArrowUp', true)
    await advance(1200)
    key('ArrowUp', false)
    await advance(400)
    expect(lastScene().map.id).toBe('lake')
  })

  test('busy(서버에 남은 낚시) → 해금 창은 그대로, 해금 전용 문구(장비 문구가 아니다)', async () => {
    const view = makeView({ gold: 6000, areas: BASE })
    await mount(view, AT_BRIDGE)
    await interact()
    route({ unlockArea: () => Promise.reject(new ApiError('busy', 400)), load: () => ok(view) })
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(unlockPanel()).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('낚시를 마친 뒤에 열 수 있어요')
    expect(screen.getByRole('alert')).not.toHaveTextContent('낚시 중에는 바꿀 수 없어요')
  })

  test('강 북쪽 출구 칸에 서도 산 호수가 닫혀 있으면 넘어가지 않는다(서버 상태에서 lake가 빠진 경우)', async () => {
    // 산 호수가 열린 상태로 강 북쪽 도착 칸에서 시작한 뒤, 응답의 areas에서 lake가 빠진다
    const fish = { species: 'anchovy', sizeCm: 10, perfect: false }
    const view = makeView({ areas: [...BASE, 'lake'], bag: [fish] })
    await mount(view, { area: 'river', pos: tileCenter(24, 1), facing: 'up' })
    await advance(50)
    expect(lastScene().map.id).toBe('river')
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    route({ lock: () => ok({ ...view, areas: BASE, bag: [{ ...fish, locked: true as const }] }) })
    fireEvent.click(within(screen.getByRole('region', { name: '가방' })).getByRole('button', { name: /멸치 10cm/ }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    key('ArrowUp', true)
    await advance(600)
    key('ArrowUp', false)
    await advance(400)
    expect(tileOf(lastScene().player.pos).ty).toBe(0) // 출구 칸까지 걸어갔다
    expect(lastScene().map.id).toBe('river')
    expect(lastScene().fade).toBe(0)
  })

  test('성공 응답인데 areas에 지역이 없으면 창은 그대로, 다시 시도 오류 문구', async () => {
    const view = makeView({ gold: 6000, areas: BASE })
    await mount(view, AT_BRIDGE)
    await interact()
    route({ unlockArea: () => ok({ ...view }) })
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(unlockPanel()).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('다시 시도해 주세요')
  })

  test('숲 동굴 입구를 열면 동굴 알림, 걸어 들어가면 동굴 맵과 지역 이름 알림', async () => {
    const gate = FOREST.gates[0]
    const view = makeView({ gold: 20000, areas: BASE })
    await mount(view, { area: 'forest', pos: tileCenter(gate.front.tx, gate.front.ty), facing: gate.front.facing })
    await interact()
    expect(within(unlockPanel()).getByText('동굴 장비')).toBeInTheDocument()
    expect(within(unlockPanel()).getByText('15,000 G')).toBeInTheDocument()
    route({ unlockArea: () => ok({ ...view, gold: 5000, areas: [...BASE, 'cave'] }) })
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(screen.getByText('동굴 입구를 치웠어요')).toBeInTheDocument()
    key('ArrowUp', true)
    await advance(300)
    key('ArrowUp', false)
    await advance(400)
    expect(lastScene().map.id).toBe('cave')
    expect(screen.getByText('동굴')).toBeInTheDocument()
  })

  test('마을 서쪽 끝 통나무 더미 → 갯벌 장화 · 30,000 G; 열면 알림, 왼쪽으로 걸어 나가면 갯벌 맵', async () => {
    const gate = VILLAGE.gates.find((g) => g.area === 'tideflat')!
    const view = makeView({ gold: 35000, areas: BASE })
    await mount(view, { area: 'village', pos: tileCenter(gate.front.tx, gate.front.ty), facing: gate.front.facing })
    await advance(50)
    expect(screen.getByText('방향키로 이동 · 스페이스로 살펴보기')).toBeInTheDocument()
    await interact()
    expect(screen.getByRole('heading', { name: '갯벌' })).toBeInTheDocument()
    expect(within(unlockPanel()).getByText('갯벌 장화')).toBeInTheDocument()
    expect(within(unlockPanel()).getByText('30,000 G')).toBeInTheDocument()
    route({ unlockArea: () => ok({ ...view, gold: 5000, areas: [...BASE, 'tideflat'] }) })
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(calls('unlockArea')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'unlockArea', area: 'tideflat' } }])
    expect(screen.getByText('통나무 더미를 치웠어요 — 서쪽 갯벌로 갈 수 있어요')).toBeInTheDocument()
    key('ArrowLeft', true)
    await advance(600)
    key('ArrowLeft', false)
    await advance(400)
    expect(lastScene().map.id).toBe('tideflat')
  })

  test('숲 서쪽 엉킨 덩굴 → 늪 나무 데크 · 60,000 G; 골드가 모자라면 열기 비활성, 열면 알림', async () => {
    const gate = FOREST.gates.find((g) => g.area === 'swamp')!
    const at = { area: 'forest' as const, pos: tileCenter(gate.front.tx, gate.front.ty), facing: gate.front.facing }
    const { unmount } = await mount(makeView({ gold: 59999, areas: BASE }), at)
    await interact()
    expect(within(unlockPanel()).getByText('늪 나무 데크')).toBeInTheDocument()
    expect(within(unlockPanel()).getByText('60,000 G')).toBeInTheDocument()
    expect(within(unlockPanel()).getByRole('button', { name: '열기' })).toBeDisabled()
    unmount()
    const view = makeView({ gold: 60000, areas: BASE })
    await mount(view, at)
    await interact()
    route({ unlockArea: () => ok({ ...view, gold: 0, areas: [...BASE, 'swamp'] }) })
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(screen.getByText('덩굴을 걷어 냈어요 — 서쪽 늪지로 갈 수 있어요')).toBeInTheDocument()
  })

  test('마을 선착장, 섬 잠김 → 배 구매 창(배 · 50,000 G); 사면 알림, 다시 행동하면 배를 탄다', async () => {
    const view = makeView({ gold: 60000, areas: BASE })
    await mount(view, AT_VILLAGE_DOCK)
    await advance(50)
    expect(screen.getByText('방향키로 이동 · 스페이스로 배 타기')).toBeInTheDocument()
    await interact()
    expect(within(unlockPanel()).getByText('배')).toBeInTheDocument()
    expect(within(unlockPanel()).getByText('50,000 G')).toBeInTheDocument()
    expect(lastScene().map.id).toBe('village')
    route({ unlockArea: () => ok({ ...view, gold: 10000, areas: [...BASE, 'island'] }) })
    fireEvent.click(within(unlockPanel()).getByRole('button', { name: '열기' }))
    await flush()
    expect(calls('unlockArea')[0]).toMatchObject({ payload: { type: 'unlockArea', area: 'island' } })
    expect(screen.getByText('배를 샀어요 — 선착장에서 섬으로 갈 수 있어요')).toBeInTheDocument()
    await interact()
    await advance(400)
    expect(lastScene().map.id).toBe('island')
  })

  test('섬 열림: 마을 선착장에서 행동 → 페이드 뒤 섬 entry에 도착(위치 저장); 섬 선착장 → 마을 entry', async () => {
    const view = makeView({ areas: [...BASE, 'island'] })
    const { unmount } = await mount(view, AT_VILLAGE_DOCK)
    await advance(50)
    press()
    release()
    await advance(20)
    expect(lastScene().map.id).toBe('village')
    expect(lastScene().fade).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: '지역 열기' })).not.toBeInTheDocument()
    await advance(400)
    const entry = VILLAGE_DOCK.entry
    expect(lastScene().map.id).toBe('island')
    expect(lastScene().fade).toBe(0)
    expect(lastScene().player.pos).toEqual(tileCenter(entry.tx, entry.ty))
    expect(lastScene().player.facing).toBe(entry.facing)
    expect(savedPos()).toEqual({ area: 'island', pos: tileCenter(entry.tx, entry.ty), facing: entry.facing })
    expect(screen.getByText('섬')).toBeInTheDocument()
    unmount()

    await mount(view, AT_ISLAND_DOCK)
    await advance(50)
    await interact()
    await advance(400)
    const back = ISLAND_DOCK.entry
    expect(lastScene().map.id).toBe('village')
    expect(lastScene().player.pos).toEqual(tileCenter(back.tx, back.ty))
    expect(lastScene().player.facing).toBe(back.facing)
  })

  test('저장 위치가 섬 선착장이어도 서버 areas에 섬이 없으면 마을 시작 위치에서 시작한다', async () => {
    await mount(makeView({ areas: ['village'] }), { ...AT_ISLAND_DOCK })
    await advance(50)
    // 섬이 안 열렸으니 저장 위치는 쓰지 않고 마을 시작 위치에서 시작한다
    expect(lastScene().map.id).toBe('village')
    expect(lastPlayer().pos).toEqual(SPAWN.pos)
  })

  test('저장 위치 {area:lake}: 서버 areas에 lake가 없으면 마을 SPAWN, 있으면 그 자리에서 시작', async () => {
    const saved: At = { area: 'lake', pos: tileCenter(LAKE_ENTRY.tx, LAKE_ENTRY.ty), facing: 'up' }
    const { unmount } = await mount(makeView({ areas: BASE }), saved)
    await advance(50)
    expect(lastScene().map.id).toBe('village')
    expect(lastPlayer().pos).toEqual(SPAWN.pos)
    expect(lastPlayer().facing).toBe(SPAWN.facing)
    unmount()

    await mount(makeView({ areas: [...BASE, 'lake'] }), saved)
    await advance(50)
    expect(lastScene().map.id).toBe('lake')
    expect(lastPlayer().pos).toEqual(saved.pos)
  })

  test('저장 위치가 아직 잠긴 문 칸(무너진 다리)이면 마을 SPAWN에서 시작', async () => {
    const saved: At = { area: 'river', pos: tileCenter(RIVER_GATE.tiles.tx, RIVER_GATE.tiles.ty), facing: 'up' }
    await mount(makeView({ areas: BASE }), saved)
    await advance(50)
    expect(lastScene().map.id).toBe('village')
    expect(lastPlayer().pos).toEqual(SPAWN.pos)
  })

  test('저장된 동굴 위치는 동굴이 열려 있으면 그대로 복원된다', async () => {
    const entry = FOREST.exits.find((e) => e.target === 'cave')!.entry
    const saved: At = { area: 'cave', pos: tileCenter(entry.tx, entry.ty), facing: entry.facing }
    await mount(makeView({ areas: [...BASE, 'cave'] }), saved)
    await advance(50)
    expect(lastScene().map.id).toBe('cave')
    expect(lastPlayer().pos).toEqual(saved.pos)
  })

  test('첫 응답 전에는 저장 위치를 덮어쓰지 않는다(화면을 떠나도 그대로)', async () => {
    const saved: At = { area: 'lake', pos: tileCenter(LAKE_ENTRY.tx, LAKE_ENTRY.ty), facing: 'up' }
    localStorage.setItem(POS_KEY, JSON.stringify(saved))
    route({ load: () => new Promise(() => {}) })
    const { unmount } = render(<Game gameId="fishing" />)
    await flush()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    unmount()
    expect(savedPos()).toEqual(saved)
  })

  test('동굴 용암 앞에서 던지면 cast 페이로드 {area:cave, spot:cave3}', async () => {
    const view = makeView({ areas: [...BASE, 'cave'] })
    const p = pending()
    await mount(view, fishingAt(CAVE, 'cave3'))
    route({ cast: () => ok({ ...view, pending: p }, p) })
    press()
    await advance(300)
    release()
    await flush()
    const payload = (calls('cast')[0] as unknown as { payload: { area: string; spot: string } }).payload
    expect(payload).toMatchObject({ area: 'cave', spot: 'cave3' })
  })
})

describe('찌 상점·장비', () => {
  test('상점: 찌 5종 표시, 사기는 buyTackle, 보유 중 표시, 골드 부족 비활성', async () => {
    const view = makeView({ gold: 1200, rodTier: 3, tackles: ['trap'] })
    await mountAtShop(view)
    route({ buyTackle: () => ok({ ...view, gold: 200, tackles: ['trap', 'cork'] }) })
    const list = screen.getByRole('list', { name: '찌 목록' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    expect(within(list).getByText('희귀·전설·신화 물고기가 더 잘 나와요')).toBeInTheDocument()
    expect(within(list).getByText('보유 중 · 가방에서 낄 수 있어요')).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: '가시 바늘 사기' })).toBeDisabled()
    expect(screen.queryByText('카본 낚싯대부터 낄 수 있어요')).not.toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: '코르크 찌 사기' }))
    await flush()
    expect(calls('buyTackle')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'buyTackle', id: 'cork' } }])
    expect(screen.getByText('200 G')).toBeInTheDocument()
  })

  test('상점: 낚싯대 단계 2면 카본 낚싯대부터 낄 수 있다는 안내', async () => {
    await mountAtShop(makeView({ rodTier: 2 }))
    expect(screen.getByText('사 둘 수 있고, 카본 낚싯대부터 낄 수 있어요')).toBeInTheDocument()
  })

  test('상점: 낀 찌는 "장착 중", 안 낀 보유 찌는 가방 안내', async () => {
    await mountAtShop(makeView({ rodTier: 3, tackles: ['trap', 'cork'], equipped: ['trap'] }))
    const list = screen.getByRole('list', { name: '찌 목록' })
    expect(within(list).getByText('장착 중')).toBeInTheDocument()
    expect(within(list).getAllByText('보유 중 · 가방에서 낄 수 있어요')).toHaveLength(1)
  })

  test('찌 필드 없는 옛 응답에도 상점과 가방이 그려진다', async () => {
    const old = makeView({ rodTier: 3 }) as Partial<View>
    delete old.tackles
    delete old.equipped
    await mountAtShop(old as View)
    expect(within(screen.getByRole('list', { name: '찌 목록' })).getAllByRole('listitem')).toHaveLength(5)
    cleanup()
    render(<BagPanel view={old as View} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} />)
    expect(within(screen.getByRole('group', { name: '장비' })).getAllByTestId('fish-slot')).toHaveLength(1)
  })

  test('이 판에 없는 어종 id(더 새 서버)가 가방·도감에 있어도 가방·상점·도감이 그려진다', async () => {
    const unknown = { species: 'future-fish', sizeCm: 50, perfect: false }
    const anchovy = { species: 'anchovy', sizeCm: 10, perfect: false }
    const view = makeView({ bag: [unknown, anchovy], dex: { 'future-fish': { count: 1, maxCm: 50 }, anchovy: { count: 1, maxCm: 10 } } })
    render(<BagPanel view={view} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} />)
    const bag = screen.getByRole('region', { name: '가방' })
    const cell = within(bag).getByRole('button', { name: /future-fish 50cm/ })
    expect(cell.querySelector('img')).toBeNull() // 모르는 어종은 그림 없이
    expect(within(cell).getByText('—')).toBeInTheDocument()
    expect(within(bag).getByRole('button', { name: /멸치 10cm/ })).toBeInTheDocument()
    cleanup()
    await mountAtShop(view)
    const value = price('anchovy', 10, false).toLocaleString('ko-KR')
    expect(screen.getByText(`팔 물고기 2마리 · 예상 ${value} G`)).toBeInTheDocument()
    cleanup()
    render(<DexPanel view={view} />)
    expect(screen.getByRole('region', { name: '도감' })).toBeInTheDocument()
    expect(screen.getByText(`1/${SPECIES.length}종`)).toBeInTheDocument()
  })

  test('가방: 장비 구역이 가방 칸보다 위, 찌를 사기 전에도 칸과 안내가 보인다', () => {
    const view = makeView({ rodTier: 2, tackles: ['cork'] })
    const { container } = render(<BagPanel view={view} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} />)
    const gear = screen.getByRole('group', { name: '장비' })
    const grid = container.querySelector('.fish-bag') as Element
    expect(gear.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('카본 낚싯대부터 낄 수 있어요')).toBeInTheDocument()
    cleanup()
    render(<BagPanel view={makeView({ rodTier: 3 })} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} />)
    expect(screen.getByRole('group', { name: '장비' })).toBeInTheDocument()
    expect(screen.getAllByTestId('fish-slot')).toHaveLength(1)
    cleanup()
    render(<BagPanel view={makeView({ rodTier: 2 })} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} />)
    expect(screen.queryByRole('group', { name: '장비' })).not.toBeInTheDocument()
  })

  test('상점: 찌 구매 실패는 상점 오류 표시로', async () => {
    const view = makeView({ gold: 5000, rodTier: 3 })
    await mountAtShop(view)
    route({ buyTackle: () => Promise.reject(new ApiError('already_owned', 400)), load: () => ok(view) })
    fireEvent.click(screen.getByRole('button', { name: '코르크 찌 사기' }))
    await flush()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  test('가방 장비: 칸 1개, 눌러 끼우고 빼며 칸이 차면 나머지는 비활성', async () => {
    const view = makeView({ rodTier: 3, tackles: ['cork', 'trap'], equipped: [] })
    await mount(view)
    route({ equip: (b) => ok({ ...view, equipped: (b as Extract<Body, { action: 'act' }>).payload.ids as never[] }) })
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    const gear = screen.getByRole('group', { name: '장비' })
    expect(within(gear).getAllByTestId('fish-slot')).toHaveLength(1)
    fireEvent.click(within(gear).getByRole('button', { name: '코르크 찌' }))
    await flush()
    expect(calls('equip')[0]).toEqual({ game: 'fishing', action: 'act', payload: { type: 'equip', ids: ['cork'] } })
    expect(within(gear).getByRole('button', { name: '함정 찌' })).toBeDisabled()
    fireEvent.click(within(gear).getByRole('button', { name: '코르크 찌' }))
    await flush()
    expect(calls('equip')[1]).toEqual({ game: 'fishing', action: 'act', payload: { type: 'equip', ids: [] } })
  })

  test('낚시 중이면 장비 구역이 비활성이고 문구가 보인다', () => {
    const view = makeView({ rodTier: 3, tackles: ['cork'], pending: pending() })
    render(<BagPanel view={view} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} />)
    expect(screen.getByText('낚시 중에는 바꿀 수 없어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '코르크 찌' })).toBeDisabled()
  })

  test('미니게임: 코르크를 끼면 낚시 바가 1.2배', async () => {
    const barSize = async (equipped: ('cork')[]) => {
      const view = makeView({ equipped, tackles: equipped, rodTier: 3 })
      await castAndWait(view, 3000)
      route({ hook: () => ok(view, { species: 'mackerel', sizeCm: 40 }), resolve: () => new Promise(() => {}) })
      await advance(3100)
      press()
      release()
      await flush()
      await advance(100)
      const size = vi.mocked(drawWorld).mock.calls.at(-1)?.[1].barParams?.barSize as number
      cleanup()
      worldMock.mockReset()
      return size
    }
    const plain = await barSize([])
    const corked = await barSize(['cork'])
    expect(corked).toBeCloseTo(plain * 1.2)
  })
})

describe('도전과제·순간이동기', () => {
  const BASE: AreaId[] = [...DEFAULT_AREAS]
  const DONE = { progress: 9, done: true }
  const VT = VILLAGE.teleporter!
  /** 마을 순간이동기 도착 자리에서 위(구조물)를 본다 */
  const AT_VILLAGE_TP: At = { area: 'village', pos: tileCenter(VT.front.tx, VT.front.ty), facing: 'up' }
  const tpPanel = () => screen.getByRole('region', { name: '순간이동기' })
  const savedPos = () => JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as At
  async function interact() {
    press()
    release()
    await advance(300)
  }

  test('과제 버튼 → 도전과제 6개(지역 순서), 진행 n/count, 완료 과제는 완료 표시, 깬 과제 n/6', async () => {
    await mount(makeView({ challenges: { 'pier-perfect': { progress: 1, done: false }, 'river-rain': { progress: 5, done: true } } }), SAND)
    fireEvent.click(screen.getByRole('button', { name: '과제' }))
    const panel = screen.getByRole('region', { name: '도전과제' })
    const items = within(panel).getAllByRole('listitem')
    expect(items).toHaveLength(6)
    expect(items[0]).toHaveTextContent('바닷가 마을 · 부두의 명수')
    expect(items[0]).toHaveTextContent('부두에서 완벽하게 3마리 낚기')
    expect(items[0]).toHaveTextContent('1/3')
    expect(items[1]).toHaveTextContent('완료 · 순간이동기 켜짐')
    expect(items[2]).toHaveTextContent('0/3')
    expect(within(panel).getByText('깬 과제 1/6')).toBeInTheDocument()
  })

  test('잡은 결과에 completed가 있으면 완료 알림', async () => {
    const view = makeView()
    await castAndWait(view, 3000)
    route({
      hook: () => ok(view, { species: 'goby', sizeCm: 12 }),
      resolve: () => {
        const fish = { species: 'goby', sizeCm: 12, perfect: true }
        return ok({ ...view, bag: [fish], challenges: { 'pier-perfect': { progress: 3, done: true } } }, { caught: fish, completed: ['pier-perfect'] })
      },
    })
    await advance(3100)
    press()
    release()
    await flush()
    vi.mocked(barResult).mockImplementation(() => 'caught')
    await advance(MIN_FIGHT_MS + 300)
    expect(calls('resolve')).toHaveLength(1)
    expect(screen.getByText('도전과제 완료! 부두의 명수 — 바닷가 마을 순간이동기가 켜졌어요')).toBeInTheDocument()
  })

  test('꺼진 마을 이동기 앞: 안내 살펴보기, 행동 → 창(아직 꺼져 있어요, 과제와 진행), 이동 버튼 없음; 장면 teleporterOn false', async () => {
    await mount(makeView({ challenges: { 'pier-perfect': { progress: 2, done: false } } }), AT_VILLAGE_TP)
    await advance(50)
    expect(lastScene().teleporterOn).toBe(false)
    expect(screen.getByText('방향키로 이동 · 스페이스로 살펴보기')).toBeInTheDocument()
    await interact()
    const panel = tpPanel()
    expect(screen.getByRole('heading', { name: '바닷가 마을 순간이동기' })).toBeInTheDocument()
    expect(within(panel).getByText('아직 꺼져 있어요')).toBeInTheDocument()
    expect(within(panel).getByText('부두의 명수')).toBeInTheDocument()
    expect(within(panel).getByText('2/3')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /이동/ })).not.toBeInTheDocument()
  })

  test('켜진 마을 이동기: 안내 순간이동, 강과 요금, 이동 → teleport; 창 닫힘, 페이드 뒤 강 이동기 앞에 서고 위치 저장, 바로 다시 행동해도 창이 안 열린다', async () => {
    const fee = teleportFee('village', 'river')
    const view = makeView({ gold: 500, areas: BASE, challenges: { 'pier-perfect': DONE, 'river-rain': DONE } })
    await mount(view, AT_VILLAGE_TP)
    await advance(50)
    expect(lastScene().teleporterOn).toBe(true)
    expect(screen.getByText('방향키로 이동 · 스페이스로 순간이동')).toBeInTheDocument()
    await interact()
    const panel = tpPanel()
    const rows = within(panel).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('마을 강')
    expect(rows[0]).toHaveTextContent(`${fee} G`)
    expect(within(panel).getByText('보유 500 G')).toBeInTheDocument()
    route({ teleport: () => ok({ ...view, gold: 500 - fee }, { from: 'village', to: 'river', fee }) })
    fireEvent.click(within(panel).getByRole('button', { name: '마을 강 이동' }))
    await flush()
    expect(calls('teleport')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'teleport', from: 'village', to: 'river' } }])
    expect(screen.queryByRole('region', { name: '순간이동기' })).not.toBeInTheDocument()
    // 서버가 받자마자(맵을 바꾸기 전) 도착 자리를 저장한다
    const dest = RIVER.teleporter!.front
    expect(lastScene().map.id).toBe('village')
    expect(savedPos()).toEqual({ area: 'river', pos: tileCenter(dest.tx, dest.ty), facing: dest.facing })
    await advance(400)
    const front = RIVER.teleporter!.front
    expect(lastScene().map.id).toBe('river')
    expect(lastScene().fade).toBe(0)
    expect(lastScene().player.pos).toEqual(tileCenter(front.tx, front.ty))
    expect(lastScene().player.facing).toBe(front.facing)
    expect(savedPos()).toEqual({ area: 'river', pos: tileCenter(front.tx, front.ty), facing: front.facing })
    expect(screen.getByText(`${(500 - fee).toLocaleString('ko-KR')} G`)).toBeInTheDocument()
    await interact()
    expect(screen.queryByRole('region', { name: '순간이동기' })).not.toBeInTheDocument()
  })

  test('골드가 요금보다 1 모자라면 이동 비활성·문구; 서버 busy면 창 유지·문구', async () => {
    const fee = teleportFee('village', 'river')
    const { unmount } = await mount(makeView({ gold: fee - 1, areas: BASE, challenges: { 'pier-perfect': DONE, 'river-rain': DONE } }), AT_VILLAGE_TP)
    await advance(50)
    await interact()
    expect(within(tpPanel()).getByRole('button', { name: '마을 강 이동' })).toBeDisabled()
    expect(within(tpPanel()).getByText('골드가 모자라요')).toBeInTheDocument()
    unmount()

    await mount(makeView({ gold: 9999, areas: BASE, challenges: { 'pier-perfect': DONE, 'river-rain': DONE } }), AT_VILLAGE_TP)
    await advance(50)
    await interact()
    route({ teleport: () => Promise.reject(new ApiError('busy', 400)) })
    fireEvent.click(within(tpPanel()).getByRole('button', { name: '마을 강 이동' }))
    await flush()
    expect(tpPanel()).toBeInTheDocument()
    expect(screen.getByText('낚시를 마친 뒤에 이동할 수 있어요')).toBeInTheDocument()
    expect(lastScene().map.id).toBe('village')
  })

  test('켜진 곳이 자기뿐이면 안내 문구', async () => {
    await mount(makeView({ challenges: { 'pier-perfect': DONE } }), AT_VILLAGE_TP)
    await advance(50)
    await interact()
    expect(within(tpPanel()).getByText('다른 지역의 순간이동기를 켜면 오갈 수 있어요')).toBeInTheDocument()
  })

  test('창이 뜬 지 300ms 안의 클릭(여는 손가락의 유령 클릭)은 이동을 누르지 않는다', async () => {
    await mount(makeView({ gold: 9999, areas: BASE, challenges: { 'pier-perfect': DONE, 'river-rain': DONE } }), AT_VILLAGE_TP)
    await advance(50)
    route({ teleport: () => new Promise(() => {}) })
    press()
    release()
    fireEvent.click(within(tpPanel()).getByRole('button', { name: '마을 강 이동' }))
    expect(calls('teleport')).toHaveLength(0)
  })

  test('터치: 켜진 이동기 앞 행동 버튼은 순간이동, 꺼지면 살펴보기', async () => {
    stubTouch()
    const { unmount } = await mount(makeView({ challenges: { 'pier-perfect': DONE } }), AT_VILLAGE_TP)
    await advance(50)
    expect(actionButton()).toHaveTextContent('순간이동')
    unmount()
    await mount(makeView(), AT_VILLAGE_TP)
    await advance(50)
    expect(actionButton()).toHaveTextContent('살펴보기')
  })

  test('challenges가 없는 옛 서버 응답: 그려지고 이동기는 꺼짐, 과제 목록은 0/6', async () => {
    const old = makeView() as Partial<View>
    delete old.challenges
    await mount(old as View, AT_VILLAGE_TP)
    await advance(50)
    expect(lastScene().teleporterOn).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '과제' }))
    expect(screen.getByText('깬 과제 0/6')).toBeInTheDocument()
  })
})

describe('큰 지도', () => {
  const mapPanel = () => screen.getByRole('region', { name: '지도' })
  const pressM = () => fireEvent.keyDown(window, { code: 'KeyM', key: 'ㅡ' })

  test('지도 버튼으로 열고 닫고, 제목은 지도, 처음 탭은 지금 지역', async () => {
    await mount(makeView(), SAND)
    fireEvent.click(screen.getByRole('button', { name: '지도' }))
    expect(screen.getByRole('heading', { name: '지도' })).toBeInTheDocument()
    expect(within(mapPanel()).getByRole('tab', { selected: true })).toHaveTextContent('바닷가 마을')
    expect(within(mapPanel()).getByLabelText('현재 위치')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument()
  })

  test('M 키로 열고 닫는다(한글 입력 상태 e.key와 무관), 가방이 열려 있으면 무시', async () => {
    await mount(makeView(), SAND)
    pressM()
    expect(mapPanel()).toBeInTheDocument()
    pressM()
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    pressM()
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '가방' })).toBeInTheDocument()
  })

  test('레이어를 끄고 닫았다 다시 열면 꺼진 그대로', async () => {
    await mount(makeView(), SAND)
    fireEvent.click(screen.getByRole('button', { name: '지도' }))
    fireEvent.click(within(mapPanel()).getByRole('button', { name: '길' }))
    expect(within(mapPanel()).queryByRole('button', { name: '상점' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    fireEvent.click(screen.getByRole('button', { name: '지도' }))
    expect(within(mapPanel()).getByRole('button', { name: '길' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(mapPanel()).queryByRole('button', { name: '상점' })).not.toBeInTheDocument()
  })

  test('지도 안 어떤 버튼을 눌러도 서버 행동을 부르지 않는다', async () => {
    await mount(makeView(), SAND)
    const before = worldMock.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '지도' }))
    for (let round = 0; round < 2; round++) {
      for (const b of within(mapPanel()).getAllByRole('button')) fireEvent.click(b)
    }
    expect(worldMock.mock.calls.length).toBe(before)
  })

  test('Esc로 지도를 닫는다. 전체화면에서도 Esc는 지도만 닫고 전체화면은 그대로', async () => {
    const { container } = await mount(makeView(), SAND)
    fireEvent.click(screen.getByRole('button', { name: '전체화면' }))
    expect(container.querySelector('.fish-full')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '지도' }))
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument()
    expect(container.querySelector('.fish-full')).not.toBeNull()
    // 지도가 닫힌 뒤의 Esc는 원래대로 전체화면을 나간다
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    expect(container.querySelector('.fish-full')).toBeNull()
  })

  test('첫 서버 상태 전에 누른 M은 무시한다(불러온 뒤 지도가 저절로 열리지 않는다)', async () => {
    localStorage.setItem(POS_KEY, JSON.stringify(SAND))
    let resolve: (v: Awaited<ReturnType<typeof ok>>) => void = () => {}
    route({ load: () => new Promise((r) => { resolve = r }) })
    render(<Game gameId="fishing" />)
    pressM()
    resolve({ view: makeView(), result: null, server_now: Date.now() })
    await flush()
    await flush()
    expect(screen.getByRole('button', { name: '지도' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument()
  })

  test('지역 전환(페이드) 중에는 M·지도 버튼으로 열리지 않는다', async () => {
    await mount(makeView(), { area: 'village', pos: tileCenter(24, 1), facing: 'up' })
    key('ArrowUp', true)
    await advance(200)
    key('ArrowUp', false)
    expect(lastScene().fade).toBeGreaterThan(0)
    pressM()
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '지도' }))
    expect(screen.queryByRole('region', { name: '지도' })).not.toBeInTheDocument()
    await advance(400)
    expect(lastScene().fade).toBe(0)
    pressM()
    expect(within(mapPanel()).getByRole('tab', { selected: true })).toHaveTextContent('마을 강')
  })

  test('떠나면 축소 그림 캐시를 비운다', async () => {
    vi.mocked(releaseMinimapCache).mockClear()
    const { unmount } = await mount()
    expect(releaseMinimapCache).not.toHaveBeenCalled()
    unmount()
    expect(releaseMinimapCache).toHaveBeenCalledTimes(1)
  })
})

describe('옷장', () => {
  beforeEach(() => {
    // 옷장 미리보기 캔버스: 칠하기만 받아 주고, 작은 그림 PNG는 가짜 주소
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => ({ fillRect: vi.fn() }) as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:thumb')
  })
  test('상점 → 옷 가게 열기 → 사기는 buyWear, 입기는 wear', async () => {
    const view = makeView({ gold: 10_000 })
    await mountAtShop(view)
    route({
      buyWear: () => ok({ ...view, gold: 4_000, wardrobe: ['hat:cap'], outfit: { ...DEFAULT_OUTFIT, hat: 'cap' } }),
      wear: () => ok({ ...view, gold: 4_000, wardrobe: ['hat:cap'], outfit: { ...DEFAULT_OUTFIT, hat: 'none' } }),
    })
    fireEvent.click(screen.getByRole('button', { name: '옷 가게 열기' }))
    await flush()
    expect(screen.getByRole('heading', { name: '옷장' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '남색 야구모자 사기' }))
    await flush()
    expect(calls('buyWear')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'buyWear', slot: 'hat', id: 'cap' } }])
    expect(screen.getByText('4,000 G', { selector: '.fish-gold' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '모자 없음 입기' }))
    await flush()
    expect(calls('wear')).toEqual([{ game: 'fishing', action: 'act', payload: { type: 'wear', slot: 'hat', id: 'none' } }])
    // 장면에 입은 옷이 넘어간다(다음 프레임)
    await advance(50)
    expect(vi.mocked(drawWorld).mock.calls.at(-1)?.[1].outfit).toEqual({ ...DEFAULT_OUTFIT, hat: 'none' })
  })

  test('가방의 옷장 버튼으로 열고, 상점 밖이라 사기는 꺼져 있다', async () => {
    await mount(makeView({ gold: 1_000_000 }))
    fireEvent.click(screen.getByRole('button', { name: '가방' }))
    fireEvent.click(screen.getByRole('button', { name: '옷장' }))
    await flush()
    expect(screen.getByRole('heading', { name: '옷장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '남색 야구모자 사기' })).toBeDisabled()
  })
})
