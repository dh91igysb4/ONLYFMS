// 낚시 5부 M1 화면 배선: 물때(밀물 이동·안내), 얼음 구멍 뚫기, 새 오류 문구.
// 강 맵 자리에 합성 맵(진흙·갯골·얼음판)을 넣어 실제 지역 없이 검사한다(Game.test.tsx와 같은 가짜 서버·장면).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Game } from './Game.tsx'
import { ApiError, world } from '../../lib/api.ts'
import { drawWorld } from './scene.ts'
import { SEASON_ANCHOR_MS } from './clock.ts'
import { ALL_AREAS_OPEN, TILE, defineMap, nearestDryTile, tileAt, tileOf, type Facing, type Vec } from './map.ts'
import { pierEnd } from './map.ts'
import { VILLAGE } from './maps/village.ts'
import type { AreaId } from './data.ts'
import { DEFAULT_OUTFIT } from './wardrobe.ts'
import type { PendingView, View } from './logic.ts'

const ROWS = Array.from({ length: 34 }, (_, ty) =>
  Array.from({ length: 30 }, (_, tx) => {
    if (ty === 6 && tx >= 8 && tx <= 10) return 'r' // 갯골(늘 물)
    if (ty >= 4 && ty <= 8 && tx >= 4 && tx <= 14) return 'm' // 진흙
    if (ty >= 28 && ty <= 31 && tx >= 18 && tx <= 23) return 'i' // 얼음판
    return '.'
  }).join(''),
)
const FLAT = vi.hoisted(() => ({ map: null as unknown }))
FLAT.map = defineMap('river', ROWS, {
  tidal: true,
  spots: { river: 'river', mud: 'river', hole: 'river' },
  exits: [{ edge: 's', from: 24, to: 25, target: 'village', entry: { tx: 24, ty: 2, facing: 'down' } }],
})
const flat = FLAT.map as ReturnType<typeof defineMap>

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/api.ts')>()
  return { ...orig, world: vi.fn() }
})
vi.mock('../../platform/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('./scene.ts', () => ({ drawWorld: vi.fn(), releaseSceneCache: vi.fn(), SCENE_W: 160, SCENE_H: 240 }))
vi.mock('./maps/index.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./maps/index.ts')>()
  return { ...orig, mapFor: (area: AreaId) => (area === 'river' ? (FLAT.map as never) : orig.mapFor(area)) }
})
vi.mock('./minimap.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./minimap.ts')>()
  return { ...orig, minimapUrl: vi.fn(() => 'data:mini'), spotHighlightUrl: vi.fn(() => 'data:hl'), releaseMinimapCache: vi.fn() }
})
vi.mock('./sprites.ts', () => ({ spriteDataUrl: vi.fn((name: string) => `data:${name}`) }))

const worldMock = vi.mocked(world)
type Body = { game: string; action: 'load' } | { game: string; action: 'act'; payload: { type: string } & Record<string, unknown> }
type Handler = (body: Body) => Promise<{ view: View; result: unknown; server_now: number }>
function route(handlers: Record<string, Handler>) {
  worldMock.mockImplementation(((body: Body) => {
    const key = body.action === 'load' ? 'load' : body.payload.type
    const h = handlers[key]
    if (!h) return Promise.reject(new Error(`unexpected ${key}`))
    return h(body)
  }) as unknown as typeof world)
}
const ok = (view: View, result: unknown = null) => Promise.resolve({ view, result, server_now: Date.now() })
const makeView = (over: Partial<View> = {}): View => ({
  gold: 0, totalEarned: 0, rodTier: 1, bagTier: 1, areas: ['village', 'river', 'forest'], bag: [], dex: {}, legends: [], tackles: [], equipped: [], challenges: {}, wardrobe: [], outfit: { ...DEFAULT_OUTFIT }, pending: null, ...over,
})
const pending = (biteDelayMs = 60_000): PendingView => ({ biteDelayMs, startedAt: Date.now(), hooked: false, species: null, sizeCm: null })
const calls = (type: string) =>
  worldMock.mock.calls.map(([b]) => b as Body).filter((b) => b.action === 'act' && b.payload.type === type) as Extract<Body, { action: 'act' }>[]

/** 게임 m분(0~1439)이 되는 실제 시각 */
const atMinute = (m: number) => SEASON_ANCHOR_MS + m * 1000
const tileCenter = (tx: number, ty: number): Vec => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
const flush = () => act(async () => { await Promise.resolve() })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const press = () => fireEvent.keyDown(window, { key: ' ', code: 'Space' })
const release = () => fireEvent.keyUp(window, { key: ' ', code: 'Space' })
const key = (code: string, down: boolean) => (down ? fireEvent.keyDown(window, { code, key: code }) : fireEvent.keyUp(window, { code, key: code }))
const lastScene = () => {
  const c = vi.mocked(drawWorld).mock.calls.at(-1)
  if (!c) throw new Error('drawWorld was not called')
  return c[1]
}
async function walk(code: string, ms: number) {
  key(code, true)
  await advance(ms)
  key(code, false)
  await advance(20)
}
async function mount(at: { area: AreaId; pos: Vec; facing: Facing }, view = makeView()) {
  localStorage.setItem('fishing-pos:u1', JSON.stringify(at))
  route({ load: () => ok(view) })
  render(<Game gameId="fishing" />)
  await flush()
  await advance(20)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date', 'performance'] })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({}) as unknown as CanvasRenderingContext2D)
  worldMock.mockReset()
  localStorage.clear()
  vi.mocked(drawWorld).mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('물때', () => {
  test('썰물에 진흙으로 걸어 들어가고, 썰물 끝 30분 전 "곧 밀물이에요", 밀물이 들면 가장 가까운 땅으로 옮겨지고 알림', async () => {
    vi.setSystemTime(atMinute(5 * 60 + 25))
    await mount({ area: 'river', pos: tileCenter(3, 5), facing: 'right' })
    expect(lastScene().dyn?.tide).toBe('low')
    await walk('ArrowRight', 450)
    const onMud = tileOf(lastScene().player.pos)
    expect(tileAt(flat, onMud.tx, onMud.ty)).toBe('mud')
    expect(screen.queryByText('곧 밀물이에요')).toBeNull()
    await advance(6_000) // 5:31 → 썰물 끝 29분 전
    expect(screen.getByText('곧 밀물이에요')).toBeInTheDocument()
    await advance(28_000) // 5:59.5
    expect(tileOf(lastScene().player.pos)).toEqual(onMud)
    await advance(1_000) // 6:00.5 밀물 → 페이드(300ms) 뒤 옮김
    await advance(400)
    expect(lastScene().dyn?.tide).toBe('high')
    expect(tileOf(lastScene().player.pos)).toEqual(nearestDryTile(flat, onMud, ALL_AREAS_OPEN))
    expect(screen.getByText('밀물이 들어와 물가로 나왔어요')).toBeInTheDocument()
  })

  test('낚시 중에는 밀물이 들어도 옮기지 않고, 끝난 뒤에 옮긴다', async () => {
    vi.setSystemTime(atMinute(5 * 60 + 50))
    await mount({ area: 'river', pos: tileCenter(3, 5), facing: 'right' })
    // 갯골 위(9, 5)까지 걸어가 아래(갯골)를 본다
    await walk('ArrowRight', 1300)
    await walk('ArrowDown', 30)
    const spot = tileOf(lastScene().player.pos)
    expect(tileAt(flat, spot.tx, spot.ty)).toBe('mud')
    expect(tileAt(flat, spot.tx, spot.ty + 1)).toBe('river')
    const view = makeView()
    route({
      load: () => ok(view),
      cast: () => { const p = pending(); return ok({ ...view, pending: p }, p) },
      resolve: () => ok(view, { caught: null }),
    })
    press()
    await advance(200)
    release()
    await flush()
    expect(calls('cast')).toHaveLength(1)
    expect(calls('cast')[0].payload.spot).toBe('river')
    await advance(15_000) // 6:05 밀물, 아직 기다리는 중
    expect(lastScene().phase).toBe('waiting')
    expect(tileOf(lastScene().player.pos)).toEqual(spot)
    press() // 너무 일찍 챔 → 놓침 → 결과 1.2초 뒤 대기
    release()
    await flush()
    await advance(1300)
    await advance(400)
    expect(tileOf(lastScene().player.pos)).toEqual(nearestDryTile(flat, spot, ALL_AREAS_OPEN))
  })
})

describe('얼음 구멍', () => {
  const ICE_FRONT = { area: 'river' as const, pos: tileCenter(24, 30), facing: 'left' as const }

  test('얼음을 보고 행동 → 1.2초 뚫기(그동안 drill 장면) → 같은 자리에서 낚시', async () => {
    vi.setSystemTime(atMinute(12 * 60))
    await mount(ICE_FRONT)
    expect(screen.getByText('방향키로 이동 · 스페이스로 구멍 뚫기')).toBeInTheDocument()
    press()
    release()
    await advance(100)
    expect(lastScene().drill).toMatchObject({ tx: 23, ty: 30 })
    await advance(1200)
    expect(lastScene().drill).toBeNull()
    expect([...lastScene().dyn!.holes]).toEqual(['23,30'])
    const view = makeView()
    route({ load: () => ok(view), cast: () => { const p = pending(); return ok({ ...view, pending: p }, p) } })
    press()
    await advance(100)
    expect(lastScene().phase).toBe('charging')
    release()
    await flush()
    expect(calls('cast')[0].payload).toMatchObject({ area: 'river', spot: 'river' })
  })

  test('뚫는 동안은 걷지 않고, 맵을 나갔다 오면 구멍이 없다', async () => {
    vi.setSystemTime(atMinute(12 * 60))
    await mount(ICE_FRONT)
    press()
    release()
    await advance(50)
    key('ArrowDown', true)
    await advance(300)
    expect(tileOf(lastScene().player.pos)).toEqual({ tx: 24, ty: 30 })
    await advance(1000)
    expect([...lastScene().dyn!.holes]).toEqual(['23,30'])
    await advance(1200) // 아래 출구 → 마을
    key('ArrowDown', false)
    await advance(400)
    expect(lastScene().map.id).toBe('village')
    await walk('ArrowUp', 900) // 마을 북쪽 출구 → 다시 합성 맵
    await advance(400)
    expect(lastScene().map.id).toBe('river')
    expect(lastScene().dyn!.holes.size).toBe(0)
  })

  test('넷째 구멍을 뚫으면 가장 오래된 구멍이 다시 얼고 알림', async () => {
    vi.setSystemTime(atMinute(12 * 60))
    // 얼음판 위 (19, 29)에서 네 방향 얼음을 차례로 뚫는다
    await mount({ area: 'river', pos: tileCenter(19, 29), facing: 'left' })
    for (const dir of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
      await walk(dir, 16)
      press()
      release()
      await advance(1300)
    }
    expect(lastScene().dyn!.holes.size).toBe(3)
    expect(screen.getByText('구멍이 다시 얼었어요')).toBeInTheDocument()
  })
})

describe('새 오류 문구', () => {
  const PIER_END = pierEnd(VILLAGE)!
  test.each([
    ['need_rod', '백골 낚싯대 이상이 있어야 해요'],
    ['spot_closed', '물이 들어와 갯골에 갈 수 없어요'],
  ])('cast %s → %s', async (code, text) => {
    vi.setSystemTime(atMinute(12 * 60))
    await mount({ area: 'village', pos: tileCenter(PIER_END.tx, PIER_END.ty), facing: 'down' })
    route({ load: () => ok(makeView()), cast: () => Promise.reject(new ApiError(code, 400)) })
    press()
    await advance(100)
    release()
    await flush()
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})
