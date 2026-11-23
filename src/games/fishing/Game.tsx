// 낚시 게임 화면. 규칙·가격·난수는 모두 서버에 있고, 화면은 행동을 보내고 돌아온 view를 그린다.
// 바 미니게임만 브라우저에서 돈다(서버는 검증하지 않는다). 단계 전환은 타이머, 그리기·미니게임은 rAF 한 개.
import { useEffect, useRef, useState } from 'react'
import { ApiError, errorMessage, world, type WorldView } from '../../lib/api.ts'
import type { WorldGameProps } from '../ui.ts'
import { AREAS, BAG_SIZE, HOOK_WINDOW_MS, MIN_FIGHT_MS, SPECIES } from './data.ts'
import { price, type Action, type Fish, type PendingView, type View } from './logic.ts'
import { barParams, barResult, gaugeAt, initBar, stepBar, type Bar, type BarParams } from './minigame.ts'
import { drawScene, SCENE_H, SCENE_W, type Phase } from './scene.ts'
import { BagPanel, DexPanel, ShopPanel } from './Menus.tsx'
import './fishing.css'

const AREA = AREAS[0].id
const OUTCOME_MS = 1200
const MAX_SCALE = 4
/** 장면 논리 크기 상한. 그리는 양을 묶고, 큰 모니터에서 장면이 물바다가 되지 않게 한다. */
const MAX_SCENE_W = 320
const MAX_SCENE_H = 480
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
 * 장면은 늘이지 않고 더 넓게 그린다(scene.ts의 안전 상자 밖은 배경).
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

/** 캔버스에 쓸 수 있는 높이: 창 높이 - 문서 맨 위에서 무대까지 - 무대 아래 요소 - 여유. 음수일 수 있다. */
export function availableHeight(innerH: number, stageTop: number, belowH: number): number {
  return innerH - stageTop - belowH - FIT_MARGIN
}

type Menu = 'bag' | 'shop' | 'dex'
type Outcome =
  | { kind: 'caught'; fish: Fish; isNew: boolean }
  | { kind: 'lost'; early: boolean }
type Notice = { kind: 'bag_full' } | { kind: 'error'; text: string } | { kind: 'info'; text: string }

/** 렌더와 무관하게 프레임·타이머가 읽고 쓰는 진행 상태 */
type Runtime = {
  phase: Phase
  busy: boolean
  pointer: boolean
  chargeStart: number
  gauge: number
  castPower: number
  /** 서버 시각 - 로컬 시각 (마지막 응답 기준) */
  offset: number
  hookServerNow: number
  bar: Bar | null
  params: BarParams | null
  settling: boolean
  caughtSpecies: string | null
  lastFrame: number
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
}
const fishingMessage = (code: string) => FISHING_MESSAGES[code] ?? errorMessage(code)

const HINTS: Partial<Record<Phase, string>> = {
  idle: '화면을 눌러 힘을 모으고, 떼면 던져요',
  charging: '떼면 던져요',
  waiting: '입질을 기다리는 중…',
  bite: '지금 눌러요!',
  fighting: '누르고 있으면 막대가 올라가요',
}

export function Game({ gameId }: WorldGameProps) {
  const [view, setView] = useState<View | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhaseState] = useState<Phase>('idle')
  const [menu, setMenuState] = useState<Menu | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [fit, setFit] = useState<SceneFit>({ scale: 1, w: SCENE_W, h: SCENE_H })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View | null>(null)
  const menuRef = useRef<Menu | null>(null)
  const alive = useRef(true)
  const timers = useRef(new Set<number>())
  const rt = useRef<Runtime>({
    phase: 'idle', busy: false, pointer: false, chargeStart: 0, gauge: 0, castPower: 0, offset: 0,
    hookServerNow: 0, bar: null, params: null, settling: false, caughtSpecies: null, lastFrame: 0,
  }).current

  // ------------------------------------------------------------ 도우미
  const setPhase = (p: Phase) => {
    rt.phase = p
    setPhaseState(p)
  }
  const setMenu = (m: Menu | null) => {
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
    let res: WorldView<View, PendingView>
    try {
      res = await act<PendingView>({ type: 'cast', area: AREA, power })
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
    rt.params = barParams(res.result.species, res.view.rodTier)
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
  function press() {
    rt.pointer = true
    if (rt.busy || menuRef.current || !viewRef.current) return
    switch (rt.phase) {
      case 'idle':
        setNotice(null)
        rt.chargeStart = performance.now()
        rt.gauge = 0
        setPhase('charging')
        break
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

  function release() {
    rt.pointer = false
    if (rt.phase !== 'charging' || rt.busy) return
    const power = gaugeAt(performance.now() - rt.chargeStart)
    rt.gauge = power
    void cast(power)
  }

  function frame(ctx: CanvasRenderingContext2D, now: number) {
    const dt = now - rt.lastFrame
    rt.lastFrame = now
    if (rt.phase === 'charging' && !rt.busy) rt.gauge = gaugeAt(now - rt.chargeStart)
    if (rt.phase === 'fighting' && rt.bar && rt.params && !rt.settling) {
      rt.bar = stepBar(rt.bar, rt.pointer, dt, rt.params, Math.random)
      const r = barResult(rt.bar)
      if (r !== 'playing') endFight(r === 'caught', rt.bar.perfect)
    }
    drawScene(ctx, {
      phase: rt.phase,
      tMs: now,
      gauge: rt.gauge,
      castPower: rt.castPower,
      bar: rt.bar,
      barParams: rt.params,
      caughtSpecies: rt.caughtSpecies,
    }, { w: fit.w, h: fit.h })
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
  useEffect(() => {
    const el = stageRef.current
    if (!loaded || !el) return
    const measure = () => {
      const bottom = bottomRef.current
      const root = el.parentElement
      const gap = root ? parseFloat(getComputedStyle(root).rowGap) || 0 : 0
      const belowH = (bottom?.offsetHeight ?? 0) + gap
      const stageTop = el.getBoundingClientRect().top + window.scrollY
      const next = fitScene(el.clientWidth, availableHeight(window.innerHeight, stageTop, belowH))
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
  }, [loaded])

  // 스페이스 키 = 누르기. 버튼·입력칸에 초점이 있으면 그쪽 동작에 맡긴다.
  useEffect(() => {
    const isSpace = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' '
    const onControl = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.closest('button, a, input, textarea, select') !== null
    const down = (e: KeyboardEvent) => {
      if (!isSpace(e) || onControl(e.target)) return
      e.preventDefault()
      if (!e.repeat) handlers.current.press()
    }
    const up = (e: KeyboardEvent) => {
      if (!isSpace(e) || onControl(e.target)) return
      e.preventDefault()
      handlers.current.release()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

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

  const toggleMenu = (m: Menu) => setMenu(menuRef.current === m ? null : m)

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

  const menuLocked = phase === 'charging' || phase === 'waiting' || phase === 'bite' || phase === 'fighting'
  const hint = menu ? null : HINTS[phase]

  return (
    <section className="fish">
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
              handlers.current.press()
            }}
            onPointerUp={() => handlers.current.release()}
            onPointerCancel={() => handlers.current.release()}
          />
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
          {hint && !outcome && <p className="fish-hint">{hint}</p>}
          {menu && (
            <div className="fish-panel">
              <div className="fish-panel-head">
                <h3 className="fish-panel-title">{menu === 'bag' ? '가방' : menu === 'shop' ? '상점' : '도감'}</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMenu(null)}>
                  닫기
                </button>
              </div>
              {menu === 'bag' && <BagPanel view={view} />}
              {menu === 'shop' && (
                <ShopPanel view={view} busy={busy} onSell={() => void sell()} onBuy={(t) => void buyRod(t)} />
              )}
              {menu === 'dex' && <DexPanel view={view} />}
            </div>
          )}
        </div>
      </div>

      {notice?.kind === 'bag_full' && (
        <div className="notice fish-notice" role="alert">
          <span>가방이 가득 찼어요. 상점에서 팔아 주세요</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setMenu('shop')}>
            상점 열기
          </button>
        </div>
      )}
      {notice?.kind === 'error' && <p className="notice" role="alert">{notice.text}</p>}
      {notice?.kind === 'info' && <p className="fish-info">{notice.text}</p>}

      <div className="fish-bottom" ref={bottomRef}>
        <span className="fish-bag-count">
          가방 <strong>{view.bag.length}/{BAG_SIZE}</strong>
        </span>
        <div className="fish-menu">
          {(['bag', 'shop', 'dex'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn btn-sm ${menu === m ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={menu === m}
              disabled={menuLocked}
              onClick={() => toggleMenu(m)}
            >
              {m === 'bag' ? '가방' : m === 'shop' ? '상점' : '도감'}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
