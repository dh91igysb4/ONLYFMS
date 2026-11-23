// 낚시 게임 화면. 규칙·가격·난수는 모두 서버에 있고, 화면은 행동을 보내고 돌아온 view를 그린다.
// 바 미니게임과 마을 걷기만 브라우저에서 돈다(서버는 검증하지 않는다). 단계 전환은 타이머, 그리기·미니게임·걷기는 rAF 한 개.
import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { ApiError, errorMessage, world, type WorldView } from '../../lib/api.ts'
import { useAuth } from '../../platform/auth/AuthProvider.tsx'
import type { WorldGameProps } from '../ui.ts'
import { AREAS, bagSize, HOOK_WINDOW_MS, MIN_FIGHT_MS, SPECIES, type TackleId } from './data.ts'
import { price, type Action, type Fish, type PendingView, type View } from './logic.ts'
import { barParams, barResult, gaugeAt, initBar, stepBar, type Bar, type BarParams } from './minigame.ts'
import { conditionsAt } from './clock.ts'
import { drawWorld, releaseSceneCache, SCENE_H, SCENE_W, type Phase } from './scene.ts'
import { castTarget, exitAt, interactionAt, shopSpot, TILE, tileOf, type Exit, type Interaction, type MapDef, type Vec } from './map.ts'
import { mapFor } from './maps/index.ts'
import { VILLAGE } from './maps/village.ts'
import { cameraFor, keysVector, stepWalk, type MoveInput, type Player } from './walk.ts'
import { loadPosition, savePosition } from './position.ts'
import { Controls, type ActionState } from './Controls.tsx'
import { BagPanel, DexPanel, ShopPanel } from './Menus.tsx'
import './fishing.css'

const OUTCOME_MS = 1200
const MAX_SCALE = 4
/** 장면 논리 크기 상한. 그리는 양을 묶고, 큰 모니터에서 장면이 물바다가 되지 않게 한다. */
const MAX_SCENE_W = 320
const MAX_SCENE_H = 480
/** 상점 창이 열린 뒤 이 시간 동안은 누르기·클릭을 받지 않는다(여는 손가락의 클릭이 구매 버튼에 떨어지지 않게) */
const PANEL_GUARD_MS = 300
/** 무대 아래 요소를 재고도 남겨 두는 여유 높이 */
const FIT_MARGIN = 8

/** 주어진 너비·높이에 들어가는 가장 큰 정수 배율 (1~4). 픽셀이 뭉개지지 않게 정수 배만 쓴다. */
export function canvasScale(availW: number, availH: number): number {
  const fit = Math.min(Math.floor(availW / SCENE_W), Math.floor(availH / SCENE_H))
  return Math.max(1, Math.min(MAX_SCALE, fit))
}

export type SceneFit = { scale: number; w: number; h: number }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const sizeOrZero = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0)

/**
 * 쓸 수 있는 영역에 맞춘 캔버스: 정수 배율과, 그 배율로 영역을 채우는 장면 논리 크기(160~320 × 240~480).
 * 장면은 늘이지 않고 더 넓게 그린다(카메라가 맵을 더 넓게 보여 준다).
 */
export function fitScene(availW: number, availH: number): SceneFit {
  const aw = sizeOrZero(availW)
  const ah = sizeOrZero(availH)
  const scale = canvasScale(aw, ah)
  return {
    scale,
    w: clamp(Math.floor(aw / scale), SCENE_W, MAX_SCENE_W),
    h: clamp(Math.floor(ah / scale), SCENE_H, MAX_SCENE_H),
  }
}

/**
 * 터치 안내 줄(.fish-hint-top)이 캔버스 위쪽에 차지하는 띠(CSS px): 위 여백 8 + 한 줄 높이 32(줄 20 + 위아래 6) + 틈 4.
 * 안내 줄은 한 줄로 고정한다(white-space: nowrap).
 */
export const TOUCH_HINT_BAND = 44

/** HUD 시계를 둘 맨 위 y(논리 px). 터치는 낚시 내내 위쪽에 뜨는 안내 줄 아래, 데스크톱은 0. */
export function hudTopFor(touch: boolean, scale: number): number {
  return touch ? Math.ceil(TOUCH_HINT_BAND / Math.max(1, scale)) : 0
}

/** 캔버스에 쓸 수 있는 높이: 창 높이 - 문서 맨 위에서 무대까지 - 무대 아래 요소 - 여유. 음수일 수 있다. */
export function availableHeight(innerH: number, stageTop: number, belowH: number): number {
  return innerH - stageTop - belowH - FIT_MARGIN
}

type Menu = 'bag' | 'shop' | 'dex'
type Outcome =
  | { kind: 'caught'; fish: Fish; isNew: boolean }
  | { kind: 'lost'; early: boolean }
type Notice = { kind: 'bag_full' } | { kind: 'error'; text: string } | { kind: 'info'; text: string }
type Keys = { up: boolean; down: boolean; left: boolean; right: boolean }
/** 누르기를 보낸 곳. 낚시 시작(충전·던지기)과 상점은 행동(버튼·스페이스)으로만, 챔·감기는 캔버스로도 된다. */
type Source = 'action' | 'canvas'
// 누르고 있는 것마다 다른 열쇠: 행동 버튼 'button', 스페이스 'space', 캔버스 `canvas:<id>`, 조이스틱 자리 `stick:<id>`

/** 렌더와 무관하게 프레임·타이머가 읽고 쓰는 진행 상태 */
type Runtime = {
  phase: Phase
  busy: boolean
  /** 지금 누르고 있는 것들의 열쇠. 하나라도 있으면 미니게임 바가 올라간다 */
  held: Set<string>
  /** 충전을 시작한 누르기. 그것을 뗄 때만 던진다 */
  chargeKey: string | null
  /** 상점 문 앞에서 누른 행동. 그것을 뗄 때 상점을 연다 */
  shopKey: string | null
  chargeStart: number
  gauge: number
  castPower: number
  player: Player
  /** 조이스틱 입력. 0이 아니면 키보드보다 먼저 */
  stick: MoveInput
  keys: Keys
  /** 지금 서 있는 자리의 상호작용 (화면 상태와 비교해 바뀔 때만 다시 그린다) */
  hereKey: string
  castSpot: string
  /** 던진 찌의 월드 위치 */
  bobber: Vec | null
  /** 서버 시각 - 로컬 시각 (마지막 응답 기준) */
  offset: number
  hookServerNow: number
  bar: Bar | null
  params: BarParams | null
  settling: boolean
  caughtSpecies: string | null
  lastFrame: number
  /** 지금 걷는 지역의 맵 (출구를 지나면 바뀐다) */
  map: MapDef
  /** 지역 전환 중: 페이드 아웃 → 맵 교체 → 페이드 인. 끝나면 null */
  trans: { exit: Exit; ms: number; swapped: boolean } | null
  /** 지역 전환 페이드 알파(0~1) */
  fade: number
}
/** 지역 전환 페이드 한 방향의 길이 */
const FADE_MS = 150
/** 전환 한 프레임이 더할 수 있는 최대 시간(약 30fps 한 프레임) */
const TRANSITION_STEP_MAX_MS = 34
/** 도착한 지역 이름을 보이는 시간 */
const AREA_NOTICE_MS = 1500

/** 전체화면 요청·해제는 실패해도(거절·미지원) 조용히 넘긴다. */
function ignoreRejection(fn: () => Promise<void> | void): void {
  try {
    void Promise.resolve(fn()).catch(() => {})
  } catch {
    /* 지원하지 않는 브라우저 */
  }
}

const codeOf = (e: unknown): string => (e instanceof ApiError ? e.code : 'network')
const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id
const gold = (n: number) => `${n.toLocaleString('ko-KR')} G`
// 결과를 모르는 실패: 오류 화면 없이 view를 다시 불러와 맞춘다.
const SILENT_CODES = new Set(['network', 'no_pending'])

const RETRY = '다시 시도해 주세요'
// 낚시 로직의 오류 코드 문구. 플랫폼 공통 문구(MESSAGES)에 넣지 않고 여기서만 쓴다.
const FISHING_MESSAGES: Record<string, string> = {
  bag_empty: '팔 물고기가 없어요',
  not_enough_gold: '골드가 부족해요',
  bad_tier: '이전 단계를 먼저 사야 해요',
  too_early: RETRY,
  too_late: RETRY,
  not_hooked: RETRY,
  bad_action: RETRY,
  bad_area: RETRY,
  bad_power: RETRY,
  bad_tackle: RETRY,
  already_owned: '이미 가지고 있어요',
  not_owned: RETRY,
  too_many: '칸이 모자라요',
  busy: '낚시 중에는 바꿀 수 없어요',
}
const fishingMessage = (code: string) => FISHING_MESSAGES[code] ?? errorMessage(code)

const DESKTOP_IDLE_HINT = '방향키로 이동 · 스페이스로 낚시/상점'
const HINTS: Partial<Record<Phase, string>> = {
  charging: '떼면 던져요',
  waiting: '입질을 기다리는 중…',
  bite: '지금 눌러요!',
  fighting: '누르고 있으면 막대가 올라가요',
}

const STOP: MoveInput = { x: 0, y: 0 }
const NO_KEYS: Keys = { up: false, down: false, left: false, right: false }
/** 방향키와 WASD. e.code(자판 위치)로 읽어 한글 입력 상태에서도 된다. */
const MOVE_KEYS: Record<string, keyof Keys> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
}
/** 터치 입력이 하나라도 있으면(마우스가 함께 있는 터치 노트북·태블릿 포함) 터치 조작을 보인다 */
const COARSE_QUERY = '(any-pointer: coarse)'
const coarseQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(COARSE_QUERY) : null

/**
 * 서 있는 자리에서 할 수 있는 일. 앞 타일로 정하되(interactionAt),
 * 상점 문 앞 칸에서는 어느 쪽을 보든 상점이다(시작 위치가 문 앞에서 아래를 본다).
 */
function interactionFor(map: MapDef, p: Pick<Player, 'pos' | 'facing'>): Interaction {
  const front = interactionAt(map, p.pos, p.facing)
  if (front) return front
  const t = tileOf(p.pos)
  const door = shopSpot(map)
  return door && t.tx === door.tx && t.ty === door.ty ? { kind: 'shop' } : null
}
const interactionKey = (i: Interaction): string => (i ? (i.kind === 'fish' ? `fish-${i.spot}` : 'shop') : '')

export function Game({ gameId }: WorldGameProps) {
  const { profile } = useAuth()
  const userId = profile?.id ?? null
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const [view, setView] = useState<View | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhaseState] = useState<Phase>('idle')
  const [menu, setMenuState] = useState<Menu | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const badExits = useRef(new Set<string>())
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [fit, setFit] = useState<SceneFit>({ scale: 1, w: SCENE_W, h: SCENE_H })
  const [fullscreen, setFullscreen] = useState(false)

  const rootRef = useRef<HTMLElement>(null)
  /** 사용자가 지금 전체화면을 원하는지, 요소 전체화면 요청이 아직 끝나지 않았는지 */
  const wantFullscreen = useRef(false)
  const fullscreenPending = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View | null>(null)
  const menuRef = useRef<Menu | null>(null)
  const shopOpenedAt = useRef(0)
  const alive = useRef(true)
  const timers = useRef(new Set<number>())
  const [rt] = useState<Runtime>(() => {
    // 마지막 위치(못 쓰는 값이면 상점 문 앞)에서 시작한다
    const saved = userId !== null ? loadPosition(userId) : null
    const map = (saved && mapFor(saved.area)) ?? VILLAGE
    const start = saved ?? VILLAGE.spawn
    const player: Player = { pos: { ...start.pos }, facing: start.facing, moving: false, walkMs: 0 }
    return {
      phase: 'idle', busy: false, held: new Set(), chargeKey: null, shopKey: null, chargeStart: 0, gauge: 0, castPower: 0,
      player, stick: STOP, keys: { ...NO_KEYS }, hereKey: interactionKey(interactionFor(map, player)), castSpot: 'shore', bobber: null,
      offset: 0, hookServerNow: 0, bar: null, params: null, settling: false, caughtSpecies: null, lastFrame: 0, map, trans: null, fade: 0,
    }
  })
  const [here, setHere] = useState<Interaction>(() => interactionFor(rt.map, rt.player))
  const [touch, setTouch] = useState(() => coarseQuery()?.matches ?? false)

  // ------------------------------------------------------------ 도우미
  const setPhase = (p: Phase) => {
    rt.phase = p
    setPhaseState(p)
  }
  /** 걷기 입력을 모두 놓는다. 키를 뗀 알림은 창이 초점을 잃으면 오지 않을 수 있다. */
  const clearMove = () => {
    rt.stick = STOP
    rt.keys = { ...NO_KEYS }
  }
  /**
   * 창이 초점을 잃거나 가려졌다: 뗀 알림이 오지 않을 수 있으므로 누르고 있던 것을 모두 놓는다.
   * 아직 던지지 않은 충전은 던지지 않고 대기로 돌아간다(던지는 요청이 이미 나갔으면 그대로 둔다).
   */
  const dropInput = () => {
    clearMove()
    rt.held.clear()
    rt.chargeKey = null
    rt.shopKey = null
    if (rt.phase === 'charging' && !rt.busy) setPhase('idle')
  }
  /** 초점을 게임으로 돌려 스페이스(던지기)가 방금 누른 버튼을 다시 누르지 않게 한다 */
  const focusGame = () => rootRef.current?.focus({ preventScroll: true })
  const savePlayer = () => {
    const id = userIdRef.current
    if (id !== null) savePosition(id, { area: rt.map.id, pos: rt.player.pos, facing: rt.player.facing })
  }
  const setMenu = (m: Menu | null) => {
    if (m) {
      clearMove()
      rt.held.clear()
      rt.chargeKey = null
      rt.shopKey = null
      if (m === 'shop') shopOpenedAt.current = performance.now()
    }
    menuRef.current = m
    setMenuState(m)
  }
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }
  const clearTimers = () => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current.clear()
  }
  const serverNow = () => Date.now() + rt.offset
  const resetFight = () => {
    rt.bar = null
    rt.params = null
    rt.settling = false
  }

  async function send<R>(body: Parameters<typeof world>[0]): Promise<WorldView<View, R>> {
    rt.busy = true
    setBusy(true)
    try {
      const res = await world<View, R>(body)
      if (alive.current) {
        rt.offset = res.server_now - Date.now()
        viewRef.current = res.view
        setView(res.view)
      }
      return res
    } finally {
      rt.busy = false
      if (alive.current) setBusy(false)
    }
  }
  const act = <R,>(payload: Action) => send<R>({ game: gameId, action: 'act', payload })

  async function load() {
    setLoadError(null)
    try {
      await send({ game: gameId, action: 'load' })
    } catch (e) {
      if (alive.current) setLoadError(errorMessage(codeOf(e)))
    }
  }

  /** 서버 상태를 모르게 된 실패: 진행을 접고 view를 다시 불러온 뒤 idle. */
  async function recover(code: string) {
    clearTimers()
    resetFight()
    setOutcome(null)
    setPhase('idle')
    if (!SILENT_CODES.has(code)) setNotice({ kind: 'error', text: fishingMessage(code) })
    try {
      await send({ game: gameId, action: 'load' })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  function showOutcome(o: Outcome) {
    resetFight()
    rt.caughtSpecies = o.kind === 'caught' ? o.fish.species : null
    setOutcome(o)
    setPhase(o.kind)
    later(() => {
      rt.caughtSpecies = null
      setOutcome(null)
      setPhase('idle')
    }, OUTCOME_MS)
  }

  // ------------------------------------------------------------ 단계
  async function cast(power: number) {
    rt.castPower = power
    rt.bobber = castTarget(rt.map, rt.player.pos, rt.player.facing, power)
    let res: WorldView<View, PendingView>
    try {
      res = await act<PendingView>({ type: 'cast', area: rt.map.id, power, spot: rt.castSpot })
    } catch (e) {
      if (!alive.current) return
      const code = codeOf(e)
      setPhase('idle')
      setNotice(code === 'bag_full' ? { kind: 'bag_full' } : { kind: 'error', text: fishingMessage(code) })
      return
    }
    if (!alive.current) return
    const p = res.result ?? res.view.pending
    if (!p) {
      setPhase('idle')
      return
    }
    setPhase('waiting')
    const biteAt = p.startedAt + p.biteDelayMs
    later(() => {
      setPhase('bite')
      later(() => void lose(false), HOOK_WINDOW_MS)
    }, Math.max(0, biteAt - serverNow()))
  }

  /** 너무 일찍 챘거나 챔 창을 놓쳤다. 어종은 모른 채 끝낸다. */
  async function lose(early: boolean) {
    clearTimers()
    try {
      await act({ type: 'resolve', success: false, perfect: false })
    } catch (e) {
      if (alive.current) await recover(codeOf(e))
      return
    }
    if (alive.current) showOutcome({ kind: 'lost', early })
  }

  async function hook() {
    clearTimers()
    let res: WorldView<View, { species: string; sizeCm: number }>
    try {
      res = await act<{ species: string; sizeCm: number }>({ type: 'hook' })
    } catch (e) {
      if (!alive.current) return
      const code = codeOf(e)
      if (code === 'too_early' || code === 'too_late') await lose(code === 'too_early')
      else await recover(code)
      return
    }
    if (!alive.current) return
    if (!res.result) {
      await recover('network')
      return
    }
    rt.hookServerNow = res.server_now
    rt.bar = initBar()
    rt.params = barParams(res.result.species, res.view.rodTier, res.view.equipped)
    rt.settling = false
    setPhase('fighting')
  }

  /** 미니게임이 끝났다. 서버는 챈 뒤 MIN_FIGHT_MS 전의 성공을 거절하므로 그때까지 기다렸다 보낸다. */
  function endFight(success: boolean, perfect: boolean) {
    rt.settling = true
    const wait = success ? Math.max(0, rt.hookServerNow + MIN_FIGHT_MS - serverNow()) : 0
    later(() => void finishFight(success, success && perfect), wait)
  }

  async function finishFight(success: boolean, perfect: boolean) {
    const before = viewRef.current
    let res: WorldView<View, { caught: Fish | null }>
    try {
      res = await act<{ caught: Fish | null }>({ type: 'resolve', success, perfect })
    } catch (e) {
      if (alive.current) await recover(codeOf(e))
      return
    }
    if (!alive.current) return
    const fish = res.result?.caught ?? null
    if (fish) showOutcome({ kind: 'caught', fish, isNew: !before?.dex[fish.species] })
    else showOutcome({ kind: 'lost', early: false })
  }

  // ------------------------------------------------------------ 입력
  function press(source: Source, key: string) {
    rt.held.add(key)
    if (rt.busy || rt.trans || menuRef.current || !viewRef.current) return
    switch (rt.phase) {
      case 'idle': {
        if (source !== 'action') break
        const at = interactionFor(rt.map, rt.player)
        if (!at) break
        if (at.kind === 'shop') {
          // 상점은 뗄 때 연다: 누를 때 열면 같은 손가락의 클릭이 방금 뜬 상점 버튼에 떨어진다
          rt.shopKey = key
          break
        }
        // 충전부터는 걷지 않으므로 자리와 방향이 그대로 고정된다.
        // 뗀 알림을 잃은 상점 누르기가 남아 있으면 버린다(같은 열쇠의 떼기를 상점 쪽이 가로채지 않게).
        setNotice(null)
        rt.shopKey = null
        rt.chargeKey = key
        rt.castSpot = at.spot
        rt.chargeStart = performance.now()
        rt.gauge = 0
        setPhase('charging')
        break
      }
      case 'waiting':
        void lose(true)
        break
      case 'bite':
        void hook()
        break
      default:
        break
    }
  }

  function release(key: string) {
    rt.held.delete(key)
    if (key === rt.shopKey) {
      rt.shopKey = null
      // 아직 대기 중이고 여전히 상점 문 앞일 때만
      if (rt.phase === 'idle' && !rt.busy && !menuRef.current && interactionFor(rt.map, rt.player)?.kind === 'shop') {
        setNotice(null)
        setMenu('shop')
      }
      return
    }
    // 충전은 시작한 누르기를 뗄 때만 던진다. 다른 손가락을 떼도 끊기지 않는다.
    if (key !== rt.chargeKey || rt.phase !== 'charging' || rt.busy) return
    rt.chargeKey = null
    const power = gaugeAt(performance.now() - rt.chargeStart)
    rt.gauge = power
    void cast(power)
  }

  /** 출구에 닿았다: 입력을 잠그고 페이드 아웃을 시작한다 */
  function startTransition(exit: Exit) {
    // 조이스틱·방향키는 놓지 않는다: 누른 채 도착하면 페이드 뒤에 이어서 걷는다(걷기는 전환 중 막혀 있다)
    rt.held.clear()
    rt.shopKey = null
    rt.player = { ...rt.player, moving: false, walkMs: 0 }
    rt.trans = { exit, ms: 0, swapped: false }
  }

  /** 페이드 아웃 → 맵·위치·방향 교체와 저장 → 페이드 인. 끝나는 프레임에는 출구를 다시 보지 않는다. */
  function stepTransition(dt: number) {
    const tr = rt.trans
    if (!tr) return
    // 맵을 바꾸는 프레임의 멈칫이 다음 dt에 실려 와도 페이드 인이 통째로 건너뛰어지지 않게 한 걸음을 줄인다
    tr.ms += Math.min(dt, TRANSITION_STEP_MAX_MS)
    if (!tr.swapped && tr.ms >= FADE_MS) {
      const next = mapFor(tr.exit.target)
      if (!next) {
        // 맵이 없는 지역으로 가는 출구는 만들지 않지만, 있다면 전환을 접는다
        rt.trans = null
        rt.fade = 0
        return
      }
      tr.swapped = true
      const { tx, ty, facing } = tr.exit.entry
      rt.map = next
      rt.player = { pos: { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }, facing, moving: false, walkMs: 0 }
      savePlayer()
      const name = AREAS.find((a) => a.id === next.id)?.name
      if (name) {
        // 오류 알림이 떠 있으면 덮지 않는다
        setNotice((n) => (n && n.kind !== 'info' ? n : { kind: 'info', text: name }))
        later(() => setNotice((n) => (n?.kind === 'info' && n.text === name ? null : n)), AREA_NOTICE_MS)
      }
    }
    if (tr.ms >= FADE_MS * 2) {
      rt.trans = null
      rt.fade = 0
      return
    }
    rt.fade = tr.ms < FADE_MS ? tr.ms / FADE_MS : 1 - (tr.ms - FADE_MS) / FADE_MS
  }

  /** 서 있는 자리의 상호작용이 바뀌었을 때만 화면 상태를 고친다. */
  function syncHere() {
    const at = interactionFor(rt.map, rt.player)
    const k = interactionKey(at)
    if (k === rt.hereKey) return
    rt.hereKey = k
    setHere(at)
  }

  function frame(ctx: CanvasRenderingContext2D, now: number) {
    const dt = now - rt.lastFrame
    rt.lastFrame = now
    // 걷기는 대기 중이고 메뉴가 닫혀 있을 때만. 충전부터 결과 표시까지는 자리·방향이 고정된다.
    const wasMoving = rt.player.moving
    let started = false
    if (rt.trans) {
      stepTransition(dt)
    } else if (rt.phase === 'idle' && !menuRef.current) {
      const input = rt.stick.x !== 0 || rt.stick.y !== 0 ? rt.stick : keysVector(rt.keys)
      rt.player = stepWalk(rt.map, rt.player, input, dt)
      // 걷는 중에만 출구를 본다(낚시 단계·메뉴·전환 중에는 보지 않는다)
      const exit = exitAt(rt.map, rt.player.pos)
      if (exit && mapFor(exit.target)) {
        startTransition(exit)
        started = true
      } else if (exit && !badExits.current.has(exit.target)) {
        // 맵이 없는 지역으로 가는 출구는 무시한다(전환을 시작하면 페이드만 하고 제자리라 갇힌 것처럼 보인다)
        badExits.current.add(exit.target)
        console.error(`fishing: exit to unmapped area "${exit.target}" ignored`)
      }
    } else if (rt.player.moving) {
      rt.player = { ...rt.player, moving: false, walkMs: 0 }
    }
    // 전환을 시작한 프레임의 출구 칸 위치는 저장하지 않는다(도착 위치만 저장)
    if (wasMoving && !rt.player.moving && !started) savePlayer()
    syncHere()

    if (rt.phase === 'charging' && !rt.busy) rt.gauge = gaugeAt(now - rt.chargeStart)
    if (rt.phase === 'fighting' && rt.bar && rt.params && !rt.settling) {
      rt.bar = stepBar(rt.bar, rt.held.size > 0, dt, rt.params, Math.random)
      const r = barResult(rt.bar)
      if (r !== 'playing') endFight(r === 'caught', rt.bar.perfect)
    }
    const size = { w: fit.w, h: fit.h }
    const fishing = rt.phase === 'waiting' || rt.phase === 'bite' || rt.phase === 'fighting' || rt.phase === 'lost'
    const { pos } = rt.player
    drawWorld(ctx, {
      map: rt.map,
      phase: rt.phase,
      tMs: now,
      gauge: rt.gauge,
      player: rt.player,
      // 캐릭터는 반올림한 자리에 그려지므로 카메라도 반올림한 자리를 따라간다(홀수 폭에서 1px 흔들림 방지)
      camera: cameraFor(rt.map, { x: Math.round(pos.x), y: Math.round(pos.y) }, size),
      bobber: fishing ? rt.bobber : null,
      bar: rt.bar,
      barParams: rt.params,
      caughtSpecies: rt.caughtSpecies,
      cond: conditionsAt(Date.now() + rt.offset),
      hudTop: hudTopFor(touch, fit.scale),
      fade: rt.fade,
    }, size)
  }

  // 이벤트·프레임 콜백이 늘 최신 함수를 부르게 한다
  const handlers = useRef({ press, release, frame })
  handlers.current = { press, release, frame }

  // ------------------------------------------------------------ 효과
  useEffect(() => {
    alive.current = true
    void load()
    const pending = timers.current
    return () => {
      alive.current = false
      for (const id of pending) window.clearTimeout(id)
      pending.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  // 화면을 떠나면 장면 배경 캐시(오프스크린 캔버스)를 놓아 준다
  useEffect(() => releaseSceneCache, [])

  // 마지막 위치: 걸음이 멈출 때(프레임), 탭이 가려질 때, 화면을 떠날 때 저장한다.
  // 창이 초점을 잃거나 가려지면 키·손가락을 뗀 알림을 놓칠 수 있으므로 누르고 있던 입력을 모두 놓는다.
  useEffect(() => {
    const onBlur = () => dropInput()
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      dropInput()
      savePlayer()
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      savePlayer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 터치 입력이 있는 기기((any-pointer: coarse))에서만 조이스틱·행동 버튼을 보인다
  useEffect(() => {
    const mq = coarseQuery()
    if (!mq || typeof mq.addEventListener !== 'function') return
    const onChange = () => setTouch(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const loaded = view !== null

  // rAF 루프: 마운트돼 있고 탭이 보일 때만 하나 돈다
  useEffect(() => {
    if (!loaded) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    let raf = 0
    let running = false
    const loop = () => {
      raf = requestAnimationFrame(loop)
      handlers.current.frame(ctx, performance.now())
    }
    const start = () => {
      if (running || document.visibilityState === 'hidden') return
      running = true
      rt.lastFrame = performance.now()
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }
    const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)
    start()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loaded, rt])

  // 캔버스 크기: 무대 너비와 남은 화면 높이로 fitScene(정수 배율 + 그 배율로 채우는 장면 크기).
  // 무대 위(사이트 머리·제목·골드 줄)는 무대의 문서 위치로, 무대 아래는 늘 있는 가방·메뉴 줄과 간격만 잰다.
  // 안내 줄과 메뉴 창은 캔버스 위에 겹쳐 뜨고, 잠깐 뜨는 알림은 재지 않아 캔버스 크기가 흔들리지 않는다.
  // 캔버스 자신의 높이는 쓰지 않으므로 크기가 바뀌어도 다시 재는 값은 그대로다.
  // 전체화면에서는 화면을 채우는 캔버스 칸(무대) 자신의 상자를 잰다.
  useEffect(() => {
    const el = stageRef.current
    if (!loaded || !el) return
    const available = (): [number, number] => {
      if (fullscreen) return [el.clientWidth, el.clientHeight]
      const bottom = bottomRef.current
      const root = el.parentElement
      const gap = root ? parseFloat(getComputedStyle(root).rowGap) || 0 : 0
      const belowH = (bottom?.offsetHeight ?? 0) + gap
      const stageTop = el.getBoundingClientRect().top + window.scrollY
      return [el.clientWidth, availableHeight(window.innerHeight, stageTop, belowH)]
    }
    const measure = () => {
      const next = fitScene(...available())
      setFit((prev) => (prev.scale === next.scale && prev.w === next.w && prev.h === next.h ? prev : next))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [loaded, fullscreen])

  // 전체화면: 게임 전체가 화면을 덮는 고정 덮개가 된다(아이폰 사파리처럼 요소 전체화면이 없어도 동작).
  // 있는 동안 페이지 스크롤을 막고, Esc(메뉴 창이 없을 때)나 브라우저 전체화면 종료로 나간다.
  // 나가거나 페이지를 떠나면 스크롤을 되돌리고 브라우저 전체화면도 끝낸다.
  // 요소 전체화면 요청이 끝나기 전에 알림이 와도(전체화면 요소 없음) 덮개는 그대로 둔다.
  useEffect(() => {
    if (!fullscreen) return
    const root = rootRef.current
    const html = document.documentElement
    const prevOverflow = html.style.overflow
    html.style.overflow = 'hidden'
    const leave = () => {
      wantFullscreen.current = false
      setFullscreen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !menuRef.current) leave()
    }
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && !fullscreenPending.current) leave()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      wantFullscreen.current = false
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      html.style.overflow = prevOverflow
      if (root && document.fullscreenElement === root && typeof document.exitFullscreen === 'function') {
        ignoreRejection(() => document.exitFullscreen())
      }
    }
  }, [fullscreen])

  // 스페이스 키 = 행동. 버튼·입력칸에 초점이 있으면 그쪽 동작에 맡긴다.
  // 방향키·WASD = 걷기. 입력칸에서 칠 때와 메뉴가 열려 있을 때(창 스크롤)는 건드리지 않는다. 떼기는 늘 받는다.
  useEffect(() => {
    const isSpace = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' '
    const onControl = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.closest('button, a, input, textarea, select') !== null
    const onTextField = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select') !== null)
    const down = (e: KeyboardEvent) => {
      const dir = MOVE_KEYS[e.code]
      if (dir) {
        if (e.ctrlKey || e.metaKey || e.altKey || onTextField(e.target) || menuRef.current) return
        e.preventDefault()
        rt.keys = { ...rt.keys, [dir]: true }
        return
      }
      if (!isSpace(e) || onControl(e.target)) return
      e.preventDefault()
      if (!e.repeat) handlers.current.press('action', 'space')
    }
    const up = (e: KeyboardEvent) => {
      const dir = MOVE_KEYS[e.code]
      if (dir) {
        rt.keys = { ...rt.keys, [dir]: false }
        return
      }
      if (!isSpace(e) || onControl(e.target)) return
      e.preventDefault()
      handlers.current.release('space')
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [rt])

  // ------------------------------------------------------------ 메뉴 행동
  async function sell() {
    setNotice(null)
    try {
      const res = await act<{ earned: number }>({ type: 'sell' })
      if (alive.current && res.result) setNotice({ kind: 'info', text: `${gold(res.result.earned)}를 벌었어요` })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function buyRod(tier: number) {
    setNotice(null)
    try {
      await act({ type: 'buyRod', tier })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function buyBag(tier: number) {
    setNotice(null)
    try {
      await act({ type: 'buyBag', tier })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function buyTackle(id: TackleId) {
    setNotice(null)
    try {
      await act({ type: 'buyTackle', id })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  async function equip(ids: TackleId[]) {
    setNotice(null)
    try {
      await act({ type: 'equip', ids })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: fishingMessage(codeOf(e)) })
    }
  }

  /** 상점 창이 막 열렸으면 누르기·클릭을 버린다(여는 손가락의 유령 클릭 방지) */
  const guardShop = (e: SyntheticEvent) => {
    if (menuRef.current === 'shop' && performance.now() - shopOpenedAt.current < PANEL_GUARD_MS) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const toggleMenu = (m: Menu) => {
    focusGame()
    setMenu(menuRef.current === m ? null : m)
  }
  const closeMenu = () => {
    focusGame()
    setMenu(null)
  }

  function toggleFullscreen() {
    const root = rootRef.current
    focusGame()
    if (fullscreen) {
      wantFullscreen.current = false
      setFullscreen(false)
      return
    }
    wantFullscreen.current = true
    setFullscreen(true)
    // 데스크톱·안드로이드에서는 브라우저 화면 요소까지 숨긴다. 거절돼도 덮개는 그대로 쓴다.
    // 요청이 끝나기 전에 나갔으면(또는 화면을 떠났으면) 끝난 뒤 브라우저 전체화면도 끝낸다.
    if (root && typeof root.requestFullscreen === 'function') {
      fullscreenPending.current = true
      const settle = () => {
        fullscreenPending.current = false
      }
      ignoreRejection(() =>
        Promise.resolve(root.requestFullscreen()).then(() => {
          settle()
          if (!wantFullscreen.current && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
            ignoreRejection(() => document.exitFullscreen())
          }
        }, settle),
      )
    }
  }

  // ------------------------------------------------------------ 그리기
  if (!view) {
    if (loadError) {
      return (
        <section className="fish">
          <p className="notice" role="alert">{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            다시 시도
          </button>
        </section>
      )
    }
    return <p className="muted">불러오는 중…</p>
  }

  const notices = notice && (
    <>
      {notice.kind === 'bag_full' && (
        <p className="notice" role="alert">가방이 가득 찼어요. 상점에 가서 팔아 주세요</p>
      )}
      {notice.kind === 'error' && <p className="notice" role="alert">{notice.text}</p>}
      {notice.kind === 'info' && <p className="fish-info">{notice.text}</p>}
    </>
  )
  const menuLocked = phase === 'charging' || phase === 'waiting' || phase === 'bite' || phase === 'fighting'
  // 전체화면에서는 알림이 캔버스에 겹쳐 뜨므로(데스크톱은 아래쪽, 터치는 조작을 가리지 않게 위쪽) 그동안 안내 줄은 숨긴다.
  // 터치에서는 아래쪽에 조작이 있으므로 안내 줄을 위에 띄우고, 대기 중 안내는 데스크톱에만 둔다.
  const idleHint = touch ? undefined : DESKTOP_IDLE_HINT
  const hint = menu || (fullscreen && notices) ? null : phase === 'idle' ? idleHint : HINTS[phase]
  const atShop = here?.kind === 'shop'
  // 낚시가 시작되면(충전~결과) 챔·감기를 위해 늘 누를 수 있다
  const action: ActionState =
    phase !== 'idle' ? { label: '낚시', enabled: true }
      : atShop ? { label: '상점', enabled: true }
        : here ? { label: '낚시', enabled: true }
          : { label: '낚시', enabled: false }

  return (
    <section className={fullscreen ? 'fish fish-full' : 'fish'} ref={rootRef} tabIndex={-1}>
      <div className="fish-top">
        <strong className="fish-gold">{gold(view.gold)}</strong>
      </div>

      <div className="fish-stage" ref={stageRef}>
        <div className="fish-frame" style={{ width: fit.w * fit.scale, height: fit.h * fit.scale }}>
          <canvas
            ref={canvasRef}
            className="fish-canvas"
            aria-label="낚시터"
            width={fit.w}
            height={fit.h}
            style={{ width: fit.w * fit.scale, height: fit.h * fit.scale }}
            onPointerDown={(e) => {
              e.preventDefault()
              try {
                e.currentTarget.setPointerCapture?.(e.pointerId)
              } catch {
                /* 포인터 캡처를 못 해도 입력은 받는다 */
              }
              handlers.current.press('canvas', `canvas:${e.pointerId}`)
            }}
            onPointerUp={(e) => handlers.current.release(`canvas:${e.pointerId}`)}
            onPointerCancel={(e) => handlers.current.release(`canvas:${e.pointerId}`)}
            onLostPointerCapture={(e) => handlers.current.release(`canvas:${e.pointerId}`)}
          />
          {touch && !menu && (
            <Controls
              onMove={(v) => {
                rt.stick = v
              }}
              action={action}
              onActionDown={() => handlers.current.press('action', 'button')}
              onActionUp={() => handlers.current.release('button')}
              // 결과 표시 중에 잡은 조이스틱은 걷기로 잡아 두면 대기로 돌아오자마자 걷는다(프레임은 대기에서만 걷는다)
              walking={phase === 'idle' || phase === 'caught' || phase === 'lost'}
              // 입질 전(대기)에는 조이스틱을 만지작거려도 일찍 챈 것으로 치지 않는다. 챔·감기는 입질·싸움에서만
              onTapDown={(id) => {
                if (rt.phase !== 'waiting') handlers.current.press('canvas', `stick:${id}`)
              }}
              onTapUp={(id) => handlers.current.release(`stick:${id}`)}
            />
          )}
          {outcome && (
            <div className="fish-toast" aria-live="polite">
              {outcome.kind === 'caught' ? (
                <>
                  {outcome.isNew && <strong className="fish-new">새로운 물고기!</strong>}
                  <span>
                    {speciesName(outcome.fish.species)} {outcome.fish.sizeCm}cm
                    {outcome.fish.perfect ? ' · 완벽!' : ''}
                  </span>
                  <span className="fish-toast-price">
                    {gold(price(outcome.fish.species, outcome.fish.sizeCm, outcome.fish.perfect))}
                  </span>
                </>
              ) : (
                <span>{outcome.early ? '너무 일찍 챘어요' : '놓쳤어요'}</span>
              )}
            </div>
          )}
          {hint && !outcome && <p className={touch ? 'fish-hint fish-hint-top' : 'fish-hint'}>{hint}</p>}
          {menu && (
            <div
              className="fish-panel"
              onPointerDownCapture={guardShop}
              onPointerUpCapture={guardShop}
              onClickCapture={guardShop}
            >
              <div className="fish-panel-head">
                <h3 className="fish-panel-title">{menu === 'bag' ? '가방' : menu === 'shop' ? '상점' : '도감'}</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeMenu}>
                  닫기
                </button>
              </div>
              {menu === 'bag' && <BagPanel view={view} atShop={atShop} busy={busy} onEquip={(ids) => void equip(ids)} />}
              {menu === 'shop' && (
                <ShopPanel
                  view={view}
                  busy={busy}
                  onSell={() => void sell()}
                  onBuy={(t) => void buyRod(t)}
                  onBuyBag={(t) => void buyBag(t)}
                  onBuyTackle={(id) => void buyTackle(id)}
                />
              )}
              {menu === 'dex' && <DexPanel view={view} currentArea={rt.map.id} />}
            </div>
          )}
          {fullscreen && notices && <div className={touch ? 'fish-notices fish-notices-top' : 'fish-notices'}>{notices}</div>}
        </div>
      </div>

      {!fullscreen && notices}

      <div className="fish-bottom" ref={bottomRef}>
        <span className="fish-bag-count">
          가방 <strong>{view.bag.length}/{bagSize(view.bagTier)}</strong>
        </span>
        <div className="fish-menu">
          {(['bag', 'dex'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn btn-sm ${menu === m ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={menu === m}
              disabled={menuLocked}
              onClick={() => toggleMenu(m)}
            >
              {m === 'bag' ? '가방' : '도감'}
            </button>
          ))}
          <button
            type="button"
            className={`btn btn-sm ${fullscreen ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={fullscreen}
            disabled={phase === 'fighting'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? '나가기' : '전체화면'}
          </button>
        </div>
      </div>
    </section>
  )
}
