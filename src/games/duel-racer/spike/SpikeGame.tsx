// 0단계 시험판 화면(버리는 코드). /duel/practice/duel-racer?spike 로 연다.
// 내 차 + 나를 들이받는 봇. 지연(RTT) 버튼으로 어긋남을 느껴 본다. 파란 차는 '내 화면에 보이는' 봇(지연·외삽된 위치)이다.
import { useEffect, useRef, useState } from 'react'
import { GAME_KEYS, controlsFrom } from '../input.ts'
import type { Scene3D } from '../render/scene.ts'
import type { SpikeDuel } from './duel.ts'
import '../racer.css'

const RTTS = [0, 50, 100, 200]

export function SpikeGame({ onExit }: { onExit(): void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const keys = useRef(new Set<string>())
  const airKeys = useRef(new Set<string>())
  const airborneRef = useRef(false)
  const duelRef = useRef<SpikeDuel | null>(null)
  const [rtt, setRtt] = useState(0)
  const [hud, setHud] = useState({ speed: 0, me: 0, bot: 0, one: 0, err: '' })
  const [round, setRound] = useState(0)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape') return onExit()
      if (GAME_KEYS.has(e.code)) {
        e.preventDefault()
        if (!e.repeat && airborneRef.current) airKeys.current.add(e.code)
        keys.current.add(e.code)
      }
    }
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.code)
      airKeys.current.delete(e.code)
    }
    const clear = () => {
      keys.current.clear()
      airKeys.current.clear()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [onExit])

  useEffect(() => {
    if (duelRef.current) duelRef.current.rttMs = rtt
  }, [rtt])

  useEffect(() => {
    let alive = true
    let raf = 0
    let scene: Scene3D | null = null
    let lastT: number | null = null
    let lastHud = 0
    ;(async () => {
      try {
        const [sp, sc, rp, rc] = await Promise.all([import('./duel.ts'), import('../render/scene.ts'), import('../physics/rapier.ts'), import('../race.ts')])
        const R = await rp.loadRapier()
        if (!alive || !canvasRef.current) return
        const d = sp.createSpike(R)
        d.rttMs = rtt
        duelRef.current = d
        scene = sc.createScene(canvasRef.current, d.me.race.course)
        const c = canvasRef.current
        scene.resize(c.clientWidth || 960, c.clientHeight || 540, window.devicePixelRatio || 1)
        const loop = (t: number) => {
          if (!alive) return
          const ms = lastT === null ? 0 : Math.min(250, t - lastT)
          lastT = t
          const airborne = !rc.snapshot(d.me.race).car.grounded
          if (!airborne) airKeys.current.clear()
          airborneRef.current = airborne
          sp.stepSpike(d, ms, controlsFrom(keys.current, airborne, airKeys.current))
          const snap = rc.snapshot(d.me.race)
          // 경주는 한 틱씩 돌리므로 틱 사이 비율은 d.acc에 있다(race.acc는 늘 0)
          const a = d.acc
          const gp = d.me.ghostPos
          const gq = d.me.ghostPrev ?? gp
          const g = d.me.latest && gp && gq
            ? { pos: { x: gq.x + (gp.x - gq.x) * a, y: gq.y + (gp.y - gq.y) * a, z: gq.z + (gp.z - gq.z) * a }, quat: d.me.latest.quat }
            : null
          scene?.setGhost(g)
          scene?.draw(snap, a)
          if (t - lastHud > 150) {
            lastHud = t
            setHud({ speed: Math.round(Math.abs(snap.car.speed) * 3.6), me: d.hits.me, bot: d.hits.bot, one: d.hits.mismatched, err: '' })
          }
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
      } catch (e) {
        if (alive) setHud((h) => ({ ...h, err: String(e) }))
      }
    })()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      scene?.dispose()
      const d = duelRef.current
      duelRef.current = null
      if (d) {
        d.me.race.pw.world.free()
        d.bot.race.pw.world.free()
      }
    }
    // rtt는 위 effect가 반영한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  return (
    <div className="dr">
      <div className="dr-stage">
        <canvas ref={canvasRef} className="dr-canvas" aria-label="시험판 레이스 화면" />
        <p className="dr-time">시험판 · 봇이 들이받으러 와요</p>
        <div className="dr-meter">
          <p className="dr-speed"><span>{hud.speed}</span><small>km/h</small></p>
        </div>
        {hud.err && <p className="dr-overlay" role="alert">{hud.err}</p>}
      </div>
      <div className="dr-help" style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
        <span>지연(RTT)</span>
        {RTTS.map((r) => (
          <button key={r} type="button" className={r === rtt ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setRtt(r)}>{r}ms</button>
        ))}
        <span>내 화면 충돌 {hud.me} · 봇 화면 충돌 {hud.bot} · 한쪽만 느낀 충돌 {hud.one}</span>
        <button type="button" className="btn btn-ghost" onClick={() => setRound((n) => n + 1)}>다시</button>
        <button type="button" className="btn btn-ghost" onClick={onExit}>나가기</button>
      </div>
    </div>
  )
}
