// 볼 런 화면. 플랫폼 상태(publicState.sim)로 로컬 시뮬을 시작해 매 프레임 같은 step으로 진행하고,
// 입력은 30틱씩 묶어 onAction으로 보낸다 (설계 §2.2, §3.3, §3.7, §6).
// Three.js 장면(render/scene.ts)은 동적 import로 따로 받는다 — three가 별도 청크가 되게.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { GameProps } from '../ui.ts'
import { KEY_STEP, MAX_CATCHUP, SEND_TICKS, TICK_HZ } from './constants.ts'
import { getCourse } from './course.ts'
import { clampX, dragTarget, encodeInputs } from './input.ts'
import { logic, type PublicState } from './logic.ts'
import { step, type SimState } from './sim.ts'
import type { SceneHandle } from './render/scene.ts'
import './ball-run.css'

const BANNER_MS = 1200
// 사망 뒤에도 장면의 연출(hit 깨짐 조각이 흩어져 바닥에 내려앉음, fall 낙하)을 그리는 시간. 그 뒤 rAF를 멈춘다.
const DEATH_RENDER_MS = 3000
const EPS = 1e-6

type Phase = 'loading' | 'ready' | 'no-webgl' | 'load-failed'

/** 루프가 화면 이벤트에서 부르는 조작. 장면이 준비되기 전에는 null. */
type Engine = {
  pointerDown(id: number, clientX: number): boolean
  pointerMove(id: number, clientX: number): void
  pointerUp(id: number): void
  setPaused(paused: boolean): void
}

const ctx = { now: 0, startedAt: 0, deadline: null }
const scoreOf = (seed: string, sim: SimState): number => logic.score({ seed, sim }, ctx)

// 장면 모듈은 한 번만 받는다(StrictMode의 두 번째 마운트도 같은 요청을 쓴다). 실패하면 다음 마운트에서 다시 시도한다.
let scenePromise: Promise<typeof import('./render/scene.ts')> | null = null
function loadScene(): Promise<typeof import('./render/scene.ts')> {
  scenePromise ??= import('./render/scene.ts').catch((e: unknown) => {
    scenePromise = null
    throw e
  })
  return scenePromise
}

function sameSim(a: SimState, b: SimState): boolean {
  return (Object.keys(a) as (keyof SimState)[]).every((k) => a[k] === b[k])
}

const DEATH_TEXT: Record<'hit' | 'fall' | 'give_up', string> = {
  hit: '장애물에 부딪혔어요',
  fall: '떨어졌어요',
  give_up: '포기했어요',
}

/** 끝난 판의 결과. 캔버스 위에 반투명으로 얹어 사망 연출이 비친다. */
function Result({ score, reason }: { score: number; reason: SimState['dead'] }) {
  return (
    <div className="br-result" role="status">
      <h2>게임 끝</h2>
      <p className="br-result-score">{Math.floor(score)}점</p>
      {reason !== null && <p className="br-result-reason">{DEATH_TEXT[reason]}</p>}
    </div>
  )
}

export function Game({ publicState, finished, score: finalScore, error, onAction }: GameProps) {
  const ps = publicState as PublicState
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engine = useRef<Engine | null>(null)
  const latest = useRef({ ps, finished, onAction })
  latest.current = { ps, finished, onAction }
  // 개발 모드 비교용: 보낸 묶음 끝 틱의 로컬 상태
  const history = useRef(new Map<number, SimState>())

  const [phase, setPhase] = useState<Phase>('loading')
  const [started, setStarted] = useState(false)
  const [paused, setPausedUi] = useState(false)
  const [dead, setDead] = useState(ps.sim.dead !== null)
  const [score, setScore] = useState(() => scoreOf(ps.seed, ps.sim))
  const [banner, setBanner] = useState(0) // 0이면 숨김, 아니면 다시 띄울 때마다 바뀌는 key

  useEffect(() => {
    let cancelled = false
    let scene: SceneHandle | null = null
    let raf = 0
    let bannerTimer: ReturnType<typeof setTimeout> | undefined
    const canvas = canvasRef.current!
    const { seed } = latest.current.ps
    const course = getCourse(seed)

    let cur: SimState = latest.current.ps.sim
    let prev: SimState = cur
    let target = clampX(cur.x - cur.drift) // 실효 목표 = target + drift(기운 판). 이어 하기에서 공을 제자리에 둔다.
    let pending: number[] = []
    let acc = 0
    let last = 0
    let isStarted = false
    let isPaused = false
    let isHidden = document.visibilityState === 'hidden'
    let deathAt: number | null = cur.dead !== null ? performance.now() : null
    let width = 0
    let pointerId: number | null = null
    let dragStartTarget = 0
    let dragStartX = 0
    let lastClientX = 0
    let keyLeft = false
    let keyRight = false
    let shownScore = scoreOf(seed, cur)

    const running = () => isStarted && !isPaused && !isHidden && cur.dead === null && !latest.current.finished

    function flush() {
      if (pending.length === 0) return
      const d = encodeInputs(pending)
      pending = []
      if (import.meta.env.DEV) {
        history.current.set(cur.tick, cur)
        if (history.current.size > 8) history.current.delete(history.current.keys().next().value!)
      }
      latest.current.onAction({ type: 'i', d })
    }

    function measure() {
      const r = canvas.getBoundingClientRect()
      width = r.width
      scene?.resize(r.width, r.height, window.devicePixelRatio || 1)
    }

    function tickOnce() {
      const dir = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0)
      if (dir !== 0) {
        target = clampX(target + dir * KEY_STEP)
        // 드래그 중이면 키로 옮긴 곳을 새 기준으로 삼는다
        dragStartTarget = target
        dragStartX = lastClientX
      }
      prev = cur
      cur = step(cur, target, course)
      pending.push(target)
      if (cur.speedLevel > prev.speedLevel) {
        setBanner((b) => b + 1)
        clearTimeout(bannerTimer)
        bannerTimer = setTimeout(() => setBanner(0), BANNER_MS)
      }
      if (cur.dead !== null) {
        flush()
        setDead(true)
      } else if (pending.length >= SEND_TICKS) {
        flush()
      }
    }

    function loop() {
      raf = 0
      if (cancelled || !scene) return
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
        const s = scoreOf(seed, cur)
        if (s !== shownScore) {
          shownScore = s
          setScore(s)
        }
      }
      last = t
      if ((cur.dead !== null || latest.current.finished) && deathAt === null) deathAt = t
      scene.render(prev, cur, cur.dead === null ? Math.min(1, acc) : 1)
      if (deathAt !== null && t - deathAt > DEATH_RENDER_MS) return
      raf = requestAnimationFrame(loop)
    }

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
      if (p) flush()
      else {
        last = performance.now()
        acc = 0
      }
      setPausedUi(p)
    }

    function onVisibility() {
      const hidden = document.visibilityState === 'hidden'
      if (hidden === isHidden) return
      isHidden = hidden
      if (hidden) {
        flush()
        setPaused(true) // 돌아왔을 때 바로 이어 달리지 않게 멈춰 둔다
      } else {
        last = performance.now()
        acc = 0
      }
    }

    function onBlur() {
      // 키를 누른 채 창이 포커스를 잃으면 keyup을 못 받는다
      keyLeft = false
      keyRight = false
      setPaused(true)
    }

    const live = () => !!scene && cur.dead === null && !latest.current.finished && !isPaused

    function onKey(e: KeyboardEvent, down: boolean) {
      const k = e.key
      const left = k === 'ArrowLeft' || k === 'a' || k === 'A'
      const right = k === 'ArrowRight' || k === 'd' || k === 'D'
      if (!left && !right) return
      if (left) keyLeft = down
      if (right) keyRight = down
      if (!down || !live()) return
      if (k.startsWith('Arrow')) e.preventDefault()
      start()
    }
    const onKeyDown = (e: KeyboardEvent) => onKey(e, true)
    const onKeyUp = (e: KeyboardEvent) => onKey(e, false)

    engine.current = {
      pointerDown(id, clientX) {
        if (!live() || pointerId !== null) return false
        pointerId = id
        dragStartTarget = target
        dragStartX = clientX
        lastClientX = clientX
        start()
        return true
      },
      pointerMove(id, clientX) {
        if (id !== pointerId || cur.dead !== null) return
        lastClientX = clientX
        target = dragTarget(dragStartTarget, clientX - dragStartX, width)
      },
      pointerUp(id) {
        if (id === pointerId) pointerId = null
      },
      setPaused,
    }

    loadScene().then(
      (mod) => {
        if (cancelled) return
        try {
          scene = mod.createScene(canvas, course)
        } catch {
          engine.current = null
          setPhase('no-webgl')
          return
        }
        measure() // 첫 render 전에 카메라 비율을 맞춘다
        window.addEventListener('resize', measure)
        document.addEventListener('visibilitychange', onVisibility)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        window.addEventListener('blur', onBlur)
        setPhase('ready')
        raf = requestAnimationFrame(loop)
      },
      () => {
        if (cancelled) return
        engine.current = null
        setPhase('load-failed')
      },
    )

    return () => {
      cancelled = true
      engine.current = null
      if (raf) cancelAnimationFrame(raf)
      clearTimeout(bannerTimer)
      window.removeEventListener('resize', measure)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      // 같은 캔버스로 다시 마운트될 수 있어(StrictMode) WebGL 컨텍스트는 강제로 잃게 하지 않는다.
      scene?.dispose()
      scene = null
    }
  }, [])

  // 개발 모드: 플랫폼이 같은 틱까지 진행한 상태가 로컬과 다르면 알린다 (설계 §2.2).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const local = history.current.get(ps.sim.tick)
    if (local && !sameSim(local, ps.sim)) {
      console.warn('[ball-run] 로컬 시뮬과 플랫폼 상태가 다릅니다', { tick: ps.sim.tick, local, platform: ps.sim })
    }
  }, [ps.sim])

  function onDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (engine.current?.pointerDown(e.pointerId, e.clientX)) e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    engine.current?.pointerMove(e.pointerId, e.clientX)
  }
  function onEnd(e: ReactPointerEvent<HTMLCanvasElement>) {
    engine.current?.pointerUp(e.pointerId)
  }

  if (phase === 'no-webgl') {
    return (
      <section className="br br-fallback">
        {finished ? (
          <Result score={finalScore ?? score} reason={ps.sim.dead} />
        ) : (
          <>
            <p>이 기기에서는 3D 화면을 지원하지 않아요</p>
            <button type="button" className="btn" onClick={() => onAction({ type: 'give_up' })}>포기</button>
          </>
        )}
        {error && <p className="br-error" role="alert">{error}</p>}
      </section>
    )
  }
  if (phase === 'load-failed') {
    return (
      <section className="br br-fallback">
        <p role="alert">게임을 불러오지 못했어요. 새로고침해 주세요.</p>
      </section>
    )
  }

  const active = phase === 'ready' && started && !dead && !finished
  return (
    <section className="br">
      <div className="br-stage">
        <canvas
          ref={canvasRef}
          className="br-canvas"
          aria-label="볼 런 화면"
          role="img"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onEnd}
          onLostPointerCapture={onEnd}
        />
        <div className="br-hud">
          <output className="br-score" aria-label="점수" aria-live="off">{score}</output>
          {active && (
            <button
              type="button"
              className="br-pause"
              aria-label="일시정지"
              aria-pressed={paused}
              onClick={() => engine.current?.setPaused(!paused)}
            >
              <span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>
            </button>
          )}
        </div>
        {phase === 'loading' && <p className="br-hint">불러오는 중…</p>}
        {phase === 'ready' && !started && !dead && !finished && <p className="br-hint">화면을 눌러 시작</p>}
        {active && paused && (
          <button type="button" className="br-overlay" onClick={() => engine.current?.setPaused(false)}>
            계속하려면 누르기
          </button>
        )}
        {finished && <Result score={finalScore ?? score} reason={ps.sim.dead} />}
        {banner > 0 && !dead && <p key={banner} className="br-banner" aria-live="polite">속도 증가</p>}
      </div>
      {error && <p className="br-error" role="alert">{error}</p>}
    </section>
  )
}
