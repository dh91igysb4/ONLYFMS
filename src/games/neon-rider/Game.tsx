// 네온 라이더 화면. 플랫폼 상태(publicState.sim)로 로컬 시뮬을 시작해 매 프레임 같은 step으로 진행하고,
// 입력(누름 1비트)은 30틱씩 묶어 onAction으로 보낸다 (설계 §4.2, §7). 점수·"+N"·보석·팝업은 캔버스 안에서 그려진다.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { GameProps } from '../ui.ts'
import { DEATH_RENDER_MS, MAX_CATCHUP, SEND_TICKS, TICK_HZ } from './constants.ts'
import { getCourse } from './course.ts'
import { encodeHold } from './input.ts'
import type { State } from './logic.ts'
import { createRenderer, type Renderer } from './render.ts'
import { scoreOf, step, type SimState } from './sim.ts'
import './neon-rider.css'

// 누산기 비교의 부동소수 여유(정수 상수만 두는 constants.ts에 넣을 수 없는 화면 쪽 값).
const EPS = 1e-6

/** 루프가 화면 이벤트에서 부르는 조작. */
type Engine = {
  pointerDown(id: number): boolean
  pointerUp(id: number): void
  pointerCancel(id: number): void
  releaseAll(): void
  setPaused(paused: boolean): void
  giveUp(): void
}

function sameSim(a: SimState, b: SimState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const DEATH_TEXT: Record<'crash' | 'fall' | 'give_up', string> = {
  crash: '넘어졌어요',
  fall: '떨어졌어요',
  give_up: '포기했어요',
}

// 플랫폼이 넘겨주는 오류 코드(logic.apply의 error)를 화면 문구로. 모르는 코드도 원문 대신 한국어로 보여 준다.
const ERROR_TEXT: Record<string, string> = {
  invalid_input: '입력을 처리하지 못했어요',
  finished: '이미 끝난 판이에요',
}
function errorText(code: string): string {
  return ERROR_TEXT[code] ?? '문제가 생겼어요. 다시 시도해 주세요'
}

// 마우스로 누른 버튼이 초점을 가져가면 그 뒤의 스페이스가 차를 누르지 않고 버튼을 누른다. 마우스 누름의 초점 이동을 막는다.
function keepFocus(e: { preventDefault(): void }) {
  e.preventDefault()
}

function Result({ score, reason }: { score: number; reason: SimState['dead'] }) {
  return (
    <div className="nr-result" role="status">
      <h2>게임 끝</h2>
      <p className="nr-result-score">{Math.floor(score)}점</p>
      {reason !== null && <p className="nr-result-reason">{DEATH_TEXT[reason]}</p>}
    </div>
  )
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

export function Game({ publicState, finished, score: finalScore, error, onAction }: GameProps) {
  const ps = publicState as State
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engine = useRef<Engine | null>(null)
  const latest = useRef({ ps, finished, onAction })
  latest.current = { ps, finished, onAction }
  // 개발 모드 비교용: 보낸 묶음 끝 틱의 로컬 상태
  const history = useRef(new Map<number, SimState>())

  const [started, setStarted] = useState(false)
  const [paused, setPausedUi] = useState(false)
  const [dead, setDead] = useState(ps.sim.dead !== null)

  useEffect(() => {
    let cancelled = false
    let raf = 0
    let stopped = false // 사망 뒤 입자를 다 그리고 프레임 루프가 멈췄다
    const canvas = canvasRef.current!
    const { seed } = latest.current.ps
    const course = getCourse(seed)
    const renderer: Renderer = createRenderer(canvas)

    let cur: SimState = latest.current.ps.sim
    let prev: SimState = cur
    let pending: boolean[] = []
    let acc = 0
    let last = 0
    let isStarted = false
    let isPaused = false
    let isHidden = document.visibilityState === 'hidden'
    let deathAt: number | null = cur.dead !== null ? performance.now() : null
    const pointers = new Set<number>()
    let space = false
    // 누른 뒤 아직 어느 틱에도 반영되지 않았다. 한 프레임 안에 눌렀다 뗀 짧은 탭도 한 틱은 누름으로 센다.
    let tapLatched = false

    const held = () => pointers.size > 0 || space || tapLatched
    const running = () => isStarted && !isPaused && !isHidden && cur.dead === null && !latest.current.finished

    function flush() {
      if (pending.length === 0) return
      const d = encodeHold(pending)
      pending = []
      if (import.meta.env.DEV) {
        history.current.set(cur.tick, cur)
        if (history.current.size > 8) history.current.delete(history.current.keys().next().value!)
      }
      latest.current.onAction({ type: 'i', d })
    }

    function releaseAll() {
      pointers.clear()
      space = false
      tapLatched = false
    }

    function measure() {
      const r = canvas.getBoundingClientRect()
      renderer.resize(r.width, r.height, window.devicePixelRatio || 1)
      // 크기를 바꾸면 캔버스가 지워진다. 루프가 멈춘 뒤(사망 화면)에는 한 번 다시 그린다.
      if (stopped && !cancelled) renderer.render(prev, cur, 1, course, performance.now())
    }

    function tickOnce() {
      const h = held()
      tapLatched = false
      prev = cur
      cur = step(cur, h, course)
      pending.push(h)
      if (cur.dead !== null) {
        flush()
        setDead(true)
      } else if (pending.length >= SEND_TICKS) {
        flush()
      }
    }

    function loop() {
      raf = 0
      if (cancelled) return
      const t = performance.now()
      if (running()) {
        acc += (Math.max(0, Math.min(t - last, (MAX_CATCHUP * 1000) / TICK_HZ)) * TICK_HZ) / 1000
        let n = 0
        while (acc >= 1 - EPS && n < MAX_CATCHUP && running()) {
          tickOnce()
          acc -= 1
          n++
        }
        if (acc < 0) acc = 0
      }
      last = t
      if ((cur.dead !== null || latest.current.finished) && deathAt === null) deathAt = t
      renderer.render(prev, cur, cur.dead === null ? Math.min(1, acc) : 1, course, t)
      if (deathAt !== null && t - deathAt > DEATH_RENDER_MS) {
        stopped = true
        return
      }
      raf = requestAnimationFrame(loop)
    }

    const live = () => cur.dead === null && !latest.current.finished && !isPaused && !isHidden

    function start() {
      if (isStarted) return
      isStarted = true
      last = performance.now()
      acc = 0
      setStarted(true)
    }

    function setPaused(p: boolean) {
      if (p === isPaused || !isStarted || cur.dead !== null) return
      isPaused = p
      if (p) {
        flush()
        releaseAll()
      } else {
        last = performance.now()
        acc = 0
      }
      setPausedUi(p)
    }

    function onVisibility() {
      const hidden = document.visibilityState === 'hidden'
      if (hidden === isHidden) return
      isHidden = hidden
      releaseAll() // 숨는 동안 놓은 손은 pointerup을 못 받는다
      if (hidden) flush()
      else {
        last = performance.now()
        acc = 0
      }
    }

    function onBlur() {
      releaseAll()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (isTypingTarget(e.target)) return
      if (live()) e.preventDefault()
      if (e.repeat || !live()) return
      space = true
      tapLatched = true
      start()
    }
    // 뗌은 어디서 받든 뗌이다(누른 채 입력칸으로 초점이 옮겨 가도 계속 누른 것으로 남지 않게).
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return
      space = false
    }

    engine.current = {
      pointerDown(id) {
        if (!live()) return false
        pointers.add(id)
        tapLatched = true
        start()
        return true
      },
      pointerUp(id) {
        pointers.delete(id)
      },
      // 브라우저가 취소한 누름(스크롤 제스처 등)은 탭으로 세지 않는다.
      pointerCancel(id) {
        pointers.delete(id)
        if (pointers.size === 0) tapLatched = false
      },
      releaseAll,
      setPaused,
      giveUp() {
        if (latest.current.finished || cur.dead !== null) return
        flush()
        latest.current.onAction({ type: 'give_up' })
      },
    }

    measure() // 첫 render 전에 크기를 맞춘다
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    raf = requestAnimationFrame(loop)

    return () => {
      cancelled = true
      engine.current = null
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      renderer.dispose()
    }
  }, [])

  // 개발 모드: 플랫폼이 같은 틱까지 진행한 상태가 로컬과 다르면 알린다 (설계 §4.2).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const local = history.current.get(ps.sim.tick)
    if (local && !sameSim(local, ps.sim)) {
      console.warn('[neon-rider] 로컬 시뮬과 플랫폼 상태가 다릅니다', { tick: ps.sim.tick, local, platform: ps.sim })
    }
  }, [ps.sim])

  function onDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (engine.current?.pointerDown(e.pointerId)) e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    engine.current?.pointerUp(e.pointerId)
  }
  function onCancel(e: ReactPointerEvent<HTMLCanvasElement>) {
    engine.current?.pointerCancel(e.pointerId)
  }
  function onLeave() {
    engine.current?.releaseAll()
  }

  const active = started && !dead && !finished
  return (
    <section className="nr">
      <div className="nr-stage">
        <canvas
          ref={canvasRef}
          className="nr-canvas"
          aria-label="네온 라이더 화면"
          role="img"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onLostPointerCapture={onUp}
          onPointerLeave={onLeave}
        />
        {active && (
          <button
            type="button"
            className="nr-pause"
            aria-label="일시정지"
            aria-pressed={paused}
            onMouseDown={keepFocus}
            onClick={() => engine.current?.setPaused(!paused)}
          >
            <span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>
          </button>
        )}
        {!started && !dead && !finished && <p className="nr-hint">눌러서 시작</p>}
        {active && paused && (
          <>
            <button type="button" className="nr-overlay" onMouseDown={keepFocus} onClick={() => engine.current?.setPaused(false)}>
              계속하려면 누르기
            </button>
            <button type="button" className="nr-giveup" onMouseDown={keepFocus} onClick={() => engine.current?.giveUp()}>
              포기
            </button>
          </>
        )}
        {finished && <Result score={finalScore ?? scoreOf(ps.sim)} reason={ps.sim.dead} />}
      </div>
      {error && <p className="nr-error" role="alert">{errorText(error)}</p>}
    </section>
  )
}
