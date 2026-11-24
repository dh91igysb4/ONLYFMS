import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Manifest } from '../../games/types.ts'

const rpcMock = vi.fn()
const worldMock = vi.fn()
const previewProps = vi.fn()
let previewMode: 'ok' | 'fail' | 'throw' = 'ok'
let profile: Record<string, unknown> = {}
let fishingHidden = false

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
  world: (...a: unknown[]) => worldMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({ useAuth: () => ({ profile, refresh: vi.fn() }) }))
const pres = vi.hoisted(() => ({ joins: [] as unknown[][], peers: [] as unknown[], subs: [] as (() => void)[], leave: [] as number[] }))
vi.mock('../world/presence.ts', () => ({
  joinWorldPresence: (...a: unknown[]) => {
    pres.joins.push(a)
    const idx = pres.joins.length - 1
    pres.leave[idx] = 0
    return {
      update: () => {}, peers: () => pres.peers,
      onChange: (cb: () => void) => { pres.subs.push(cb); return () => {} },
      leave: () => { pres.leave[idx]++ },
    }
  },
}))
vi.mock('./Shortcuts.tsx', () => ({ Shortcuts: () => <nav aria-label="바로가기">버튼들</nav> }))
vi.mock('../../games/index.ts', () => {
  const manifest = (id: string, extra: Partial<Manifest>) => ({
    id, name: id === 'fishing' ? '펨타듀 낚시' : id, description: '', hidden: false,
    modes: { daily: false, contest: false, free: false }, puzzleSource: 'generate', dailyTimeLimitSec: null, options: [],
    category: 'world', ...extra,
  })
  return {
    get worlds() {
      return [
        { manifest: manifest('plain', {}) },
        { manifest: manifest('fishing', { preview: true, hidden: fishingHidden }) },
      ]
    },
    games: [],
  }
})
vi.mock('../../games/ui.ts', () => ({
  getWorldPreview: (id: string) => (id === 'fishing'
    ? (p: { records: unknown; size: number; onFail: () => void; userId: string }) => {
      previewProps(p)
      if (previewMode === 'throw') throw new Error('boom')
      if (previewMode === 'fail') return <button type="button" onClick={p.onFail}>실패시키기</button>
      return <canvas data-testid="preview" />
    }
    : undefined),
}))

import { HomePage } from './HomePage.tsx'

let roCallback: ResizeObserverCallback | null = null
class FakeRO {
  constructor(cb: ResizeObserverCallback) { roCallback = cb }
  observe() {}
  unobserve() {}
  disconnect() {}
}
function resize(width: number) {
  act(() => { roCallback?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver) })
}

const view = () => render(<MemoryRouter><HomePage /></MemoryRouter>)
const lastProps = () => previewProps.mock.calls.at(-1)![0]

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue([
    { game_id: 'fishing', key: 'avatar', value: 0, detail: '{"hat":"none"}' },
    { game_id: 'fishing', key: 'areas', value: 0, detail: 'village,river,forest' },
    { game_id: 'plain', key: 'x', value: 1, detail: null },
  ])
  worldMock.mockReset()
  previewProps.mockReset()
  previewMode = 'ok'
  fishingHidden = false
  pres.joins = []
  pres.peers = []
  pres.subs = []
  pres.leave = []
  profile = { id: 'u1', handle: 'kane', is_admin: false, status: 'approved' }
  vi.stubGlobal('ResizeObserver', FakeRO)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HomePage', () => {
  test('미리보기는 preview가 있는 지속형 게임으로 들어가는 링크 안에 있다', async () => {
    view()
    expect(await screen.findByTestId('preview')).toBeTruthy()
    const a = screen.getByRole('link', { name: '펨타듀 낚시 들어가기' })
    expect(a.getAttribute('href')).toBe('/world/fishing')
    expect(a.textContent).toContain('들어가기')
    expect(screen.getByRole('navigation', { name: '바로가기' })).toBeTruthy()
  })

  test('user_records를 내 아이디로 한 번 부르고 그 게임 행만 넘긴다', async () => {
    view()
    await waitFor(() => expect(lastProps().records).toEqual([
      { key: 'avatar', detail: '{"hat":"none"}' },
      { key: 'areas', detail: 'village,river,forest' },
    ]))
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('user_records', { p_handle: 'kane' })
    expect(lastProps().userId).toBe('u1')
  })

  test('user_records가 실패해도 빈 기록으로 미리보기를 그린다', async () => {
    rpcMock.mockReset().mockRejectedValue(new Error('x'))
    view()
    expect(await screen.findByTestId('preview')).toBeTruthy()
    expect(lastProps().records).toEqual([])
  })

  test('미리보기가 onFail을 부르면 같은 자리에 들어가기 버튼, 바로가기는 그대로', async () => {
    previewMode = 'fail'
    view()
    fireEvent.click(await screen.findByRole('button', { name: '실패시키기' }))
    const a = screen.getByRole('link', { name: '펨타듀 낚시 들어가기' })
    expect(a.getAttribute('href')).toBe('/world/fishing')
    expect(a.className).toContain('btn')
    expect(screen.queryByRole('button', { name: '실패시키기' })).toBeNull()
    expect(screen.getByRole('navigation', { name: '바로가기' })).toBeTruthy()
  })

  test('미리보기가 렌더 중 던지면 대체 버튼, 바로가기는 그대로', async () => {
    previewMode = 'throw'
    view()
    await waitFor(() => expect(screen.getByRole('link', { name: '펨타듀 낚시 들어가기' }).className).toContain('btn'))
    expect(screen.getByRole('navigation', { name: '바로가기' })).toBeTruthy()
  })

  test('user_records가 오기 전에는 미리보기를 그리지 않고 같은 크기의 빈 자리만 둔다', async () => {
    let resolve!: (v: unknown) => void
    rpcMock.mockReset().mockReturnValue(new Promise((r) => { resolve = r }))
    view()
    expect(previewProps).not.toHaveBeenCalled()
    const a = screen.getByRole('link', { name: '펨타듀 낚시 들어가기' })
    expect(a.getAttribute('href')).toBe('/world/fishing')
    await act(async () => { resolve([{ game_id: 'fishing', key: 'avatar', value: 0, detail: 'x' }]) })
    expect(previewProps).toHaveBeenCalled()
    expect(previewProps.mock.calls.every((c) => (c[0] as { records: unknown[] }).records.length === 1)).toBe(true)
  })

  test('메인에서 world 함수를 부르지 않는다', async () => {
    view()
    await waitFor(() => expect(rpcMock).toHaveBeenCalled())
    expect(worldMock).not.toHaveBeenCalled()
  })

  test('미리보기 게임이 숨김이고 관리자가 아니면 미리보기·대체 버튼 없이 바로가기만', () => {
    fishingHidden = true
    view()
    expect(screen.queryByRole('link', { name: '펨타듀 낚시 들어가기' })).toBeNull()
    expect(screen.getByRole('navigation', { name: '바로가기' })).toBeTruthy()
  })

  test('미리보기 크기: 폭 360 → 360, 폭 1200 → 480', async () => {
    view()
    await screen.findByTestId('preview')
    resize(360)
    expect(lastProps().size).toBe(360)
    resize(1200)
    expect(lastProps().size).toBe(480)
  })

  test('보이지 않는 제목 "홈"이 있고 편집 버튼은 없다', () => {
    view()
    expect(screen.getByRole('heading', { name: '홈' }).className).toContain('sr-only')
    expect(screen.queryByRole('button', { name: '편집' })).toBeNull()
  })
})

describe('HomePage: 접속 중 친구', () => {
  test('미리보기 게임의 전체 방을 듣기만 하고, 바뀐 목록을 미리보기에 넘긴다', async () => {
    view()
    await screen.findByTestId('preview')
    expect(pres.joins).toEqual([['fishing', 'u1', true]])
    pres.peers = [{ id: 'u2', handle: 'son', area: 'forest', act: 'fish', tx: 1, ty: 1 }]
    act(() => { for (const cb of pres.subs) cb() })
    expect((lastProps() as { online: unknown[] }).online).toHaveLength(1)
  })

  test('떠나면 방을 나간다', async () => {
    const { unmount } = view()
    await screen.findByTestId('preview')
    unmount()
    expect(pres.leave[0]).toBe(1)
  })

  test('미리보기 게임이 숨김이고 관리자가 아니면 들어가지 않는다', () => {
    fishingHidden = true
    view()
    expect(pres.joins).toHaveLength(0)
  })
})
