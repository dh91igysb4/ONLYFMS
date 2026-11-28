// 레이싱 연습 화면 (레이싱 설계 §5.5, 계획 Task 8). 물리(Rapier)·3D(Three)·레이스 코드는 여기서만 동적으로 불러온다.
// HUD는 스냅숏을 몇 Hz로만 React 상태에 올린다(매 프레임 setState 금지). 차 그리기는 rAF 루프가 직접 한다.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeGameProps } from '../ui.ts'
import { TICK_HZ } from './constants.ts'
import { GAME_KEYS, controlsFrom } from './input.ts'
import type { Race, RaceSnapshot } from './race.ts'
import type { Scene3D } from './render/scene.ts'
import './racer.css'

type RaceMod = typeof import('./race.ts')
const NITRO_CELLS = 5
const HUD_MS = 100
const TOAST_TICKS = 90
const COURSE = 'neon-1'

/** 틱 → mm:ss.cc */
export function formatTicks(ticks: number): string {
  const cs = Math.max(0, Math.round((ticks / TICK_HZ) * 100))
  const m = Math.floor(cs / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

function toastOf(snap: RaceSnapshot): string | null {
  const l = snap.lastLanding
  if (!l || snap.tick - l.tick > TOAST_TICKS) return null
  const parts = [l.flips > 0 ? `${l.flips}회전` : null, l.clean ? '깔끔한 착지' : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function RacerGame({ onExit }: RealtimeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading')
  const [hud, setHud] = useState<RaceSnapshot | null>(null)
  const [best, setBest] = useState<number | null>(null)
  const [round, setRound] = useState(0)
  const keys = useRef(new Set<string>())
  const raceRef = useRef<{ mod: RaceMod; race: Race } | null>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit

  // 키: 게임 키는 기본 동작(스크롤)을 막는다. 포커스를 잃으면 모두 뗀다.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        exitRef.current()
        return
      }
      if (e.code === 'KeyR') {
        const r = raceRef.current
        if (r) r.mod.requestReset(r.race)
        return
      }
      if (GAME_KEYS.has(e.code)) {
        e.preventDefault()
        keys.current.add(e.code)
      }
    }
    const up = (e: KeyboardEvent) => { keys.current.delete(e.code) }
    const release = () => keys.current.clear()
    const vis = () => { if (document.visibilityState === 'hidden') release() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  // 불러오기 → 레이스·장면 만들기 → rAF 루프. round가 바뀌면(다시 달리기) 새로.
  useEffect(() => {
    let alive = true
    let raf = 0
    let scene: Scene3D | null = null
    let lastT: number | null = null
    let lastHud = -Infinity
    let finished = false
    setHud(null)
    ;(async () => {
      let mod: RaceMod
      try {
        const [m, sc, rp] = await Promise.all([import('./race.ts'), import('./render/scene.ts'), import('./physics/rapier.ts')])
        const R = await rp.loadRapier()
        if (!alive) return
        mod = m
        const race = m.createRace(R, COURSE)
        const canvas = canvasRef.current
        if (!canvas) throw new Error('canvas')
        try {
          scene = sc.createScene(canvas, race.course)
        } catch (e) {
          m.disposeRace(race)
          throw e
        }
        raceRef.current = { mod: m, race }
      } catch {
        if (alive) setPhase('error')
        return
      }
      if (!alive) return
      setPhase('ready')
      const fit = () => {
        const c = canvasRef.current
        if (c && scene) scene.resize(c.clientWidth || 960, c.clientHeight || 540, window.devicePixelRatio || 1)
      }
      fit()
      window.addEventListener('resize', fit)
      const loop = (t: number) => {
        if (!alive) return
        const r = raceRef.current
        if (!r) return
        const ms = lastT === null ? 0 : Math.min(250, t - lastT) || 0
        lastT = t
        const pre = mod.snapshot(r.race)
        mod.advance(r.race, ms, controlsFrom(keys.current, !pre.car.grounded))
        const snap = mod.snapshot(r.race)
        scene?.draw(snap, r.race.acc ?? 0)
        if (snap.finishTicks !== null && !finished) {
          finished = true
          setBest((b) => (b === null ? snap.finishTicks : Math.min(b, snap.finishTicks!)))
          setHud(snap)
        } else if (t - lastHud >= HUD_MS) {
          lastHud = t
          setHud(snap)
        }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      cleanupResize = () => window.removeEventListener('resize', fit)
    })()
    let cleanupResize = () => {}
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      cleanupResize()
      const r = raceRef.current
      raceRef.current = null
      if (r) r.mod.disposeRace(r.race)
      scene?.dispose()
    }
  }, [round])

  const again = useCallback(() => {
    keys.current.clear()
    setPhase('loading')
    setRound((n) => n + 1)
  }, [])

  const snap = hud
  const finishedTicks = snap?.finishTicks ?? null
  const toast = snap ? toastOf(snap) : null
  const filled = snap ? Math.floor(snap.nitro.gauge * NITRO_CELLS + 1e-9) : 0

  return (
    <div className="dr">
      <div className="dr-stage">
        <canvas ref={canvasRef} className="dr-canvas" aria-label="레이스 화면" />
        {phase === 'loading' && <p className="dr-overlay" role="status">불러오는 중…</p>}
        {phase === 'error' && (
          <div className="dr-overlay" role="alert">
            <p>이 브라우저에서는 레이스를 열 수 없어요</p>
            <button type="button" className="btn btn-primary" onClick={onExit}>나가기</button>
          </div>
        )}
        {phase === 'ready' && snap && (
          <>
            <div className="dr-progress" aria-label="진행">
              <div className="dr-progress-fill" style={{ height: `${Math.round(snap.progress * 100)}%` }} />
            </div>
            <p className="dr-time" data-testid="racer-time">{formatTicks(Math.max(0, snap.tick))}</p>
            <div className="dr-meter">
              <p className="dr-speed"><span data-testid="racer-speed">{Math.round(Math.abs(Number(snap.car.speed)) * 3.6)}</span><small>km/h</small></p>
              <div className={`dr-nitro${snap.nitro.burning ? ' dr-nitro-burn' : ''}`} aria-label="니트로">
                {Array.from({ length: NITRO_CELLS }, (_, i) => (
                  <span key={i} className={i < filled ? 'on' : ''} data-testid={i < filled ? 'nitro-cell-on' : 'nitro-cell'} />
                ))}
              </div>
            </div>
            {snap.countdown !== null && <p className="dr-countdown" data-testid="racer-countdown">{snap.countdown}</p>}
            {toast && finishedTicks === null && <p className="dr-toast" data-testid="racer-toast">{toast}</p>}
            {finishedTicks !== null && (
              <div className="dr-overlay dr-result" role="status">
                <p className="dr-result-title">완주</p>
                <p className="dr-result-time" data-testid="racer-result-time">{formatTicks(finishedTicks)}</p>
                {best !== null && <p className="dr-result-best">이번 최고 <span data-testid="racer-result-best">{formatTicks(best)}</span></p>}
                <div className="dr-result-actions">
                  <button type="button" className="btn btn-primary" onClick={again}>다시 달리기</button>
                  <button type="button" className="btn btn-ghost" onClick={onExit}>나가기</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <p className="dr-help">방향키·WASD 운전 · Space 드리프트 · Shift 니트로 · 공중에서 방향키·Q·E 회전 · R 복귀 · Esc 나가기</p>
    </div>
  )
}
