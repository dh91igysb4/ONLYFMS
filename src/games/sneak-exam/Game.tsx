// 몰래 수능 화면. 플랫폼 상태(publicState.sim)로 로컬 시뮬을 시작해 매 프레임 같은 step으로 진행하고,
// 진행한 틱 수와 명령을 onAction으로 보낸다 (설계 §4.2, §6). 볼 런 화면(ball-run/Game.tsx)과 같은 루프 구조다.
// Three.js 장면(render/scene.ts)은 동적 import로 따로 받는다 — three가 별도 청크가 되게.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { GameProps } from '../ui.ts'
import { BONUS_MAX, MAX_CATCHUP, N_CHOICE, N_Q, PROCTORS, PROG_MAX, SEND_TICKS, SUSP_MAX, SUSP_WATCH, TICK_HZ, TOOLS, TOTAL_TICKS } from './constants.ts'
import { getExam, type Exam } from './exam.ts'
import { scoreOf, correctCount, type Action, type PublicState } from './logic.ts'
import { QUESTIONS } from './questions.ts'
import { applyCmd, canApply, sees, step, type Cmd, type SimState } from './sim.ts'
import { offscreenSide } from './render/view.ts'
import type { SceneHandle } from './render/scene.ts'
import './sneak-exam.css'

const EPS = 1e-6
// 적발 연출(감독관이 다가와 화면을 가림)이 끝난 뒤 결과를 띄운다.
const CAUGHT_RESULT_MS = 800
// 끝난 뒤에도 장면 연출을 그리는 시간. 그 뒤 rAF를 멈춘다.
const END_RENDER_MS = 1500
// 제출 확인이 저절로 풀리는 시간
const CONFIRM_MS = 3000

type Phase = 'loading' | 'ready' | 'no-webgl' | 'load-failed'

/** 루프가 화면 이벤트에서 부르는 조작. 장면이 준비되기 전에는 null. */
type Engine = {
  start(): void
  setPaused(paused: boolean): void
  tool(k: 1 | 2 | 3): void
  question(q: number): void
  mark(choice: number): void
  submit(): void
}

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const

// 시작 화면 도구 표: 한 문제 풀이 시간은 TOOLS에서 계산하고, 위험 설명은 sim.ts의 증가 표를 요약한다.
const TOOL_RISK: Record<1 | 2 | 3, string> = {
  1: '감독관이 가까이서 볼 때만 위험',
  2: '소리라 안 봐도 가까우면 들킨다',
  3: '가장 빠르지만 멀리서도 보면 들킨다',
}
const TOOL_SHORT: Record<1 | 2 | 3, string> = { 1: '안경', 2: '이어폰', 3: '휴대폰' }

// 장면 모듈은 한 번만 받는다. 실패하면 다음 마운트에서 다시 시도한다.
let scenePromise: Promise<typeof import('./render/scene.ts')> | null = null
function loadScene(): Promise<typeof import('./render/scene.ts')> {
  scenePromise ??= import('./render/scene.ts').catch((e: unknown) => {
    scenePromise = null
    throw e
  })
  return scenePromise
}

const sameSim = (a: SimState, b: SimState): boolean => JSON.stringify(a) === JSON.stringify(b)

function clock(tick: number): string {
  const s = Math.ceil(Math.max(0, TOTAL_TICKS - tick) / TICK_HZ)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const seconds = (ticks: number): string => {
  const s = ticks / TICK_HZ
  return Number.isInteger(s) ? `${s}초` : `${s.toFixed(1)}초`
}

/** 마우스·터치로 누른 버튼은 포커스를 놓는다. 그래야 Enter·Space가 전역 키(제출·일시정지)로 간다. */
function releaseFocus(e: ReactMouseEvent<HTMLButtonElement>) {
  if (e.detail > 0) e.currentTarget.blur()
}

function reasonText(sim: SimState): string {
  switch (sim.end) {
    case 'submit': return '제출했어요'
    case 'timeout': return '시간이 끝났어요'
    case 'caught': return `${TOOLS[sim.tool]?.name ?? '커닝'} 적발! 0점 처리`
    case 'give_up': return '포기했어요'
    default: return ''
  }
}

function Result({ sim, exam, score }: { sim: SimState; exam: Exam; score: number }) {
  const correct = correctCount(sim, exam)
  const bonus = sim.end === 'submit' ? Math.floor(((TOTAL_TICKS - sim.tick) * BONUS_MAX) / TOTAL_TICKS) : 0
  return (
    <div className="se-result" role="status">
      <h2 className={sim.end === 'caught' ? 'se-result-reason se-caught' : 'se-result-reason'}>{reasonText(sim)}</h2>
      <p className="se-result-score">{score}점</p>
      <dl className="se-result-stats">
        <div><dt>정답</dt><dd>{`${correct} / ${N_Q}`}</dd></div>
        <div><dt>시간 보너스</dt><dd>{sim.end === 'submit' ? `문제당 +${bonus}점` : '없음'}</dd></div>
      </dl>
      <ol className="se-result-list">
        {exam.answers.map((a, i) => {
          const m = sim.marks[i]
          const ok = m === a
          return (
            <li key={i} data-correct={ok}>
              <span className="se-result-q">{i + 1}번</span>
              <span>내 답 {m < 0 ? '—' : CIRCLED[m]}</span>
              <span>정답 {CIRCLED[a]}</span>
              <span className="se-result-mark" aria-label={ok ? '맞음' : '틀림'}>{ok ? '○' : '✕'}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function EarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="3" y="13" width="5" height="7" rx="2" fill="currentColor" />
      <rect x="16" y="13" width="5" height="7" rx="2" fill="currentColor" />
    </svg>
  )
}

export function Game({ publicState, finished, score: finalScore, error, onAction }: GameProps) {
  const ps = publicState as PublicState
  const exam = getExam(ps.seed)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engine = useRef<Engine | null>(null)
  const latest = useRef({ ps, finished, onAction })
  latest.current = { ps, finished, onAction }
  // 개발 모드 비교용: 보낸 행동 직후의 로컬 상태(틱별)
  const history = useRef(new Map<number, SimState>())
  const endedAtMount = useRef(ps.sim.end !== null || finished)

  const [phase, setPhase] = useState<Phase>('loading')
  const [started, setStarted] = useState(ps.sim.tick > 0)
  const [paused, setPausedUi] = useState(ps.sim.tick > 0)
  const [sim, setSim] = useState<SimState>(ps.sim)
  const [aspect, setAspect] = useState(9 / 16)
  const [confirm, setConfirm] = useState(false)
  const [resultShown, setResultShown] = useState(endedAtMount.current)

  useEffect(() => {
    let cancelled = false
    let scene: SceneHandle | null = null
    let raf = 0
    let confirmTimer: ReturnType<typeof setTimeout> | undefined
    let resultTimer: ReturnType<typeof setTimeout> | undefined
    let observer: ResizeObserver | null = null
    const canvas = canvasRef.current!
    const examL = getExam(latest.current.ps.seed)

    let cur: SimState = latest.current.ps.sim
    let prev: SimState = cur
    let pending = 0
    let acc = 0
    let last = 0
    // 이어 하기(tick > 0)는 시작 화면 없이 일시정지 상태로 연다.
    let isStarted = cur.tick > 0
    let isPaused = cur.tick > 0
    let isHidden = document.visibilityState === 'hidden'
    let isConfirm = false
    let endAt: number | null = cur.end !== null ? performance.now() : null
    let loopStopped = false // 끝난 뒤 연출 시간이 지나 rAF를 멈춘 상태

    const ended = () => cur.end !== null || latest.current.finished
    const running = () => isStarted && !isPaused && !isHidden && !ended()
    const live = () => !!scene && running()

    function remember() {
      if (!import.meta.env.DEV) return
      history.current.set(cur.tick, cur)
      if (history.current.size > 8) history.current.delete(history.current.keys().next().value!)
    }

    function send(c?: Cmd) {
      const a: Action = c ? { type: 's', n: pending, c } : { type: 's', n: pending }
      pending = 0
      if (c) cur = applyCmd(cur, c)
      remember()
      latest.current.onAction(a)
    }

    function flush() {
      if (pending > 0) send()
    }

    function onEnded() {
      setConfirmState(false)
      if (cur.end === 'caught') {
        clearTimeout(resultTimer)
        resultTimer = setTimeout(() => setResultShown(true), CAUGHT_RESULT_MS)
      } else {
        setResultShown(true)
      }
    }

    function command(c: Cmd) {
      if (!live() || !canApply(cur, c)) return
      if (c[0] !== 'x') setConfirmState(false)
      send(c)
      setSim(cur)
      if (cur.end !== null) onEnded()
    }

    function setConfirmState(v: boolean) {
      if (v === isConfirm) return
      isConfirm = v
      clearTimeout(confirmTimer)
      if (v) confirmTimer = setTimeout(() => setConfirmState(false), CONFIRM_MS)
      setConfirm(v)
    }

    function measure() {
      const r = canvas.getBoundingClientRect()
      scene?.resize(r.width, r.height, window.devicePixelRatio || 1)
      if (r.width > 0 && r.height > 0) setAspect(r.width / r.height)
      // 루프가 멈춘 뒤에는 크기가 바뀌어도 그릴 사람이 없어 캔버스가 비므로 한 프레임만 그린다.
      if (scene && loopStopped) scene.render(prev, cur, 1, performance.now())
    }

    function tickOnce() {
      prev = cur
      cur = step(cur, examL)
      pending++
      if (cur.end !== null) {
        flush()
        onEnded()
      } else if (pending >= SEND_TICKS) {
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
        if (n > 0) setSim(cur)
      }
      last = t
      if (ended() && endAt === null) endAt = t
      scene.render(prev, cur, cur.end === null ? Math.min(1, acc) : 1, t)
      if (endAt !== null && t - endAt > END_RENDER_MS) {
        loopStopped = true
        return
      }
      raf = requestAnimationFrame(loop)
    }

    function start() {
      if (isStarted || !scene || ended()) return
      isStarted = true
      last = performance.now()
      acc = 0
      setStarted(true)
    }

    function setPaused(p: boolean) {
      if (p === isPaused || !isStarted || ended()) return
      isPaused = p
      if (p) {
        flush()
        setConfirmState(false)
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
      if (hidden) {
        flush()
        setPaused(true) // 돌아왔을 때 바로 이어 가지 않게 멈춰 둔다
      } else {
        last = performance.now()
        acc = 0
      }
    }

    const onBlur = () => setPaused(true)

    const toolCmd = (k: 1 | 2 | 3): Cmd => (cur.tool === k ? ['t', 0] : ['t', k])
    const markCmd = (choice: number): Cmd => ['m', cur.q, cur.marks[cur.q] === choice ? -1 : choice]

    function submit() {
      if (!live()) return
      if (!isConfirm) setConfirmState(true)
      else command(['x'])
    }

    const KEY_TOOL: Record<string, 1 | 2 | 3> = { Digit1: 1, Digit2: 2, Digit3: 3, Numpad1: 1, Numpad2: 2, Numpad3: 3 }
    const KEY_MARK: Record<string, number> = { KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3, KeyT: 4 }

    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !scene) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target) {
        // 입력 칸에서 치는 글자는 게임 키가 아니다.
        if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
        // 포커스된 버튼·링크의 Enter·Space는 기본 클릭으로 맡긴다.
        if ((e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && ['BUTTON', 'A'].includes(target.tagName)) return
      }
      const code = e.code || e.key
      if (code === 'Space' || e.key === ' ') {
        if (!isStarted || ended()) return
        e.preventDefault()
        setPaused(!isPaused)
        return
      }
      if (!live()) return
      if (code in KEY_TOOL) command(toolCmd(KEY_TOOL[code]))
      else if (code in KEY_MARK) command(markCmd(KEY_MARK[code]))
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (cur.q > 0) command(['q', cur.q - 1]) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (cur.q < N_Q - 1) command(['q', cur.q + 1]) }
      else if (e.key === 'Enter') { e.preventDefault(); submit() }
    }

    engine.current = {
      start,
      setPaused,
      tool: (k) => command(toolCmd(k)),
      question: (q) => command(['q', q]),
      mark: (choice) => command(markCmd(choice)),
      submit,
    }

    loadScene().then(
      (mod) => {
        if (cancelled) return
        try {
          scene = mod.createScene(canvas)
        } catch {
          engine.current = null
          setPhase('no-webgl')
          return
        }
        measure() // 첫 render 전에 카메라 비율을 맞춘다
        window.addEventListener('resize', measure)
        // 문제 문구 길이에 따라 위 패널 높이가 바뀌어 캔버스 크기도 바뀐다.
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(measure)
          observer.observe(canvas)
        }
        document.addEventListener('visibilitychange', onVisibility)
        window.addEventListener('keydown', onKeyDown)
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
      clearTimeout(confirmTimer)
      clearTimeout(resultTimer)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
      // 같은 캔버스로 다시 마운트될 수 있어(StrictMode) WebGL 컨텍스트는 강제로 잃게 하지 않는다.
      scene?.dispose()
      scene = null
    }
  }, [])

  // 개발 모드: 플랫폼이 같은 틱까지 진행한 상태가 로컬과 다르면 알린다.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const local = history.current.get(ps.sim.tick)
    if (local && !sameSim(local, ps.sim)) {
      console.warn('[sneak-exam] 로컬 시뮬과 플랫폼 상태가 다릅니다', { tick: ps.sim.tick, local, platform: ps.sim })
    }
  }, [ps.sim])

  // 플랫폼이 먼저 끝낸 경우(예: 포기)에는 바로 결과를 보여 준다.
  useEffect(() => {
    if (finished && sim.end === null) setResultShown(true)
  }, [finished, sim.end])

  // 결과는 로컬이 끝났으면 로컬 상태로, 아니면(플랫폼이 먼저 끝냄) 플랫폼 상태로 보여 준다.
  const shown = sim.end !== null ? sim : ps.sim
  const ended = sim.end !== null || finished
  const resultScore = finalScore ?? scoreOf(shown, exam)

  if (phase === 'no-webgl') {
    return (
      <section className="se se-fallback">
        {ended ? (
          <Result sim={shown} exam={exam} score={resultScore} />
        ) : (
          <>
            <p>이 기기에서는 3D 화면을 지원하지 않아요</p>
            <button type="button" className="btn" onClick={() => onAction({ type: 'give_up' })}>포기</button>
          </>
        )}
        {error && <p className="se-error" role="alert">{error}</p>}
      </section>
    )
  }
  if (phase === 'load-failed') {
    return (
      <section className="se se-fallback">
        <p role="alert">게임을 불러오지 못했어요. 새로고침해 주세요.</p>
      </section>
    )
  }

  const ready = phase === 'ready'
  const active = ready && started && !paused && !ended
  const question = QUESTIONS.find((x) => x.id === exam.questionIds[sim.q])!
  const solved = sim.prog[sim.q] === PROG_MAX
  const susp = Math.floor((sim.susp * 100) / SUSP_MAX)
  const suspLevel = sim.susp >= 8000 ? 'high' : sim.susp >= SUSP_WATCH ? 'watch' : 'low'
  const prog = Math.floor((sim.prog[sim.q] * 100) / PROG_MAX)
  const side = ready && !ended ? offscreenSide(sim.proctor.x, sim.proctor.z, aspect) : 0
  const stowing = sim.tool !== 0 && sim.stow > 0
  const seeing = side !== 0 && sees(sim.proctor)
  const proctor = PROCTORS[exam.proctorType]

  return (
    <section className="se">
      <div className="se-hud">
        <div
          className="se-susp"
          role="progressbar"
          aria-label="의심도"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={susp}
          data-level={suspLevel}
        >
          <span className="se-susp-label" aria-hidden="true">의심도</span>
          <span className="se-susp-track"><span className="se-susp-fill" style={{ width: `${susp}%` }} /></span>
          <span className="se-susp-num" aria-hidden="true">{susp}%</span>
        </div>
        <span className="se-time" data-testid="se-time" data-low={TOTAL_TICKS - sim.tick <= 15 * TICK_HZ}>{clock(sim.tick)}</span>
        <button
          type="button"
          className="se-icon-btn"
          aria-label="일시정지"
          aria-pressed={paused}
          disabled={!ready || !started || ended}
          onClick={(e) => { releaseFocus(e); engine.current?.setPaused(!paused) }}
        >
          <span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>
        </button>
      </div>

      <div className="se-question">
        <div className="se-qnav">
          <button
            type="button"
            className="se-icon-btn"
            aria-label="이전 문제"
            disabled={!active || sim.q === 0}
            onClick={(e) => { releaseFocus(e); engine.current?.question(sim.q - 1) }}
          >
            <span aria-hidden="true">◀</span>
          </button>
          <span className="se-qnum">{`문제 ${sim.q + 1} / ${N_Q}`}</span>
          <button
            type="button"
            className="se-icon-btn"
            aria-label="다음 문제"
            disabled={!active || sim.q === N_Q - 1}
            onClick={(e) => { releaseFocus(e); engine.current?.question(sim.q + 1) }}
          >
            <span aria-hidden="true">▶</span>
          </button>
        </div>
        <p className="se-qtext">{question.text}</p>
        <ol className="se-choices">
          {question.choices.map((c, i) => {
            const known = solved && exam.answers[sim.q] === i
            return (
              <li key={i} data-known={known || undefined} data-marked={sim.marks[sim.q] === i || undefined}>
                <span aria-hidden="true">{CIRCLED[i]}</span> {c}
                {known && <span className="sr-only"> (정답)</span>}
              </li>
            )
          })}
        </ol>
        <div
          className="se-prog"
          role="progressbar"
          aria-label="풀이 진행"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={prog}
          data-done={solved}
        >
          <span className="se-prog-fill" style={{ width: `${prog}%` }} />
        </div>
      </div>

      <div className="se-stage" data-testid="se-stage" data-glasses={sim.tool === 1 || undefined}>
        <canvas ref={canvasRef} className="se-canvas" aria-label="몰래 수능 교실 화면" role="img" />
        {side !== 0 && (
          <div className="se-edge" data-testid="se-edge" data-side={side < 0 ? 'left' : 'right'} data-seeing={seeing} role="status">
            {side < 0 ? '◀ 감독관' : '감독관 ▶'}
            {seeing && <strong className="se-edge-seeing">보는 중</strong>}
          </div>
        )}
        {sim.tool === 2 && (
          <div className="se-ear" aria-label="이어폰 켜짐" role="img">
            <EarIcon />
          </div>
        )}
        {phase === 'loading' && <p className="se-hint">불러오는 중…</p>}
      </div>

      <div className="se-tools">
        {([1, 2, 3] as const).map((k) => {
          const spec = TOOLS[k]!
          const on = sim.tool === k
          const blocked = (sim.tool !== 0 && !on) || (on && stowing)
          return (
            <button
              key={k}
              type="button"
              className="se-tool"
              aria-label={spec.name}
              aria-pressed={on}
              data-stowing={(on && stowing) || undefined}
              disabled={!active || blocked}
              onClick={(e) => { releaseFocus(e); engine.current?.tool(k) }}
            >
              <span className="se-tool-name" aria-hidden="true">{TOOL_SHORT[k]}</span>
              <span className="se-tool-sub">{on && stowing ? '숨기는 중' : on ? '켜짐' : seconds(PROG_MAX / spec.rate)}</span>
            </button>
          )
        })}
      </div>

      <div className="se-marks">
        {Array.from({ length: N_CHOICE }, (_, i) => (
          <button
            key={i}
            type="button"
            className="se-mark"
            aria-label={`${i + 1}번 마킹`}
            aria-pressed={sim.marks[sim.q] === i}
            disabled={!active}
            onClick={(e) => { releaseFocus(e); engine.current?.mark(i) }}
          >
            {CIRCLED[i]}
          </button>
        ))}
        <button
          type="button"
          className="se-submit"
          data-confirm={confirm || undefined}
          disabled={!active}
          onClick={(e) => { releaseFocus(e); engine.current?.submit() }}
        >
          {confirm ? '정말 제출할까요?' : '제출'}
        </button>
      </div>

      {ready && !started && !ended && (
        <div className="se-overlay se-intro">
          <h2>몰래 수능</h2>
          <ul className="se-rules">
            <li>답을 알 수 없는 8문제, 제한 시간 2분.</li>
            <li>커닝 도구를 켜면 답이 보이지만, 감독관에게 들키면 의심도가 오른다.</li>
            <li>의심도 100%면 적발 0점. 일찍 제출할수록 보너스.</li>
          </ul>
          <table className="se-tool-table">
            <thead>
              <tr><th scope="col">도구</th><th scope="col">한 문제</th><th scope="col">위험</th></tr>
            </thead>
            <tbody>
              {([1, 2, 3] as const).map((k) => (
                <tr key={k}>
                  <th scope="row">{TOOLS[k]!.name}</th>
                  <td>{seconds(PROG_MAX / TOOLS[k]!.rate)}</td>
                  <td>{TOOL_RISK[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="se-proctor">{`오늘의 감독관: ${proctor.name} — ${proctor.hint}`}</p>
          <p className="se-keys">PC: 1·2·3 도구, ←/→ 문제, Q~T 마킹, Enter 제출, Space 일시정지</p>
          <button type="button" className="btn btn-primary se-start" onClick={() => engine.current?.start()}>시작</button>
        </div>
      )}
      {ready && started && paused && !ended && (
        <button type="button" className="se-overlay se-paused" onClick={() => engine.current?.setPaused(false)}>
          계속하려면 누르기
        </button>
      )}
      {ended && resultShown && (
        <div className="se-overlay se-result-wrap">
          <Result sim={shown} exam={exam} score={resultScore} />
        </div>
      )}
      {error && <p className="se-error" role="alert">{error}</p>}
    </section>
  )
}
