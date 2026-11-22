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
const MIN_SCALE = 2

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
  const [scale, setScale] = useState(MIN_SCALE)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
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
    if (!SILENT_CODES.has(code)) setNotice({ kind: 'error', text: errorMessage(code) })
    try {
      await send({ game: gameId, action: 'load' })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: errorMessage(codeOf(e)) })
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
      setNotice(code === 'bag_full' ? { kind: 'bag_full' } : { kind: 'error', text: errorMessage(code) })
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
    })
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

  // 캔버스 배율: 너비에 맞는 가장 큰 정수 배(최소 2)
  useEffect(() => {
    const el = stageRef.current
    if (!loaded || !el) return
    const measure = () => setScale(Math.max(MIN_SCALE, Math.floor(el.clientWidth / SCENE_W)))
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
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
      if (alive.current) setNotice({ kind: 'error', text: errorMessage(codeOf(e)) })
    }
  }

  async function buyRod(tier: number) {
    setNotice(null)
    try {
      await act({ type: 'buyRod', tier })
    } catch (e) {
      if (alive.current) setNotice({ kind: 'error', text: errorMessage(codeOf(e)) })
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
        <div className="fish-frame" style={{ width: SCENE_W * scale, height: SCENE_H * scale }}>
          <canvas
            ref={canvasRef}
            className="fish-canvas"
            aria-label="낚시터"
            width={SCENE_W}
            height={SCENE_H}
            style={{ width: SCENE_W * scale, height: SCENE_H * scale }}
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

      <div className="fish-bottom">
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
