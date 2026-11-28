import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError, duel, duelErrorMessage, rpc, type DuelCreated, type DuelView } from '../../lib/api.ts'
import { getDuel } from '../../games/index.ts'
import { getDuelComponent, getRealtimeComponent, type RealtimeResult } from '../../games/ui.ts'
import { supabase } from '../../lib/supabase.ts'
import { now as serverNow } from '../../lib/serverTime.ts'
import { linkChannelName, openLink, type ChannelLike, type RealtimeLink } from './realtime/peer.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useGameScreen } from '../games/useGameScreen.ts'
import { InviteLink } from '../contests/InviteLink.tsx'
import { formatClock, remainingMs, useDuelMatch } from './data.ts'
import { stakeOf, stakeOutcome } from './stake.ts'
import { formatGold, signedGold } from '../wallet/format.ts'
import { refreshWallet } from '../wallet/useWallet.ts'
import '../wallet/wallet.css'

const RESIGN_CONFIRM_MS = 3000

export type DuelNavState = { inviteCode?: string } | null

const nameOf = (v: DuelView, seat: 0 | 1) => v.players[seat]?.handle ?? '알 수 없음'

function endReasonText(r: string | null): string | null {
  if (r === 'resign') return '기권으로 끝났어요'
  if (r === 'timeout') return '시간 초과로 끝났어요'
  return null
}

function Players({ v, realtime = false }: { v: DuelView; realtime?: boolean }) {
  // 실시간 대전에는 차례가 없다(마감은 대국 마감)
  const ms = realtime ? null : remainingMs(v)
  return (
    <div className="duel-players">
      {v.players.map((p, i) => {
        const turn = !realtime && v.status === 'active' && v.to_move === i
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

/** 끝난 대국의 내 판돈 결과 (지갑 설계 §9) */
function StakeLine({ v }: { v: DuelView }) {
  const o = stakeOutcome(v)
  if (!o) return null
  if (o.kind === 'refund') return <p className="card-status">판돈을 돌려받았어요</p>
  const n = o.kind === 'won' ? o.amount : -o.amount
  return <p className={`stake-amount ${o.kind === 'won' ? 'stake-won' : 'stake-lost'}`}>{`${signedGold(n)} JWD`}</p>
}

function Result({ v, onRematch, rematchBusy, rematchError, realtime = false }: {
  v: DuelView
  realtime?: boolean
  onRematch(): void
  rematchBusy: boolean
  rematchError: string | null
}) {
  if (v.status === 'void') {
    return (
      <section className="card" aria-label="결과">
        <p className="card-title">무효가 된 대국이에요</p>
        <p className="muted">레이팅과 전적에 들어가지 않아요</p>
        <StakeLine v={v} />
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
      <StakeLine v={v} />
      {/* 실시간 대전의 점수(완주 틱)는 게임 화면이 기록으로 보여 준다 */}
      {v.final_scores && !realtime && (
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
          <button type="button" className="btn btn-primary" disabled={rematchBusy} onClick={onRematch}>
            {stakeOf(v) > 0 ? `재대결 (판돈 ${formatGold(stakeOf(v))})` : '재대결'}
          </button>
        )}
        <Link className="btn btn-ghost btn-link" to="/duel">대전 탭으로</Link>
      </div>
    </section>
  )
}

/** 닫힌 연결: 끝난 대국을 처음 열었을 때(연결이 필요 없을 때) 화면에 넘긴다 */
const CLOSED_LINK: RealtimeLink = {
  send: () => {},
  onMessage: () => () => {},
  status: () => 'closed',
  onStatus: () => () => {},
  close: () => {},
}

function realtimeResult(v: DuelView): RealtimeResult | null {
  if (v.status === 'void') return { winner: null, void: true, scores: null }
  if (v.status === 'finished') return { winner: v.winner, void: false, scores: v.final_scores }
  return null
}

/**
 * 실시간 대전 화면(레이싱 설계 §6·§7). 진행 중이고 내가 참가자일 때만 연결을 열고, 끝나거나 화면을 떠나면 닫는다.
 * 출발 = 대국 마감 - 대국 시간 + 출발 지연(manifest duel.realtime.startDelaySec).
 */
function RealtimeMatch({ v, report, onExit }: { v: DuelView; report(r: unknown): void; onExit(): void }) {
  const Screen = getRealtimeComponent(v.game_id)
  const delay = getDuel(v.game_id)?.manifest.duel?.realtime?.startDelaySec ?? 0
  const startRef = useRef<{ id: string; at: number } | null>(null)
  if (v.turn_deadline && v.status === 'active') {
    const at = Date.parse(v.turn_deadline) - v.turn_seconds * 1000 + delay * 1000
    if (startRef.current?.id !== v.match_id || startRef.current.at !== at) startRef.current = { id: v.match_id, at }
  }
  const startAt = startRef.current?.id === v.match_id ? startRef.current.at : 0
  const [link, setLink] = useState<{ id: string; link: RealtimeLink } | null>(null)
  const active = v.status === 'active'
  const seat = v.my_seat
  useEffect(() => {
    if (!active || seat === null) return
    const channel = supabase.channel(linkChannelName(v.match_id))
    const l = openLink({ matchId: v.match_id, mySeat: seat, channel: channel as unknown as ChannelLike })
    setLink({ id: v.match_id, link: l })
    return () => {
      l.close()
      try { void supabase.removeChannel(channel) } catch { /* ignore */ }
    }
  }, [active, seat, v.match_id])
  if (!Screen || seat === null) return null
  const mine = link?.id === v.match_id ? link.link : null
  const result = realtimeResult(v)
  // 진행 중인데 아직 연결 객체가 없으면 다음 렌더(효과 직후)에 그린다
  if (!mine && !result) return null
  return (
    <Screen
      gameId={v.game_id}
      mode="match"
      onExit={onExit}
      matchId={v.match_id}
      mySeat={seat}
      names={[nameOf(v, 0), nameOf(v, 1)]}
      startAt={startAt}
      serverNow={serverNow}
      link={mine ?? CLOSED_LINK}
      result={result}
      report={report}
    />
  )
}

export function DuelMatchPage() {
  const { id = '' } = useParams()
  const loc = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { view: v, error, fatal, busy, act, report, resign, cancel } = useDuelMatch(id)
  const [rematchBusy, setRematchBusy] = useState(false)
  const [rematchError, setRematchError] = useState<string | null>(null)
  const rematching = useRef(false)
  const navCode = (loc.state as DuelNavState)?.inviteCode

  useEffect(() => { setRematchError(null) }, [id])

  // 판돈 대국이 끝나면(지급·환불은 서버 트리거가 이미 했다) 헤더 잔액을 다시 읽는다. 대국마다 한 번
  const refreshed = useRef<string | null>(null)
  const settled = !!v && (v.status === 'finished' || v.status === 'void') && stakeOf(v) > 0
  useEffect(() => {
    if (!settled || !v || refreshed.current === v.match_id) return
    refreshed.current = v.match_id
    void refreshWallet()
  }, [settled, v])

  const realtime = !!v && !!getDuel(v.game_id)?.manifest.duel?.realtime
  const realtimeShown = !fatal && !!v && realtime && v.status !== 'waiting' && v.my_seat !== null
    && !!getRealtimeComponent(v.game_id)
  const boardShown = !fatal && !!v && !realtime && v.status !== 'waiting' && v.status !== 'void'
    && !!getDuelComponent(v.game_id) && v.view !== null && v.view !== undefined
  // 게임 화면이 떠 있을 때만 글자 선택을 막는다(대기 중 초대 링크는 고를 수 있게)
  useGameScreen(boardShown || realtimeShown)

  async function rematch() {
    if (!v || rematching.current) return
    rematching.current = true
    setRematchBusy(true)
    setRematchError(null)
    try {
      // 같은 설정의 새 초대 대국. 상대는 링크로 들어온다 (자동 수락 없음, 설계 §4.10)
      const r = await duel<DuelCreated>({
        action: 'create', game_id: v.game_id, options: v.options, rated: v.rated,
        visibility: 'invite', turn_seconds: v.turn_seconds, stake: stakeOf(v),
      })
      if (stakeOf(v) > 0) void refreshWallet()
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
  // 선수·차례·결과·기권. 게임 화면이 있으면 화면 안(넓은 화면에서는 조작 열)에 넣는다. 폰에서는 순서가 같다
  const head = (
    <>
      <Players v={v} realtime={realtime} />
      {v.status === 'active' && mine && !realtime && (
        <p className={myTurn ? 'duel-status duel-status-me' : 'duel-status'} role="status">
          {myTurn ? '내 차례' : '상대 차례'}
        </p>
      )}
    </>
  )
  const result = finished && (
    <Result v={v} realtime={realtime} onRematch={() => void rematch()} rematchBusy={rematchBusy} rematchError={rematchError} />
  )
  const resignBtn = v.status === 'active' && mine && <ResignButton onResign={resign} disabled={busy} />

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="page-title">{gameName}</h2>
        <div className="row">
          <span className="badge">{v.rated ? '랭크' : '친선'}</span>
          {!realtime && <span className="badge">턴 {v.turn_seconds}초</span>}
          {stakeOf(v) > 0 && <span className="badge">판돈 {formatGold(stakeOf(v))}</span>}
        </div>
      </div>
      {!boardShown && head}
      {/* 게임 화면이 있으면 오류는 화면이 보여 준다 */}
      {error && !boardShown && <p className="notice" role="alert">{error}</p>}

      {realtime && v.status !== 'waiting' ? (
        <>
          {v.my_seat === null && <p className="muted">실시간 대국은 관전할 수 없어요</p>}
          {realtimeShown && (
            <section aria-label="게임 화면">
              <RealtimeMatch v={v} report={report} onExit={() => navigate('/duel')} />
            </section>
          )}
          {result}
        </>
      ) : v.status === 'waiting' ? (
        <section className="card" aria-label="대기">
          <p className="card-title">상대를 기다리는 중</p>
          <p className="muted">10분 안에 아무도 들어오지 않으면 자동으로 취소돼요</p>
          {stakeOf(v) > 0 && (
            <p className="muted">판돈 {formatGold(stakeOf(v))}를 맡겼어요 · 취소되면 돌려받아요</p>
          )}
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
