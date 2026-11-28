// 레이싱 화면: 혼자 연습(설계 §5.5)과 온라인 대국(설계 §6). 물리(Rapier)·3D(Three)·레이스 코드는 여기서만 동적으로 불러온다.
// HUD는 스냅숏을 몇 Hz로만 React 상태에 올린다(매 프레임 setState 금지). 차 그리기는 rAF 루프가 직접 한다.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { RealtimeGameProps, RealtimeResult } from '../ui.ts'
import { TICK_HZ } from './constants.ts'
import { GAME_KEYS, controlsFrom } from './input.ts'
import type { MatchSession, MatchView } from './match.ts'
import type { Race, RaceSnapshot } from './race.ts'
import type { Scene3D } from './render/scene.ts'
import './racer.css'

type RaceMod = typeof import('./race.ts')
type MatchMod = typeof import('./match.ts')
type MatchProps = Extract<RealtimeGameProps, { mode: 'match' }>
const NITRO_CELLS = 5
const HUD_MS = 100
const COURSE = 'neon-1'

/** 틱 → mm:ss.cc */
export function formatTicks(ticks: number): string {
  const cs = Math.max(0, Math.round((ticks / TICK_HZ) * 100))
  const m = Math.floor(cs / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

export function RacerGame(props: RealtimeGameProps) {
  if (props.mode === 'match') return <MatchGame {...props} />
  return <PracticeGame {...props} />
}

type Drive = {
  keys: MutableRefObject<Set<string>>
  airKeys: MutableRefObject<Set<string>>
  airborneRef: MutableRefObject<boolean>
  press(code: string): void
  release(code: string): void
}

/**
 * 키보드·화면 버튼 입력. 게임 키는 기본 동작(스크롤)을 막고, 포커스를 잃으면 모두 뗀다.
 * 공중에 뜬 뒤 새로 누른 키는 airKeys에도 넣는다(기울기용). Esc는 나가기, R은 복귀.
 */
function useDrive(onExit: () => void, reset: () => void): Drive {
  const keys = useRef(new Set<string>())
  // 공중에 뜬 뒤 새로 누른 키(기울기용). 땅에 닿으면 비운다
  const airKeys = useRef(new Set<string>())
  const airborneRef = useRef(false)
  const exitRef = useRef(onExit)
  exitRef.current = onExit
  const resetRef = useRef(reset)
  resetRef.current = reset

  // 키·화면 버튼: 같은 키 집합을 쓴다. 공중에 뜬 뒤 새로 누른 키는 airKeys에도 넣는다(기울기용).
  const press = useCallback((code: string) => {
    if (airborneRef.current && !keys.current.has(code)) airKeys.current.add(code)
    keys.current.add(code)
  }, [])
  const release = useCallback((code: string) => {
    keys.current.delete(code)
    airKeys.current.delete(code)
  }, [])

  // 키: 게임 키는 기본 동작(스크롤)을 막는다. 포커스를 잃으면 모두 뗀다.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        exitRef.current()
        return
      }
      if (e.code === 'KeyR') {
        resetRef.current()
        return
      }
      if (GAME_KEYS.has(e.code)) {
        e.preventDefault()
        if (!e.repeat) press(e.code)
      }
    }
    const up = (e: KeyboardEvent) => release(e.code)
    const releaseAll = () => {
      keys.current.clear()
      airKeys.current.clear()
    }
    const vis = () => { if (document.visibilityState === 'hidden') releaseAll() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [press, release])

  return { keys, airKeys, airborneRef, press, release }
}

function PracticeGame({ onExit }: Extract<RealtimeGameProps, { mode: 'practice' }>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading')
  const [hud, setHud] = useState<RaceSnapshot | null>(null)
  const [best, setBest] = useState<number | null>(null)
  const [round, setRound] = useState(0)
  const [touch] = useState(isTouchDevice)
  const raceRef = useRef<{ mod: RaceMod; race: Race } | null>(null)
  const reset = useCallback(() => {
    const r = raceRef.current
    if (r) r.mod.requestReset(r.race)
  }, [])
  const { keys, airKeys, airborneRef, press, release } = useDrive(onExit, reset)

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
        // 연습은 프레임당 250ms까지만 흘린다(숨긴 탭은 멈춤). 2단계 대국은 서버 시각 경과로 따라잡을 것(설계 §6.3)
        const ms = lastT === null ? 0 : Math.min(250, t - lastT) || 0
        lastT = t
        // 공중이면 방향키가 차 방향·기울기를 조절한다
        const airborne = !mod.snapshot(r.race).car.grounded
        if (!airborne) airKeys.current.clear()
        airborneRef.current = airborne
        mod.advance(r.race, ms, controlsFrom(keys.current, airborne, airKeys.current))
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

  return (
    <div className={touch ? 'dr dr-touch' : 'dr'}>
      <div className="dr-stage">
        <canvas ref={canvasRef} className="dr-canvas" aria-label="레이스 화면" />
        {phase === 'loading' && <p className="dr-overlay" role="status">불러오는 중…</p>}
        {phase === 'error' && (
          <div className="dr-overlay" role="alert">
            <p>{LOAD_ERROR}</p>
            <button type="button" className="btn btn-primary" onClick={onExit}>나가기</button>
          </div>
        )}
        {phase === 'ready' && snap && (
          <>
            <RaceHud snap={snap} />
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
      {touch && phase === 'ready' && (
        <>
          <div className="dr-corner">
            <button type="button" className="btn btn-ghost" onClick={reset}>복귀</button>
            <button type="button" className="btn btn-ghost" onClick={onExit}>나가기</button>
          </div>
          <TouchPad press={press} release={release} />
        </>
      )}
      {!touch && <p className="dr-help">방향키·WASD 운전 · 공중에서 A/D 방향, W/S 기울기 · Shift 니트로(안 쓰면 잠시 뒤 저절로 참) · R 복귀 · Esc 나가기</p>}
    </div>
  )
}

/** 진행 막대·시간·속도·니트로·카운트다운(연습과 대국 공용) */
function RaceHud({ snap }: { snap: RaceSnapshot }) {
  const filled = Math.floor(snap.nitro.gauge * NITRO_CELLS + 1e-9)
  return (
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
    </>
  )
}

const LOAD_ERROR = '이 브라우저에서는 레이스를 열 수 없어요'
/** 상대 차를 그리는 데 쓰는 HUD 갱신 간격과 같은 주기로 연결 상태도 읽는다 */
type MatchHud = { view: MatchView; link: string }

/** 결과 글: 서버 판정(result)이 있으면 그것으로, 없으면 내 기록과 기다림 */
function MatchResult({ view, result, mySeat, names, onExit }: {
  view: MatchView
  result: RealtimeResult | null
  mySeat: 0 | 1
  names: [string, string]
  onExit(): void
}) {
  const other = mySeat === 0 ? 1 : 0
  const time = (t: number | null | undefined) => (typeof t === 'number' && t > 0 ? formatTicks(t) : '미완주')
  let title: string
  let mine: number | null | undefined = view.myFinish
  let theirs: number | null | undefined = view.oppFinish
  if (result?.void) title = '무효가 된 대국이에요'
  else if (result) {
    title = result.winner === null ? '비겼어요' : result.winner === mySeat ? '이겼어요' : '졌어요'
    if (result.scores) {
      mine = result.scores[mySeat]
      theirs = result.scores[other]
    }
  } else title = '결과를 기다리는 중…'
  return (
    <div className="dr-overlay dr-result" role="status">
      <p className="dr-result-title">{title}</p>
      {!result?.void && (
        <>
          <p className="dr-result-best">{names[mySeat]} <span className="dr-match-time" data-testid="racer-my-time">{time(mine)}</span></p>
          {(result || theirs !== undefined) && (
            <p className="dr-result-best">{names[other]} <span className="dr-match-time" data-testid="racer-opp-time">{time(theirs)}</span></p>
          )}
        </>
      )}
      {result && (
        <div className="dr-result-actions">
          <button type="button" className="btn btn-ghost" onClick={onExit}>나가기</button>
        </div>
      )}
    </div>
  )
}

/**
 * 온라인 대국 화면(설계 §6). 서버 시각 기준으로 세션을 따라잡고(프레임 상한 없음), 상대 차·순위·연결 상태를 보인다.
 * 판돈·레이팅·재대결은 플랫폼 결과 카드가 그린다. 나가면(Esc) 레이스를 버리는 것이라 마감 때 미완주로 처리된다.
 */
function MatchGame(props: MatchProps) {
  const { onExit, mySeat, names, startAt, link, report, result } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading')
  const [hud, setHud] = useState<MatchHud | null>(null)
  const [touch] = useState(isTouchDevice)
  const sessionRef = useRef<{ mod: MatchMod; race: RaceMod; s: MatchSession } | null>(null)
  const nowRef = useRef(props.serverNow)
  nowRef.current = props.serverNow
  const reportRef = useRef(report)
  reportRef.current = report
  const reset = useCallback(() => {
    const r = sessionRef.current
    if (r) r.race.requestReset(r.s.race)
  }, [])
  const { keys, airKeys, airborneRef, press, release } = useDrive(onExit, reset)

  useEffect(() => {
    let alive = true
    let raf = 0
    let scene: Scene3D | null = null
    let lastHud = -Infinity
    let cleanupResize = () => {}
    ;(async () => {
      try {
        const [mm, rm, sc, rp] = await Promise.all([
          import('./match.ts'), import('./race.ts'), import('./render/scene.ts'), import('./physics/rapier.ts'),
        ])
        const R = await rp.loadRapier()
        if (!alive) return
        const s = mm.createMatch(R, { mySeat, startAt, link, report: (r) => reportRef.current(r) })
        const canvas = canvasRef.current
        if (!canvas) throw new Error('canvas')
        try {
          scene = sc.createScene(canvas, s.race.course)
        } catch (e) {
          mm.disposeMatch(s)
          throw e
        }
        sessionRef.current = { mod: mm, race: rm, s }
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
      cleanupResize = () => window.removeEventListener('resize', fit)
      const loop = (t: number) => {
        if (!alive) return
        const r = sessionRef.current
        if (!r) return
        const before = r.mod.matchView(r.s)
        const airborne = !before.snap.car.grounded
        if (!airborne) airKeys.current.clear()
        airborneRef.current = airborne
        // 서버 시각까지 따라잡는다(대국은 프레임 상한 없음, 설계 §6.3)
        r.mod.stepMatch(r.s, nowRef.current(), controlsFrom(keys.current, airborne, airKeys.current))
        const view = r.mod.matchView(r.s)
        scene?.setOpponent(view.opponent, view.alpha)
        scene?.draw(view.snap, view.alpha)
        if (t - lastHud >= HUD_MS || view.phase !== before.phase) {
          lastHud = t
          setHud({ view, link: link.status() })
        }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    })()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      cleanupResize()
      const r = sessionRef.current
      sessionRef.current = null
      if (r) r.mod.disposeMatch(r.s)
      scene?.dispose()
    }
    // 대국 하나에 세션 하나: 좌석·출발·연결이 바뀌지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySeat, startAt, link])

  const view = hud?.view ?? null
  const other = mySeat === 0 ? 1 : 0
  const done = view?.phase === 'done' || !!result

  return (
    <div className={touch ? 'dr dr-touch' : 'dr'}>
      <div className="dr-stage">
        <canvas ref={canvasRef} className="dr-canvas" aria-label="레이스 화면" />
        {phase === 'loading' && <p className="dr-overlay" role="status">불러오는 중…</p>}
        {phase === 'error' && (
          <div className="dr-overlay" role="alert">
            <p>{LOAD_ERROR}</p>
            <button type="button" className="btn btn-primary" onClick={onExit}>나가기</button>
          </div>
        )}
        {phase === 'ready' && view && (
          view.phase === 'version_mismatch' ? (
            <div className="dr-overlay" role="alert">
              <p>게임이 새로 바뀌었어요. 새로고침해 주세요</p>
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>새로고침</button>
            </div>
          ) : (
            <>
              <RaceHud snap={view.snap} />
              <div className="dr-opp" aria-label="상대">
                {view.rank !== null && <strong data-testid="racer-rank">{view.rank}위</strong>}
                <span>{`상대 ${names[other]}`}</span>
                {hud?.link === 'relay' && <span className="dr-warn">연결이 느려요</span>}
              </div>
              {!view.heard && (view.phase === 'waiting' || view.phase === 'countdown') && (
                <p className="dr-wait" role="status">상대 기다리는 중</p>
              )}
              {done && <MatchResult view={view} result={result} mySeat={mySeat} names={names} onExit={onExit} />}
            </>
          )
        )}
      </div>
      {touch && phase === 'ready' && (
        <>
          <div className="dr-corner">
            <button type="button" className="btn btn-ghost" onClick={reset}>복귀</button>
            <button type="button" className="btn btn-ghost" onClick={onExit}>나가기</button>
          </div>
          <TouchPad press={press} release={release} />
        </>
      )}
      {!touch && <p className="dr-help">방향키·WASD 운전 · 공중에서 A/D 방향, W/S 기울기 · Shift 니트로 · R 복귀 · Esc 나가기(레이스를 버리면 미완주)</p>}
    </div>
  )
}

/** 터치 위주 기기인지(손가락이 주 입력). 버튼 패드를 띄운다 */
function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

const PAD: { code: string; label: string; text: string; area: string }[] = [
  { code: 'ArrowLeft', label: '왼쪽', text: '◀', area: 'left' },
  { code: 'ArrowRight', label: '오른쪽', text: '▶', area: 'right' },
  { code: 'ShiftLeft', label: '니트로', text: '니트로', area: 'nitro' },
  { code: 'ArrowDown', label: '브레이크', text: '브레이크', area: 'brake' },
  { code: 'ArrowUp', label: '가속', text: '가속', area: 'gas' },
]

/** 화면 아래 1/3 조작 버튼. 손가락마다 따로 누르고 뗀다(여러 개 동시에) */
function TouchPad({ press, release }: { press(code: string): void; release(code: string): void }) {
  return (
    <div className="dr-pad">
      {PAD.map((b) => (
        <button
          key={b.code}
          type="button"
          aria-label={b.label}
          className={`dr-pad-btn dr-pad-${b.area}`}
          onPointerDown={(e) => {
            e.preventDefault()
            e.currentTarget.setPointerCapture?.(e.pointerId)
            press(b.code)
          }}
          onPointerUp={() => release(b.code)}
          onPointerCancel={() => release(b.code)}
          onLostPointerCapture={() => release(b.code)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {b.text}
        </button>
      ))}
    </div>
  )
}
