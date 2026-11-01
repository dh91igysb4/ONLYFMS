import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError, duel, duelErrorMessage, rpc, type DuelCreated, type DuelView } from '../../lib/api.ts'
import { getDuel } from '../../games/index.ts'
import { getDuelComponent } from '../../games/ui.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { InviteLink } from '../contests/InviteLink.tsx'
import { formatClock, remainingMs, useDuelMatch } from './data.ts'

const RESIGN_CONFIRM_MS = 3000

export type DuelNavState = { inviteCode?: string } | null

const nameOf = (v: DuelView, seat: 0 | 1) => v.players[seat]?.handle ?? '알 수 없음'

function endReasonText(r: string | null): string | null {
  if (r === 'resign') return '기권으로 끝났어요'
  if (r === 'timeout') return '시간 초과로 끝났어요'
  return null
}

function Players({ v }: { v: DuelView }) {
  const ms = remainingMs(v)
  return (
    <div className="duel-players">
      {v.players.map((p, i) => {
        const turn = v.status === 'active' && v.to_move === i
        return (
          <div key={p.id} className={`duel-player${turn ? ' duel-turn' : ''}${v.my_seat === i ? ' duel-me' : ''}`}>
            <strong>{p.handle ?? '알 수 없음'}{v.my_seat === i && ' (나)'}</strong>
            <span className="muted">{p.rating}</span>
            {turn && ms !== null && <span className="countdown" aria-label="남은 시간">{formatClock(ms)}</span>}
          </div>
        )
      })}
    </div>
  )
}

function ResignButton({ onResign, disabled }: { onResign(): void; disabled: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), RESIGN_CONFIRM_MS)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={armed ? 'btn btn-primary' : 'btn btn-ghost'}
      disabled={disabled}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onResign()
      }}
    >
      {armed ? '한 번 더 누르면 기권' : '기권'}
    </button>
  )
}

/** 대기 중인 내 대국의 초대 링크 (공개 대국도 링크로 부를 수 있다) */
function WaitingInvite({ matchId, initialCode }: { matchId: string; initialCode?: string }) {
  const [code, setCode] = useState<string | null>(initialCode ?? null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (initialCode) return
    let alive = true
    rpc<string | null>('duel_invite_code', { p_match: matchId })
      .then((c) => { if (alive) { if (c) setCode(c); else setFailed(true) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [matchId, initialCode])
  if (code) return <InviteLink code={code} path="/duel/join/" />
  if (failed) return <p className="muted">초대 링크를 불러오지 못했어요</p>
  return <p className="muted">초대 링크를 불러오는 중…</p>
}

function Result({ v, onRematch, rematchBusy, rematchError }: {
  v: DuelView
  onRematch(): void
  rematchBusy: boolean
  rematchError: string | null
}) {
  if (v.status === 'void') {
    return (
      <section className="card" aria-label="결과">
        <p className="card-title">무효가 된 대국이에요</p>
        <p className="muted">레이팅과 전적에 들어가지 않아요</p>
        <Link className="btn btn-ghost btn-link" to="/duel">대전 탭으로</Link>
      </section>
    )
  }
  let headline: string
  if (v.winner === null) headline = '비겼어요'
  else if (v.my_seat === null) headline = `${nameOf(v, v.winner)} 승`
  else headline = v.winner === v.my_seat ? '이겼어요' : '졌어요'
  const reason = endReasonText(v.end_reason)
  const rc = v.rating_change
  return (
    <section className="card" aria-label="결과">
      <p className="duel-headline">{headline}</p>
      {reason && <p className="muted">{reason}</p>}
      {v.final_scores && (
        <p className="duel-score">{`${v.final_scores[0]} : ${v.final_scores[1]}`}</p>
      )}
      {rc && (
        <p className="card-status">
          레이팅 {rc.before} → {rc.after} ({rc.after - rc.before >= 0 ? '+' : ''}{rc.after - rc.before})
        </p>
      )}
      {!v.rated && <p className="muted">친선 대국이라 레이팅에 들어가지 않아요</p>}
      {rematchError && <p className="form-error" role="alert">{rematchError}</p>}
      <div className="card-actions">
        {v.my_seat !== null && (
          <button type="button" className="btn btn-primary" disabled={rematchBusy} onClick={onRematch}>재대결</button>
        )}
        <Link className="btn btn-ghost btn-link" to="/duel">대전 탭으로</Link>
      </div>
    </section>
  )
}

export function DuelMatchPage() {
  const { id = '' } = useParams()
  const loc = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { view: v, error, fatal, busy, act, resign, cancel } = useDuelMatch(id)
  const [rematchBusy, setRematchBusy] = useState(false)
  const [rematchError, setRematchError] = useState<string | null>(null)
  const rematching = useRef(false)
  const navCode = (loc.state as DuelNavState)?.inviteCode

  useEffect(() => { setRematchError(null) }, [id])

  async function rematch() {
    if (!v || rematching.current) return
    rematching.current = true
    setRematchBusy(true)
    setRematchError(null)
    try {
      // 같은 설정의 새 초대 대국. 상대는 링크로 들어온다 (자동 수락 없음, 설계 §4.10)
      const r = await duel<DuelCreated>({
        action: 'create', game_id: v.game_id, options: v.options, rated: v.rated,
        visibility: 'invite', turn_seconds: v.turn_seconds,
      })
      navigate(`/duel/${r.match_id}`, { state: { inviteCode: r.invite_code } })
    } catch (e) {
      setRematchError(duelErrorMessage(e instanceof ApiError ? e.code : 'network'))
    } finally {
      rematching.current = false
      setRematchBusy(false)
    }
  }

  if (fatal) {
    return (
      <div className="stack" role="alert">
        <p className="form-error">{fatal}</p>
        <Link className="btn btn-ghost btn-link" to="/duel">대전 탭으로</Link>
      </div>
    )
  }
  if (!v) {
    return (
      <div className="stack">
        {error ? <p className="form-error" role="alert">{error}</p> : <p className="page-note" role="status">불러오는 중…</p>}
      </div>
    )
  }

  const gameName = getDuel(v.game_id)?.manifest.name ?? v.game_id
  const Board = getDuelComponent(v.game_id)
  const finished = v.status === 'finished' || v.status === 'void'
  const mine = v.my_seat !== null
  const myTurn = v.status === 'active' && mine && v.to_move === v.my_seat
  const iCreated = v.status === 'waiting' && v.players[0]?.id === profile?.id
  const names: [string, string] = [nameOf(v, 0), nameOf(v, 1)]
  const boardShown = v.status !== 'waiting' && v.status !== 'void' && !!Board && v.view !== null && v.view !== undefined
  // 선수·차례·결과·기권. 게임 화면이 있으면 화면 안(넓은 화면에서는 조작 열)에 넣는다. 폰에서는 순서가 같다
  const head = (
    <>
      <Players v={v} />
      {v.status === 'active' && mine && (
        <p className={myTurn ? 'duel-status duel-status-me' : 'duel-status'} role="status">
          {myTurn ? '내 차례' : '상대 차례'}
        </p>
      )}
    </>
  )
  const result = finished && <Result v={v} onRematch={() => void rematch()} rematchBusy={rematchBusy} rematchError={rematchError} />
  const resignBtn = v.status === 'active' && mine && <ResignButton onResign={resign} disabled={busy} />

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="page-title">{gameName}</h2>
        <div className="row">
          <span className="badge">{v.rated ? '랭크' : '친선'}</span>
          <span className="badge">턴 {v.turn_seconds}초</span>
        </div>
      </div>
      {!boardShown && head}
      {/* 게임 화면이 있으면 오류는 화면이 보여 준다 */}
      {error && !boardShown && <p className="notice" role="alert">{error}</p>}

      {v.status === 'waiting' ? (
        <section className="card" aria-label="대기">
          <p className="card-title">상대를 기다리는 중</p>
          <p className="muted">10분 안에 아무도 들어오지 않으면 자동으로 취소돼요</p>
          {iCreated && <WaitingInvite matchId={v.match_id} initialCode={navCode} />}
          {iCreated && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancel}>대국 취소</button>
          )}
        </section>
      ) : (
        <>
          {!boardShown && result}
          {v.status !== 'void' && (
            <section aria-label="게임 화면">
              {boardShown && Board ? (
                <Board
                  view={v.view}
                  mySeat={v.my_seat}
                  toMove={v.to_move}
                  finished={finished}
                  busy={busy}
                  error={error}
                  names={names}
                  onAction={(a) => { if (myTurn) act(a) }}
                  header={<>{head}{result}</>}
                  footer={resignBtn}
                />
              ) : (
                !Board && <p className="muted">준비 중인 게임이에요</p>
              )}
            </section>
          )}
        </>
      )}

      {!boardShown && resignBtn}
    </div>
  )
}
