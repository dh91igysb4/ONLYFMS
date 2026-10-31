import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getDuel } from '../../games/index.ts'
import { getDuelComponent } from '../../games/ui.ts'
import type { DuelResult } from '../../games/types.ts'
import { useAuth } from '../auth/AuthProvider.tsx'

const NAMES: [string, string] = ['플레이어 1', '플레이어 2']

/** 같은 화면 대전 (설계 §8·§9): 한 기기에서 두 사람이 번갈아. 서버 호출·기록 없음, 턴 시간 제한 없음. */
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
  const [state, setState] = useState<unknown>(() => (mod ? mod.logic.init(random.current, {}) : null))
  const [passed, setPassed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  if (!mod || !Board || !mod.manifest.duel?.sameScreen) {
    return (
      <div className="stack">
        <p className="muted">없는 게임이에요</p>
        <Link to="/duel">대전으로</Link>
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
    setState(logic.init(random.current, {}))
    setPassed(false)
    setError(null)
    setRound((n) => n + 1)
  }

  return (
    <div className="stack">
      <h2 className="page-title">{mod.manifest.name} · 같은 화면</h2>
      {over ? (
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
      />
      {!over && (
        <p className="card-status" data-testid="turn" aria-live="polite">
          {NAMES[seat]} 차례
          {passed && <span className="muted"> · 기기를 넘겨주세요</span>}
        </p>
      )}
    </div>
  )
}
