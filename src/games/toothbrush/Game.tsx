import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { GameProps } from '../ui.ts'
import { LH, LW, TOTAL_TICKS, ZONE_COUNT, ZONE_LABELS } from './constants.ts'
import { drawZone } from './draw.ts'
import type { PublicState } from './logic.ts'
import { chunk, Sampler } from './sampler.ts'
import './toothbrush.css'

const SEND_MS = 50
const GUM_FLASH_MS = 300

const secondsLeft = (ticks: number): number => Math.ceil(Math.max(0, ticks) / 60)
const gumSeconds = (ticks: number): number => Math.floor(ticks / 60)

export function Game(props: GameProps) {
  const st = props.publicState as PublicState
  if (props.finished) return <Result st={st} score={props.score} />
  return <Play {...props} />
}

function Result({ st, score }: { st: PublicState; score: number | null }) {
  return (
    <section className="tb tb-result">
      <h2>양치 끝</h2>
      <p className="tb-score">{(score ?? 0).toFixed(2)}점</p>
      <ul className="tb-zones-result" aria-label="구역별 청결도">
        {ZONE_LABELS.map((label, z) => (
          <li key={z}><span>{label}</span><b>{st.cleanByZone[z]}%</b></li>
        ))}
      </ul>
      <p className="muted">잇몸 손상 {gumSeconds(st.gumTicks)}초</p>
    </section>
  )
}

function Play({ publicState, onAction, error }: GameProps) {
  const st = publicState as PublicState
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sampler] = useState(() => new Sampler())
  const pointer = useRef<number | null>(null)
  const cursor = useRef<[number, number] | null>(null)
  const dirty = useRef(true)
  const latest = useRef(st)
  const send = useRef(onAction)
  const [touched, setTouched] = useState(false)
  const [gumHot, setGumHot] = useState(false)
  const lastGum = useRef(st.gumTicks)

  latest.current = st
  send.current = onAction

  useEffect(() => {
    dirty.current = true
  }, [st])

  // 빠름 구간(잇몸 손상이 늘어남)이면 게이지를 잠깐 붉게
  useEffect(() => {
    if (st.gumTicks <= lastGum.current) {
      lastGum.current = st.gumTicks
      return
    }
    lastGum.current = st.gumTicks
    setGumHot(true)
    const t = setTimeout(() => setGumHot(false), GUM_FLASH_MS)
    return () => clearTimeout(t)
  }, [st.gumTicks])

  // 샘플링(rAF)·그리기·전송(50ms). 화면이 사라지면(끝나면) 함께 멈춘다.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      sampler.frame(performance.now())
      if (dirty.current) {
        dirty.current = false
        const g = canvasRef.current?.getContext('2d') ?? null
        const s = latest.current
        if (g) drawZone(g, s.zone, s.zones[s.zone], cursor.current)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const timer = setInterval(() => {
      for (const s of chunk(sampler.take())) send.current({ type: 'b', s })
    }, SEND_MS)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
      sampler.take()
    }
  }, [])

  function toLogical(e: ReactPointerEvent<HTMLCanvasElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(LW - 1, Math.max(0, Math.floor(((e.clientX - r.left) * LW) / r.width)))
    const y = Math.min(LH - 1, Math.max(0, Math.floor(((e.clientY - r.top) * LH) / r.height)))
    return [x, y]
  }

  function onDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== null) return
    pointer.current = e.pointerId
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const [x, y] = toLogical(e)
    const first = !sampler.started
    sampler.down(x, y)
    // 시계는 누른 순간부터 간다: 기준 시각을 지금으로 잡는다
    if (first) sampler.frame(performance.now())
    cursor.current = [x, y]
    dirty.current = true
    setTouched(true)
  }

  function onMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== e.pointerId) return
    const [x, y] = toLogical(e)
    sampler.move(x, y)
    cursor.current = [x, y]
    dirty.current = true
  }

  function onEnd(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== e.pointerId) return
    pointer.current = null
    sampler.up()
    cursor.current = null
    dirty.current = true
  }

  const started = st.started
  const timePct = (100 * st.ticksLeft) / TOTAL_TICKS
  const gumPct = Math.min(100, (100 * st.gumTicks) / (60 * 10))

  return (
    <section className="tb">
      <div className="tb-bar" aria-hidden="true"><span style={{ width: `${timePct}%` }} /></div>
      <p className="tb-meta">남은 시간 {secondsLeft(st.ticksLeft)}초</p>
      <div className={'tb-gum' + (gumHot ? ' tb-gum-hot' : '')}>
        <div className="tb-bar tb-bar-gum" aria-hidden="true"><span style={{ width: `${gumPct}%` }} /></div>
        <p className="tb-meta">잇몸 손상 {gumSeconds(st.gumTicks)}초</p>
      </div>
      <div className="tb-stage">
        <canvas
          ref={canvasRef}
          className={'tb-canvas' + (st.cooldown > 0 ? ' tb-dim' : '')}
          width={LW}
          height={LH}
          aria-label="양치 화면"
          role="img"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onEnd}
          onLostPointerCapture={onEnd}
        />
        {!started && !touched && <p className="tb-hint">화면을 눌러 양치를 시작하세요</p>}
      </div>
      <div className="tb-zones">
        {Array.from({ length: ZONE_COUNT }, (_, z) => (
          <button
            key={z}
            type="button"
            className={'tb-zone' + (z === st.zone ? ' tb-zone-on' : '')}
            aria-pressed={z === st.zone}
            disabled={!started}
            onClick={() => { if (z !== st.zone) onAction({ type: 'z', zone: z }) }}
          >
            {ZONE_LABELS[z]} {st.cleanByZone[z]}%
          </button>
        ))}
      </div>
      {error && <p className="tb-error" role="alert">{error}</p>}
    </section>
  )
}
