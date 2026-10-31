import { useEffect, useMemo, useState } from 'react'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { duels } from '../../games/index.ts'
import { kstDate } from '../../shared/kst.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { normalizeHandle } from '../../shared/handle.ts'
import { duelRate } from '../leaderboard/duelFormat.ts'

type Wdl = { w: number; d: number; l: number; rate: number | null }
type Recent = {
  id: string; opponent_handle: string | null; result: 'win' | 'draw' | 'loss'
  rated: boolean; ended_at: string; my_score: number | null; opp_score: number | null
}
type GameStat = { game_id: string; rating: number; rated: Wdl; all: Wdl; recent: Recent[] }
type H2h = {
  games: { game_id: string; a_wins: number; draws: number; b_wins: number }[]
  recent: { id: string; game_id: string; result: 'win' | 'draw' | 'loss'; rated: boolean; ended_at: string; a_score: number | null; b_score: number | null }[]
}

const gameName = (id: string) => duels.find((d) => d.manifest.id === id)?.manifest.name ?? id
const RESULT = { win: '승', draw: '무', loss: '패' }
const wdlText = (w: number, d: number, l: number) => `${w}승 ${d}무 ${l}패`
/** 점수가 둘 다 있을 때만 (기권 등은 점수 없음) */
const scoreText = (x: number | null, y: number | null) => (x !== null && y !== null ? ` · ${x} : ${y}` : '')
const day = (iso: string) => kstDate(Date.parse(iso))

export function DuelSection({ handle }: { handle: string }) {
  const { profile } = useAuth()
  const me = profile?.handle ?? ''
  const mine = !!me && normalizeHandle(me) === normalizeHandle(handle)
  const [stats, setStats] = useState<GameStat[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [rankedOnly, setRankedOnly] = useState(true)
  const [opp, setOpp] = useState<string | null>(null) // null = 기본값. ''는 쓰지 않는다.

  useEffect(() => {
    let alive = true
    setError(null)
    setStats(undefined)
    rpc<GameStat[] | null>('duel_stats', { p_handle: handle, p_game: null })
      .then((s) => { if (alive) setStats(s ?? []) })
      .catch((e) => { if (alive) setError(errorMessage(e instanceof ApiError ? e.code : 'network')) })
    return () => { alive = false }
  }, [handle, attempt])

  const opponents = useMemo(() => {
    const set = new Set<string>()
    for (const g of stats ?? []) for (const r of g.recent) if (r.opponent_handle) set.add(r.opponent_handle)
    return [...set]
  }, [stats])

  // 대국 상대 쌍(A 관점). 남의 프로필의 기본값은 "나 vs 이 사람".
  const meVsThem = !mine && !!me
  const others = meVsThem ? opponents.filter((o) => o !== me) : opponents
  const choice = opp ?? (meVsThem ? '' : opponents[0] ?? null)
  const pair: [string, string] | null =
    choice === null ? null : choice === '' ? [me, handle] : meVsThem ? [handle, choice] : [me, choice]
  const [a, b] = pair ?? ['', '']

  const [h2h, setH2h] = useState<{ key: string; data: H2h | null } | null>(null)
  const [h2hError, setH2hError] = useState<string | null>(null)
  const key = pair ? `${a}|${b}` : ''
  useEffect(() => {
    if (!pair || stats === undefined) return
    let alive = true
    setH2hError(null)
    rpc<H2h | null>('duel_h2h', { p_handle_a: a, p_handle_b: b, p_game: null })
      .then((d) => { if (alive) setH2h({ key, data: d }) })
      .catch((e) => { if (alive) setH2hError(errorMessage(e instanceof ApiError ? e.code : 'network')) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stats])

  const recent = useMemo(() => {
    const all = (stats ?? []).flatMap((g) => g.recent.map((r) => ({ ...r, game_id: g.game_id })))
    return all
      .filter((r) => !rankedOnly || r.rated)
      .sort((x, y) => (x.ended_at < y.ended_at ? 1 : x.ended_at > y.ended_at ? -1 : 0))
      .slice(0, 20)
  }, [stats, rankedOnly])

  const h2hData = h2h && h2h.key === key ? h2h.data : null

  return (
    <>
      <h3 className="section-title">대전</h3>
      {error && (
        <div className="stack" role="alert">
          <p className="form-error">{error}</p>
          <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </div>
      )}
      {!error && stats === undefined && <p className="page-note" role="status">불러오는 중…</p>}
      {!error && stats && stats.length === 0 && <p className="muted">아직 대전 기록이 없어요</p>}
      {!error && stats && stats.length > 0 && (
        <>
          <div className="row" aria-label="집계 범위">
            {([[true, '랭크만'], [false, '전체']] as [boolean, string][]).map(([v, label]) => (
              <button key={label} className={`btn ${rankedOnly === v ? 'btn-primary' : 'btn-ghost'}`}
                aria-pressed={rankedOnly === v} onClick={() => setRankedOnly(v)}>
                {label}
              </button>
            ))}
          </div>
          {stats.map((g) => {
            const s = rankedOnly ? g.rated : g.all
            return (
              <section key={g.game_id} className="card">
                <span className="card-title">{gameName(g.game_id)}</span>
                <p>레이팅 <strong>{g.rating}</strong></p>
                <p>{wdlText(s.w, s.d, s.l)}</p>
                <p>승률 <span>{duelRate(s.w, s.d, s.l)}</span></p>
              </section>
            )
          })}
          <h4 className="section-title">최근 대국</h4>
          {recent.length === 0 ? <p className="muted">아직 대국이 없어요</p> : (
            <ul className="list" aria-label="최근 대국">
              {recent.map((r) => (
                <li key={r.id} className="list-row">
                  {/* 한 덩어리로 감싸야 세로 flex 행에서 배지가 가로로 늘어나지 않는다 */}
                  <span><span className="badge">{RESULT[r.result]}</span> {gameName(r.game_id)} · vs {r.opponent_handle ?? '알 수 없음'} {scoreText(r.my_score, r.opp_score)} · {day(r.ended_at)}{r.rated ? '' : ' · 친선'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!error && stats && (pair || (opponents.length > 0 && !meVsThem)) && (
        <>
          <h4 className="section-title">상대 전적</h4>
          <label className="field">
            <span className="muted">상대</span>
            <select className="input" value={choice ?? ''} onChange={(e) => setOpp(e.target.value)}>
              {meVsThem && <option value="">나 vs {handle}</option>}
              {others.map((o) => <option key={o} value={o}>{meVsThem ? `${handle} vs ${o}` : o}</option>)}
            </select>
          </label>
          {h2hError && <p className="form-error" role="alert">{h2hError}</p>}
          {!h2hError && pair && !h2hData && <p className="page-note" role="status">불러오는 중…</p>}
          {!h2hError && h2hData && (
            h2hData.games.length === 0 ? <p className="muted">{a} vs {b} 대국 기록이 없어요</p> : (
              <>
                <p className="muted">{a} 기준</p>
                <ul className="list">
                  {h2hData.games.map((g) => (
                    <li key={g.game_id} className="list-row">{gameName(g.game_id)} · {wdlText(g.a_wins, g.draws, g.b_wins)}</li>
                  ))}
                </ul>
                <ul className="list" aria-label="최근 상대 대국">
                  {h2hData.recent.map((r) => (
                    <li key={r.id} className="list-row">
                      <span><span className="badge">{RESULT[r.result]}</span> {gameName(r.game_id)} {scoreText(r.a_score, r.b_score)} · {day(r.ended_at)}{r.rated ? '' : ' · 친선'}</span>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
        </>
      )}
    </>
  )
}
