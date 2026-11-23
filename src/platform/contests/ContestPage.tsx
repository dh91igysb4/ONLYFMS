import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { now } from '../../lib/serverTime.ts'
import { getGame } from '../../games/index.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { fetchContestPrizes, type ContestPrize } from '../wallet/api.ts'
import { walletEnabled } from '../wallet/enabled.ts'
import { formatGold } from '../wallet/format.ts'
import { refreshWallet, useWallet } from '../wallet/useWallet.ts'
import { feeOf, mismatchFee } from './fee.ts'
import { syncServerTime } from './clock.ts'
import { getContest, getEntries, getItems, getSettledAt, type ContestRow, type ItemRow } from './data.ts'
import { countdown, kindLabel, kstLabel, phaseOf } from './format.ts'
import { InviteLink } from './InviteLink.tsx'
import '../wallet/wallet.css'

type LbRow = {
  rank: number; user_id: string; handle: string | null; score: number
  solved_items: number; action_count: number; last_finished_at: string | null
}

const POLL_MS = 5000
const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : 'network')

function gameName(id: string): string {
  return getGame(id)?.manifest.name ?? id
}

function revealText(it: ItemRow): string {
  const g = getGame(it.game_id)
  if (!g || it.puzzle == null) return '정답을 불러오지 못했어요'
  try {
    return JSON.stringify(g.logic.reveal(it.puzzle), null, 1)
  } catch {
    return '정답을 불러오지 못했어요'
  }
}

export function ContestPage() {
  const { id = '' } = useParams()
  const { profile } = useAuth()
  const me = profile?.id
  const [contest, setContest] = useState<ContestRow | null | undefined>(undefined)
  const [items, setItems] = useState<ItemRow[]>([])
  const [entries, setEntries] = useState<string[]>([])
  const [code, setCode] = useState<string | null>(null)
  const [lb, setLb] = useState<LbRow[]>([])
  const [lbError, setLbError] = useState(false)
  const [lbAttempt, setLbAttempt] = useState(0)
  const [lbReady, setLbReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [, setTick] = useState(0)
  const autoJoinTried = useRef(false)
  // 받은 상금(지갑 3단계). 끝난 대회에서만 읽는다
  const [prizes, setPrizes] = useState<ContestPrize[]>([])
  const [settling, setSettling] = useState(false)
  // 참가비(지갑 5단계): 참가 버튼을 한 번 누르면 확인 단계
  const { balance } = useWallet()
  const [confirmJoin, setConfirmJoin] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      await syncServerTime()
      const [c, its, ents] = await Promise.all([getContest(id), getItems(id), getEntries(id)])
      setItems(its)
      setEntries(ents)
      setContest(c)
    } catch (e) {
      setLoadError(errorMessage(codeOf(e)))
    }
  }, [id])

  useEffect(() => {
    autoJoinTried.current = false
    setContest(undefined)
    void load()
  }, [load])

  const isCreator = !!contest && !!me && contest.created_by === me
  const isAdmin = !!profile?.is_admin
  const joined = !!me && entries.includes(me)
  const phase = contest ? phaseOf(contest, now()) : null
  const fee = feeOf(contest)

  // 1초마다 다시 그려 카운트다운과 시작·종료 전환을 반영한다.
  useEffect(() => {
    if (phase !== 'lobby' && phase !== 'live') return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // 초대 코드는 개설자·관리자만 받는다
  const wantsCode = !!contest && contest.visibility === 'invite' && (isCreator || isAdmin) && phase !== 'cancelled'
  useEffect(() => {
    if (!wantsCode) return
    let alive = true
    rpc<string | null>('contest_invite_code', { p_contest: id })
      .then((c) => { if (alive) setCode(c ?? null) })
      .catch(() => {})
    return () => { alive = false }
  }, [wantsCode, id])

  // 순위표: 진행 중에는 5초마다, 종료되면 최종 순위와 정답을 한 번.
  useEffect(() => {
    if (phase !== 'live' && phase !== 'ended') return
    let alive = true
    const ended = phase === 'ended'
    const fetchLb = () =>
      rpc<LbRow[] | null>('lb_contest', { p_contest: id })
        .then((rows) => { if (alive) { setLb(rows ?? []); setLbError(false); setLbReady(true) } })
        .catch(() => { if (alive && ended) setLbError(true) }) // 진행 중 폴링 실패는 조용히 넘긴다
    void fetchLb()
    if (phase === 'ended') {
      getItems(id).then((its) => { if (alive) setItems(its) }).catch(() => {})
      return () => { alive = false }
    }
    const t = setInterval(() => void fetchLb(), POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [phase, id, lbAttempt])

  // 끝난 대회의 상금. 데일리인데 아직 없고 정산 표시도 없으면(settled_at null) my_wallet()(= settle_due)을 한 번 부르고 다시 읽는다.
  // 이미 정산된 대회(3단계 배포 전에 끝나 표시만 된 것, 행동한 사람이 없던 것, 숨김 게임)는 "정산 중"을 보이지 않는다
  const kind = contest?.kind
  useEffect(() => {
    if (phase !== 'ended' || !walletEnabled()) return
    let alive = true
    void (async () => {
      try {
        let rows = await fetchContestPrizes(id)
        if (alive && rows.length === 0 && (kind === 'daily' || fee > 0) && (await getSettledAt(id)) === null && alive) {
          setSettling(true)
          await refreshWallet()
          if (!alive) return
          rows = await fetchContestPrizes(id)
        }
        if (alive) setPrizes(rows)
      } catch {
        /* 상금 표시는 덤이다 */
      } finally {
        if (alive) setSettling(false)
      }
    })()
    return () => { alive = false }
  }, [phase, id, kind, fee])

  const join = useCallback(async () => {
    if (!me) return
    setJoining(true)
    setActionError(null)
    try {
      // 참가비는 화면이 본 금액을 함께 보낸다(다르면 fee_mismatch). 0이면 옛 DB 호환으로 보내지 않는다
      await rpc('join_contest', fee > 0 ? { p_id: id, p_entry_fee: fee } : { p_id: id })
      setEntries((prev) => (prev.includes(me) ? prev : [...prev, me]))
      setConfirmJoin(false)
      if (fee > 0) void refreshWallet()
    } catch (e) {
      setConfirmJoin(false)
      if (mismatchFee(e) !== null) {
        // 화면이 옛 참가비를 보고 있었다: 대회를 다시 읽는다
        setActionError('참가비를 다시 확인해 주세요')
        void load()
      } else {
        setActionError(errorMessage(codeOf(e)))
      }
    } finally {
      setJoining(false)
    }
  }, [id, me, fee, load])

  // 진행 중인 공개 대회는 참가 버튼 없이 들어와도 403이 나지 않게 먼저 참가시킨다.
  // 참가비 대회는 돈이 빠지므로 자동 참가하지 않고 버튼으로 확인받는다.
  useEffect(() => {
    if (!contest || phase !== 'live' || contest.visibility !== 'public' || joined || autoJoinTried.current) return
    if (feeOf(contest) > 0) return
    autoJoinTried.current = true
    void join()
  }, [contest, phase, joined, join])

  async function cancel() {
    if (!confirmCancel) {
      setConfirmCancel(true)
      return
    }
    setActionError(null)
    try {
      await rpc('cancel_contest', { p_id: id })
      setConfirmCancel(false)
      if (fee > 0) void refreshWallet()
      await load()
    } catch (e) {
      setConfirmCancel(false)
      setActionError(errorMessage(codeOf(e)))
    }
  }

  if (loadError) {
    return (
      <div className="stack" role="alert">
        <p className="form-error">{loadError}</p>
        <button className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
      </div>
    )
  }
  if (contest === undefined) return <p className="page-note" role="status">불러오는 중…</p>
  if (contest === null || !phase) {
    return (
      <div className="stack">
        <p className="notice">대회를 찾을 수 없거나, 초대 링크로만 참가할 수 있어요</p>
        <Link className="btn btn-ghost" to="/contests">대회 목록</Link>
      </div>
    )
  }

  const canJoinWithoutCode = contest.visibility === 'public' || isCreator || isAdmin
  const canCancel = (phase === 'lobby' && (isCreator || isAdmin)) || (phase === 'live' && isAdmin)
  const prizeOf = new Map(prizes.map((p) => [p.userId, p]))
  const myPrize = me ? prizeOf.get(me) : undefined
  const showPrizes = phase === 'ended' && prizes.length > 0
  const pool = fee * entries.length
  const short = fee > 0 && balance !== null && balance < fee
  const joinLabel = fee > 0 ? `참가비 ${formatGold(fee)} 내고 참가` : '참가'
  // 끝난 참가비 대회에서 순위(행동 1번 이상)에 든 사람이 없으면 전원 환불(설계 §10)
  const noneRanked = phase === 'ended' && lbReady && lb.every((r) => r.action_count === 0)
  const startMs = Date.parse(contest.starts_at)
  const endMs = Date.parse(contest.ends_at)

  return (
    <div className="stack">
      <Link className="muted" to="/contests">← 대회 목록</Link>
      <div className="row">
        <span className={`badge badge-${contest.kind}`}>{kindLabel(contest.kind)}</span>
        {phase === 'live' && <span className="badge badge-live">진행 중</span>}
        {phase === 'ended' && <span className="badge">종료</span>}
      </div>
      <h2 className="page-title">{contest.title}</h2>
      <p className="muted">{kstLabel(contest.starts_at)} ~ {kstLabel(contest.ends_at)}</p>

      {fee > 0 && (
        <p className="contest-fee">
          참가비 <strong>{formatGold(fee)}</strong> · 모인 돈 <strong>{formatGold(pool)}</strong>
          {phase !== 'ended' && phase !== 'cancelled' && <span className="muted"> · 1~3등이 6:3:1로 나눠 가져요</span>}
        </p>
      )}

      {phase === 'cancelled' && <p className="notice">취소된 대회예요</p>}
      {phase === 'cancelled' && fee > 0 && joined && <p className="muted">참가비를 돌려받았어요</p>}
      {phase === 'ended' && fee > 0 && joined && noneRanked && prizes.length === 0 && !settling && (
        <p className="muted">순위에 든 사람이 없어 참가비를 돌려받았어요</p>
      )}

      {phase === 'lobby' && (
        <>
          <p className="countdown">시작까지 {countdown(startMs - now())}</p>
          <p className="muted">참가자 {entries.length}명</p>
        </>
      )}
      {phase === 'live' && <p className="countdown">종료까지 {countdown(endMs - now())}</p>}

      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      {phase !== 'cancelled' && !joined && canJoinWithoutCode && phase !== 'ended' && (
        phase === 'live' && contest.visibility === 'public' && fee === 0 ? (
          joining ? <p className="muted" role="status">참가하는 중…</p> : actionError ? (
            <button className="btn btn-primary" onClick={() => void join()}>다시 시도</button>
          ) : null
        ) : fee > 0 ? (
          confirmJoin ? (
            <div className="stack" role="group" aria-label="참가 확인">
              <p>참가비 {formatGold(fee)}를 내고 참가할까요? 대회가 취소되면 돌려받아요.</p>
              <div className="row">
                <button className="btn btn-primary" disabled={joining || short} onClick={() => void join()}>{joinLabel}</button>
                <button className="btn btn-ghost" onClick={() => setConfirmJoin(false)}>그만두기</button>
              </div>
            </div>
          ) : (
            <>
              <button className="btn btn-primary" disabled={joining || short} onClick={() => setConfirmJoin(true)}>{joinLabel}</button>
              {short && <p className="form-error">골드가 부족해요 · 내 골드 {formatGold(balance ?? 0)}</p>}
            </>
          )
        ) : (
          <button className="btn btn-primary" disabled={joining} onClick={() => void join()}>참가</button>
        )
      )}

      {contest.visibility === 'invite' && code && phase !== 'cancelled' && phase !== 'ended' && <InviteLink code={code} />}

      {/* 넓은 화면: 왼쪽 문제, 오른쪽 순위. 취소된 대회는 둘 다 없으므로 빈 칸을 남기지 않는다 */}
      {phase !== 'cancelled' && (
        <div className="split">
          <section className="stack" aria-label="문제">
            <h3 className="section-title">문제</h3>
            <ul className="list">
              {items.map((it) => {
                const label = `${it.position}번 ${gameName(it.game_id)}`
                return (
                  <li key={it.id} className="list-row">
                    {phase === 'live' && joined ? (
                      <Link to={`/contests/${id}/${it.position}`}>{label}</Link>
                    ) : (
                      <span>{label}</span>
                    )}
                    {phase === 'ended' && <pre className="reveal">{revealText(it)}</pre>}
                  </li>
                )
              })}
            </ul>
          </section>

          {(phase === 'live' || phase === 'ended') && (
            <section className="stack" aria-label="순위">
              <h3 className="section-title">{phase === 'live' ? '실시간 순위' : '최종 순위'}</h3>
              {phase === 'ended' && settling && <p className="muted" role="status">상금을 정산하는 중이에요</p>}
              {showPrizes && myPrize && (
                <p className="contest-prize-me">
                  내 상금 +{formatGold(myPrize.amount)}{myPrize.note ? ` (${myPrize.note})` : ''}
                </p>
              )}
              {lbError ? (
                <div className="stack" role="alert">
                  <p className="form-error">순위를 불러오지 못했어요</p>
                  <button className="btn btn-primary" onClick={() => setLbAttempt((n) => n + 1)}>다시 시도</button>
                </div>
              ) : lb.length === 0 ? (
                <p className="muted">아직 기록이 없어요</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>순위</th><th>아이디</th><th>점수</th><th>푼 문제</th>{showPrizes && <th>상금</th>}</tr>
                  </thead>
                  <tbody>
                    {lb.map((r) => (
                      <tr key={r.user_id} className={r.user_id === me ? 'me' : undefined}>
                        <td>{r.rank}</td><td>{r.handle ?? '(알 수 없음)'}</td><td>{r.score}</td><td>{r.solved_items}</td>
                        {showPrizes && (
                          <td className="prize-cell">{prizeOf.has(r.user_id) ? `+${formatGold(prizeOf.get(r.user_id)!.amount)}` : ''}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>
      )}

      {canCancel && (
        <button className="btn btn-ghost" onClick={() => void cancel()} onBlur={() => setConfirmCancel(false)}>
          {confirmCancel ? '정말 취소할까요?' : '대회 취소'}
        </button>
      )}
    </div>
  )
}
