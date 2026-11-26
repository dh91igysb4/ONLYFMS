import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getDuel } from '../../games/index.ts'
import { getDuelComponent } from '../../games/ui.ts'
import type { DuelResult } from '../../games/types.ts'
import { duelActionMessage, rpc } from '../../lib/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useGameScreen } from '../games/useGameScreen.ts'
import { defaultOptions, OptionSelects } from './OptionSelects.tsx'

const NAMES: [string, string] = ['플레이어 1', '플레이어 2']

/**
 * 같은 화면 대전 (설계 §8·§9): 한 기기에서 두 사람이 번갈아. 대국 기록 없음, 턴 시간 제한 없음.
 * manifest `duel.prepare`가 있으면 판마다 그 RPC를 먼저 불러 결과를 init에 넘긴다(티키타카토 설계 §5.3).
 * manifest `options`가 있으면 먼저 설정을 고르고, 고른 설정으로 판을 만든다(다시 하기도 같은 설정).
 */
export function DuelLocalPage({ rng }: { rng?: () => number }) {
  const { game = '' } = useParams()
  // 게임이 바뀌면 상태를 처음부터
  return <LocalGame key={game} game={game} rng={rng} />
}

function LocalGame({ game, rng }: { game: string; rng?: () => number }) {
  const { profile } = useAuth()
  const found = getDuel(game)
  // 숨김 게임은 관리자에게만 있는 게임이다. 그 밖의 사람에게는 없는 게임과 똑같이 보인다.
  const mod = found && (!found.manifest.hidden || !!profile?.is_admin) ? found : undefined
  const Board = getDuelComponent(game)
  const random = useRef(rng ?? Math.random)
  const prepare = mod?.manifest.duel?.prepare
  const hasOptions = !!mod && mod.manifest.options.length > 0
  const [options, setOptions] = useState<Record<string, string>>(() => (mod ? defaultOptions(mod.manifest) : {}))
  const [state, setState] = useState<unknown>(() => (mod && !prepare && !hasOptions ? mod.logic.init(random.current, options) : null))
  // setup: 설정 고르기(옵션이 있을 때), loading/failed: 판 준비 RPC, ready: 대국
  const [phase, setPhase] = useState<'setup' | 'loading' | 'failed' | 'ready'>(hasOptions ? 'setup' : prepare ? 'loading' : 'ready')
  const [passed, setPassed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const playable = !!mod && !!Board && !!mod.manifest.duel?.sameScreen
  useGameScreen(playable)
  // 화면을 떠난 뒤 늦게 온 응답·이전 시도의 응답은 버린다
  const attempt = useRef(0)
  useEffect(() => () => { attempt.current++ }, [])

  const load = useCallback(async (opts: Record<string, string>) => {
    if (!mod || !prepare) return
    const n = ++attempt.current
    setPhase('loading')
    let next: unknown = null
    try {
      const data = await rpc<unknown>(prepare, { p_options: opts })
      // 결과 모양이 틀려 init이 던져도 실패로 본다
      if (data !== null && data !== undefined) next = mod.logic.init(random.current, opts, data)
    } catch {
      next = null
    }
    if (n !== attempt.current) return
    if (next === null) {
      setPhase('failed')
      return
    }
    setState(next)
    setPassed(false)
    setError(null)
    setPhase('ready')
  }, [mod, prepare])

  // 옵션이 없는 준비 게임은 바로 판을 불러온다
  useEffect(() => {
    if (playable && prepare && !hasOptions) void load(options)
  }, [playable, prepare, hasOptions, load, options])

  /** 고른 설정으로 새 판 */
  function start(opts: Record<string, string>) {
    if (!mod) return
    setRound((n) => n + 1)
    if (prepare) {
      void load(opts)
      return
    }
    setState(mod.logic.init(random.current, opts))
    setPassed(false)
    setError(null)
    setPhase('ready')
  }

  if (!mod || !Board || !playable) {
    return (
      <div className="stack">
        <p className="muted">없는 게임이에요</p>
        <Link to="/duel">대전으로</Link>
      </div>
    )
  }

  if (phase === 'setup') {
    return (
      <div className="stack">
        <h2 className="page-title">{mod.manifest.name} · 같은 화면</h2>
        <form className="card" aria-label="설정" onSubmit={(e) => { e.preventDefault(); start(options) }}>
          <OptionSelects manifest={mod.manifest} value={options} onChange={setOptions} />
          <div className="card-actions">
            <button type="submit" className="btn btn-primary">시작</button>
            <Link className="btn btn-ghost" to="/duel">대전으로</Link>
          </div>
        </form>
      </div>
    )
  }

  if (phase !== 'ready') {
    return (
      <div className="stack">
        <h2 className="page-title">{mod.manifest.name} · 같은 화면</h2>
        {phase === 'loading' ? (
          <p className="muted" aria-live="polite">판을 준비하고 있어요</p>
        ) : (
          <section className="card">
            <p className="card-title" role="alert">판을 불러오지 못했어요</p>
            <div className="card-actions">
              <button type="button" className="btn btn-primary" onClick={() => void load(options)}>다시 시도</button>
              {hasOptions && <button type="button" className="btn btn-ghost" onClick={() => setPhase('setup')}>설정 바꾸기</button>}
              <Link className="btn btn-ghost" to="/duel">대전으로</Link>
            </div>
          </section>
        )}
      </div>
    )
  }

  const { logic } = mod
  const seat = logic.toMove(state)
  const result: DuelResult = logic.result(state)
  const over = result.over

  function act(action: unknown) {
    const before = logic.turnNo(state)
    const r = logic.apply(state, seat, action, random.current)
    if ('error' in r) {
      setError(duelActionMessage(r.error))
      return
    }
    setError(null)
    setState(r.state)
    setPassed(logic.turnNo(r.state) !== before && !logic.result(r.state).over)
  }


  return (
    <div className="stack">
      <h2 className="page-title">{mod.manifest.name} · 같은 화면</h2>
      <Board
        key={round}
        view={logic.view(state, seat, over)}
        mySeat={seat}
        toMove={seat}
        finished={over}
        busy={false}
        error={error}
        names={NAMES}
        onAction={act}
        header={over ? (
          <section className="card" aria-label="결과">
            <p className="card-title">
              {result.winner === null ? '무승부' : `${NAMES[result.winner]} 승리`}
            </p>
            {result.scores && (
              <p className="card-status">{NAMES[0]} {result.scores[0]} : {result.scores[1]} {NAMES[1]}</p>
            )}
            <div className="card-actions">
              <button type="button" className="btn btn-primary" onClick={() => start(options)}>다시 하기</button>
              {hasOptions && <button type="button" className="btn btn-ghost" onClick={() => setPhase('setup')}>설정 바꾸기</button>}
              <Link className="btn btn-ghost" to="/duel">대전으로</Link>
            </div>
          </section>
        ) : null}
        footer={!over && (
          <p className="card-status" data-testid="turn" aria-live="polite">
            {NAMES[seat]} 차례
            {passed && <span className="muted"> · 기기를 넘겨주세요</span>}
          </p>
        )}
      />
    </div>
  )
}
