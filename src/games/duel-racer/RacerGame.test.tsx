import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Controls } from './physics/controls.ts'

type Snap = Record<string, unknown> & { car: Record<string, unknown>; nitro: { gauge: number; burning: boolean } }
const h = vi.hoisted(() => ({
  snap: null as unknown as Snap,
  advanced: [] as Controls[],
  resets: 0,
  races: 0,
  sceneFail: false,
  rapierFail: false,
  view: null as unknown as Record<string, unknown>,
  stepped: [] as number[],
  matchOpts: null as unknown as Record<string, unknown> | null,
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
    return { draw: () => {}, setOpponent: () => {}, resize: () => {}, dispose: () => {} }
  },
}))
vi.mock('./match.ts', () => ({
  createMatch: (_R: unknown, o: Record<string, unknown>) => { h.matchOpts = o; return { race: { acc: 0 } } },
  stepMatch: (_s: unknown, now: number) => { h.stepped.push(now) },
  matchView: () => h.view,
  disposeMatch: () => {},
}))

import { RacerGame } from './RacerGame.tsx'
import type { RealtimeResult } from '../ui.ts'
import type { RealtimeLink } from '../../platform/duel/realtime/peer.ts'

function matchViewOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: 'waiting', stale: false, snap: baseSnap(), opponent: null, rank: null, oppProgress: null, heard: false, myFinish: undefined, oppFinish: undefined,
    alpha: 0, ...over,
  }
}

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
  h.view = matchViewOf()
  h.stepped = []
  h.matchOpts = null
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

describe('touch pad', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} }))
  })

  test('touch devices get on-screen buttons below the game', async () => {
    mount()
    await loaded()
    for (const name of ['왼쪽', '오른쪽', '가속', '브레이크', '니트로']) expect(screen.getByRole('button', { name })).toBeTruthy()
  })

  test('holding gas and left drives; letting go stops', async () => {
    h.snap = { ...baseSnap(), tick: 100, countdown: null }
    mount()
    await loaded()
    fireEvent.pointerDown(screen.getByRole('button', { name: '가속' }), { pointerId: 1 })
    fireEvent.pointerDown(screen.getByRole('button', { name: '왼쪽' }), { pointerId: 2 })
    await frame()
    expect(h.advanced.at(-1)!.throttle).toBe(1)
    expect(h.advanced.at(-1)!.steer).toBe(-1)
    fireEvent.pointerUp(screen.getByRole('button', { name: '왼쪽' }), { pointerId: 2 })
    fireEvent.pointerCancel(screen.getByRole('button', { name: '가속' }), { pointerId: 1 })
    await frame()
    expect(h.advanced.at(-1)!.throttle).toBe(0)
    expect(h.advanced.at(-1)!.steer).toBe(0)
  })

  test('nitro button boosts', async () => {
    h.snap = { ...baseSnap(), tick: 100, countdown: null }
    mount()
    await loaded()
    fireEvent.pointerDown(screen.getByRole('button', { name: '니트로' }), { pointerId: 3 })
    await frame()
    expect(h.advanced.at(-1)!.nitro).toBe(true)
  })
})

test('mouse devices get no on-screen buttons', async () => {
  mount()
  await loaded()
  expect(screen.queryByRole('button', { name: '가속' })).toBeNull()
})

// ---------------------------------------------------------------- 온라인 대국 화면
describe('match mode', () => {
  let linkStatus = 'direct'
  const statusCbs: ((s: string) => void)[] = []
  const link = {
    send: () => {}, onMessage: () => () => {}, close: () => {},
    status: () => linkStatus as 'direct',
    onStatus: (cb: (s: string) => void) => { statusCbs.push(cb); return () => {} },
  } as unknown as RealtimeLink
  const report = vi.fn()
  let serverTime = 1_000_000
  const mountMatch = (result: RealtimeResult | null = null) =>
    render(
      <RacerGame
        gameId="duel-racer" mode="match" onExit={onExit} matchId="m1" mySeat={0} names={['kane', 'son']}
        startAt={1_005_000} serverNow={() => serverTime} link={link} result={result} report={report}
      />,
    )
  beforeEach(() => { linkStatus = 'direct'; statusCbs.length = 0; report.mockReset(); serverTime = 1_000_000 })

  test('shows waiting, countdown, opponent name and rank', async () => {
    const r = mountMatch()
    await loaded()
    expect(h.matchOpts).toMatchObject({ mySeat: 0, startAt: 1_005_000 })
    expect(h.stepped.at(-1)).toBe(serverTime)
    expect(screen.getByText('상대 기다리는 중')).toBeTruthy()
    h.view = matchViewOf({ phase: 'countdown', heard: true, snap: { ...baseSnap(), countdown: 2 } })
    await frame()
    expect(screen.getByTestId('racer-countdown').textContent).toBe('2')
    expect(screen.queryByText('상대 기다리는 중')).toBeNull()
    h.view = matchViewOf({ phase: 'racing', heard: true, rank: 1, snap: { ...baseSnap(), countdown: null, tick: 600 } })
    await frame()
    expect(screen.getByTestId('racer-rank').textContent).toBe('1위')
    // 상대 표시가 없으면 진행 막대에 상대 점도 없다
    expect(screen.queryByTestId('racer-progress-opp')).toBeNull()
    h.view = matchViewOf({ phase: 'racing', heard: true, rank: 2, oppProgress: 0.42, snap: { ...baseSnap(), countdown: null, tick: 660 } })
    await frame()
    expect((screen.getByTestId('racer-progress-opp') as HTMLElement).style.bottom).toBe('42%')
    expect(screen.getByText(/son/)).toBeTruthy()
    // 서버 시각으로 진행한다
    serverTime += 5000
    await frame()
    expect(h.stepped.at(-1)).toBe(serverTime)
    r.unmount()
  })

  test('relay link shows 연결이 느려요', async () => {
    linkStatus = 'relay'
    mountMatch()
    await loaded()
    expect(screen.getByText('연결이 느려요')).toBeTruthy()
  })

  test('server result shows win/lose and both times; void shows 무효', async () => {
    h.view = matchViewOf({ phase: 'done', heard: true, myFinish: 4260, oppFinish: 4500 })
    const r = mountMatch({ winner: 0, void: false, scores: [4260, 4500] })
    await loaded()
    expect(screen.getByText('이겼어요')).toBeTruthy()
    expect(screen.getByTestId('racer-my-time').textContent).toBe('01:11.00')
    expect(screen.getByTestId('racer-opp-time').textContent).toBe('01:15.00')
    r.unmount()
    const r2 = mountMatch({ winner: 1, void: false, scores: [0, 4500] })
    await loaded()
    expect(screen.getByText('졌어요')).toBeTruthy()
    expect(screen.getByTestId('racer-my-time').textContent).toBe('미완주')
    r2.unmount()
    mountMatch({ winner: null, void: true, scores: null })
    await loaded()
    expect(screen.getByText('무효가 된 대국이에요')).toBeTruthy()
  })

  test('done before the server result waits for the result', async () => {
    h.view = matchViewOf({ phase: 'done', heard: true, myFinish: 4260 })
    mountMatch()
    await loaded()
    expect(screen.getByText('결과를 기다리는 중…')).toBeTruthy()
    expect(screen.getByTestId('racer-my-time').textContent).toBe('01:11.00')
  })

  test('version mismatch shows 새로고침 안내 on the stale side and 무효 안내 on the other', async () => {
    h.view = matchViewOf({ phase: 'version_mismatch', stale: true })
    const r = mountMatch()
    await loaded()
    expect(screen.getByText('게임이 새로 바뀌었어요. 새로고침해 주세요')).toBeTruthy()
    expect(screen.getByRole('button', { name: '새로고침' })).toBeTruthy()
    r.unmount()
    h.view = matchViewOf({ phase: 'version_mismatch', stale: false })
    mountMatch()
    await loaded()
    expect(screen.getByText('상대 화면이 옛 버전이라 이 대국은 무효가 돼요')).toBeTruthy()
  })

  test('on touch devices the full-screen layer steps aside once the server result is in (최종 리뷰 I6)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} }))
    h.view = matchViewOf({ phase: 'racing', heard: true, snap: { ...baseSnap(), countdown: null } })
    const r = mountMatch()
    await loaded()
    expect(r.container.querySelector('.dr-touch')).not.toBeNull()
    r.rerender(
      <RacerGame
        gameId="duel-racer" mode="match" onExit={onExit} matchId="m1" mySeat={0} names={['kane', 'son']}
        startAt={1_005_000} serverNow={() => serverTime} link={link} result={{ winner: 0, void: false, scores: [10, 20] }} report={report}
      />,
    )
    await frame()
    // 판돈·레이팅·재대결이 있는 플랫폼 결과 카드가 가려지지 않게 보통 배치로 돌아간다
    expect(r.container.querySelector('.dr-touch')).toBeNull()
    expect(screen.queryByRole('button', { name: '가속' })).toBeNull()
  })
})
