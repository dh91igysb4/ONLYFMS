import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getDuel } from '../../games/index.ts'
import { getDuelComponent } from '../../games/ui.ts'
import type { DuelResult } from '../../games/types.ts'
import { rpc } from '../../lib/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useGameScreen } from '../games/useGameScreen.ts'

const NAMES: [string, string] = ['플레이어 1', '플레이어 2']

/**
 * 같은 화면 대전 (설계 §8·§9): 한 기기에서 두 사람이 번갈아. 대국 기록 없음, 턴 시간 제한 없음.
 * manifest `duel.prepare`가 있으면 판마다 그 RPC를 먼저 불러 결과를 init에 넘긴다(티키타카토 설계 §5.3).
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
  const defaults = () => Object.fromEntries((mod?.manifest.options ?? []).map((o) => [o.key, o.default]))
  const prepare = mod?.manifest.duel?.prepare
  const [state, setState] = useState<unknown>(() => (mod && !prepare ? mod.logic.init(random.current, defaults()) : null))
  // 판 준비: prepare가 없으면 늘 ready
  const [phase, setPhase] = useState<'loading' | 'failed' | 'ready'>(prepare ? 'loading' : 'ready')
  const [passed, setPassed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const playable = !!mod && !!Board && !!mod.manifest.duel?.sameScreen
  useGameScreen(playable)
  // 화면을 떠난 뒤 늦게 온 응답·이전 시도의 응답은 버린다
  const attempt = useRef(0)
  useEffect(() => () => { attempt.current++ }, [])

  const load = useCallback(async () => {
    if (!mod || !prepare) return
    const n = ++attempt.current
    setPhase('loading')
    const options = Object.fromEntries(mod.manifest.options.map((o) => [o.key, o.default]))
    let data: unknown = null
    try {
      data = await rpc<unknown>(prepare, { p_options: options })
    } catch {
      data = null
    }
    if (n !== attempt.current) return
    if (data === null || data === undefined) {
      setPhase('failed')
      return
    }
    setState(mod.logic.init(random.current, options, data))
    setPassed(false)
    setError(null)
    setPhase('ready')
  }, [mod, prepare])

  useEffect(() => {
    if (playable && prepare) void load()
  }, [playable, prepare, load])

  if (!mod || !Board || !playable) {
    return (
      <div className="stack">
        <p className="muted">없는 게임이에요</p>
        <Link to="/duel">대전으로</Link>
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
              <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
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
      setError('지금은 할 수 없는 행동이에요')
      return
    }
    setError(null)
    setState(r.state)
    setPassed(logic.turnNo(r.state) !== before && !logic.result(r.state).over)
  }

  function restart() {
    setRound((n) => n + 1)
    if (prepare) {
      void load()
      return
    }
    setState(logic.init(random.current, defaults()))
    setPassed(false)
    setError(null)
  }

  return (
    <div className="stack">
      <h2 className="page-title">{mod.manifest.name} · 같은 화면</h2>
      <Board
        key={round}
        view={logic.view(state, seat)}
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
              <button type="button" className="btn btn-primary" onClick={restart}>다시 하기</button>
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
