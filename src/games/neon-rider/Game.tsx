// 네온 라이더 화면. 플랫폼 상태(publicState.sim)로 로컬 시뮬을 시작해 매 프레임 같은 step으로 진행하고,
// 입력(누름 1비트)은 30틱씩 묶어 onAction으로 보낸다 (설계 §4.2, §7). 점수·"+N"·보석·팝업은 캔버스 안에서 그려진다.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { GameProps } from '../ui.ts'
import { SEND_TICKS, TICK_HZ } from './constants.ts'
import { getCourse } from './course.ts'
import { encodeHold } from './input.ts'
import type { State } from './logic.ts'
import { createRenderer, type Renderer } from './render.ts'
import { scoreOf, step, type SimState } from './sim.ts'
import './neon-rider.css'

// 화면 쪽 값(시뮬 규칙이 아니다). 프레임당 최대 틱 수와, 사망 뒤 입자가 끝날 때까지 그리는 시간.
const MAX_CATCHUP = 5
const DEATH_RENDER_MS = 3000
const EPS = 1e-6

/** 루프가 화면 이벤트에서 부르는 조작. */
type Engine = {
  pointerDown(id: number): boolean
  pointerUp(id: number): void
  releaseAll(): void
  setPaused(paused: boolean): void
}

function sameSim(a: SimState, b: SimState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const DEATH_TEXT: Record<'crash' | 'fall' | 'give_up', string> = {
  crash: '넘어졌어요',
  fall: '떨어졌어요',
  give_up: '포기했어요',
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

    const held = () => pointers.size > 0 || space
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
    }

    function measure() {
      const r = canvas.getBoundingClientRect()
      renderer.resize(r.width, r.height, window.devicePixelRatio || 1)
    }

    function tickOnce() {
      const h = held()
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
      if (deathAt !== null && t - deathAt > DEATH_RENDER_MS) return
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
      start()
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (isTypingTarget(e.target)) return
      space = false
    }

    engine.current = {
      pointerDown(id) {
        if (!live()) return false
        pointers.add(id)
        start()
        return true
      },
      pointerUp(id) {
        pointers.delete(id)
      },
      releaseAll,
      setPaused,
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
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          onPointerLeave={onLeave}
        />
        {active && (
          <button
            type="button"
            className="nr-pause"
            aria-label="일시정지"
            aria-pressed={paused}
            onClick={() => engine.current?.setPaused(!paused)}
          >
            <span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>
          </button>
        )}
        {!started && !dead && !finished && <p className="nr-hint">눌러서 시작</p>}
        {active && paused && (
          <button type="button" className="nr-overlay" onClick={() => engine.current?.setPaused(false)}>
            계속하려면 누르기
          </button>
        )}
        {finished && <Result score={finalScore ?? scoreOf(ps.sim)} reason={ps.sim.dead} />}
      </div>
      {error && <p className="nr-error" role="alert">{error}</p>}
    </section>
  )
}
