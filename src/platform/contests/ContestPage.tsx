import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { now } from '../../lib/serverTime.ts'
import { getGame } from '../../games/index.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { syncServerTime } from './clock.ts'
import { getContest, getEntries, getItems, type ContestRow, type ItemRow } from './data.ts'
import { countdown, kindLabel, kstLabel, phaseOf } from './format.ts'
import { InviteLink } from './InviteLink.tsx'

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [, setTick] = useState(0)
  const autoJoinTried = useRef(false)

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
    const fetchLb = () =>
      rpc<LbRow[] | null>('lb_contest', { p_contest: id })
        .then((rows) => { if (alive) setLb(rows ?? []) })
        .catch(() => {})
    void fetchLb()
    if (phase === 'ended') {
      getItems(id).then((its) => { if (alive) setItems(its) }).catch(() => {})
      return () => { alive = false }
    }
    const t = setInterval(() => void fetchLb(), POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [phase, id])

  const join = useCallback(async () => {
    if (!me) return
    setJoining(true)
    setActionError(null)
    try {
      await rpc('join_contest', { p_id: id })
      setEntries((prev) => (prev.includes(me) ? prev : [...prev, me]))
    } catch (e) {
      setActionError(errorMessage(codeOf(e)))
    } finally {
      setJoining(false)
    }
  }, [id, me])

  // 진행 중인 공개 대회는 참가 버튼 없이 들어와도 403이 나지 않게 먼저 참가시킨다.
  useEffect(() => {
    if (!contest || phase !== 'live' || contest.visibility !== 'public' || joined || autoJoinTried.current) return
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
        <p className="notice">대회를 찾을 수 없어요</p>
        <Link className="btn btn-ghost" to="/contests">대회 목록</Link>
      </div>
    )
  }

  const canJoinWithoutCode = contest.visibility === 'public' || isCreator || isAdmin
  const inviteOnly = !joined && !canJoinWithoutCode && phase !== 'cancelled' && phase !== 'ended'
  const canCancel = (phase === 'lobby' && (isCreator || isAdmin)) || (phase === 'live' && isAdmin)
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

      {phase === 'cancelled' && <p className="notice">취소된 대회예요</p>}

      {phase === 'lobby' && (
        <>
          <p className="countdown">시작까지 {countdown(startMs - now())}</p>
          <p className="muted">참가자 {entries.length}명</p>
        </>
      )}
      {phase === 'live' && <p className="countdown">종료까지 {countdown(endMs - now())}</p>}

      {inviteOnly && <p className="notice">초대 링크로만 참가할 수 있어요</p>}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      {phase !== 'cancelled' && !joined && canJoinWithoutCode && phase !== 'ended' && (
        phase === 'live' && contest.visibility === 'public' ? (
          joining ? <p className="muted" role="status">참가하는 중…</p> : actionError ? (
            <button className="btn btn-primary" onClick={() => void join()}>다시 시도</button>
          ) : null
        ) : (
          <button className="btn btn-primary" disabled={joining} onClick={() => void join()}>참가</button>
        )
      )}

      {contest.visibility === 'invite' && code && phase !== 'cancelled' && phase !== 'ended' && <InviteLink code={code} />}

      {phase !== 'cancelled' && (
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
      )}

      {(phase === 'live' || phase === 'ended') && (
        <section className="stack" aria-label="순위">
          <h3 className="section-title">{phase === 'live' ? '실시간 순위' : '최종 순위'}</h3>
          {lb.length === 0 ? (
            <p className="muted">아직 기록이 없어요</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>순위</th><th>아이디</th><th>점수</th><th>푼 문제</th></tr>
              </thead>
              <tbody>
                {lb.map((r) => (
                  <tr key={r.user_id} className={r.user_id === me ? 'me' : undefined}>
                    <td>{r.rank}</td><td>{r.handle ?? '(알 수 없음)'}</td><td>{r.score}</td><td>{r.solved_items}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {canCancel && (
        <button className="btn btn-ghost" onClick={() => void cancel()} onBlur={() => setConfirmCancel(false)}>
          {confirmCancel ? '정말 취소할까요?' : '대회 취소'}
        </button>
      )}
    </div>
  )
}
