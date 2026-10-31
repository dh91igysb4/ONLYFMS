import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { games } from '../../games/index.ts'
import { now } from '../../lib/serverTime.ts'
import { kstDate, kstWeekStart } from '../../shared/kst.ts'
import { useAuth } from '../auth/AuthProvider.tsx'

type Tab = 'daily' | 'week' | 'all' | 'contests' | 'free'
const TABS: { id: Tab; label: string }[] = [
  { id: 'daily', label: '오늘' },
  { id: 'week', label: '주간' },
  { id: 'all', label: '전체' },
  { id: 'contests', label: '대회' },
  { id: 'free', label: '자유 플레이' },
]

type ScoreRow = { rank: number; user_id: string; handle: string; score: number; action_count: number; finished_at: string | null }
type ContestsData = {
  contests: { contest_id: string; title: string; ends_at: string; podium: { handle: string; score: number }[] }[]
  totals: { user_id: string; handle: string; total: number }[]
}
type FreeRow = { user_id: string; handle: string; plays: number; wins: number; win_rate: number; current_streak: number; best_streak: number | null; avg_score: number }
type Sort = 'wins' | 'rate' | 'plays'
type Data = { tab: Tab; rows: ScoreRow[] | FreeRow[] | ContestsData }

export const pct = (r: number) => `${Math.round(r * 1000) / 10}%`

function sortFree(rows: FreeRow[], s: Sort): FreeRow[] {
  const by = {
    wins: (a: FreeRow, b: FreeRow) => b.wins - a.wins || b.win_rate - a.win_rate,
    rate: (a: FreeRow, b: FreeRow) => b.win_rate - a.win_rate || b.wins - a.wins,
    plays: (a: FreeRow, b: FreeRow) => b.plays - a.plays || b.wins - a.wins,
  }[s]
  return [...rows].sort(by)
}

function Handle({ handle }: { handle: string }) {
  return <Link to={`/u/${handle}`}>{handle}</Link>
}

export function LeaderboardPage() {
  const { profile } = useAuth()
  const myId = profile?.id
  const [tab, setTab] = useState<Tab>('daily')
  const [game, setGame] = useState('')
  const [sort, setSort] = useState<Sort>('wins')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const visible = games.filter((g) => !g.manifest.hidden || profile?.is_admin)

  useEffect(() => {
    let alive = true
    setError(null)
    setData(null)
    const today = kstDate(now())
    const p_game = game || null
    const call = async (): Promise<Data['rows']> => {
      switch (tab) {
        case 'daily': return rpc<ScoreRow[]>('lb_daily', { p_day: today, p_game })
        case 'week': return rpc<ScoreRow[]>('lb_range', { p_from: kstWeekStart(today), p_to: today, p_game })
        case 'all': return rpc<ScoreRow[]>('lb_range', { p_from: '2000-01-01', p_to: today, p_game })
        case 'contests': return rpc<ContestsData>('lb_contests', { p_from: '2000-01-01', p_to: today })
        case 'free': return rpc<FreeRow[]>('lb_free', { p_game })
      }
    }
    call()
      .then((rows) => { if (alive) setData({ tab, rows }) })
      .catch((e) => { if (alive) setError(errorMessage(e instanceof ApiError ? e.code : 'network')) })
    return () => { alive = false }
  }, [tab, game, attempt])

  const ready = data && data.tab === tab ? data.rows : null
  const freeRows = useMemo(() => (tab === 'free' && Array.isArray(ready) ? sortFree(ready as FreeRow[], sort) : []), [tab, ready, sort])
  const meCls = (id: string) => (id === myId ? 'me' : undefined)

  return (
    <div className="stack">
      <h2 className="page-title">리더보드</h2>
      <div className="row" role="tablist" aria-label="기간">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab !== 'contests' && (
        <label className="field">
          <span className="muted">게임</span>
          <select className="input" value={game} onChange={(e) => setGame(e.target.value)}>
            <option value="">전체 합계</option>
            {visible.map((g) => <option key={g.manifest.id} value={g.manifest.id}>{g.manifest.name}</option>)}
          </select>
        </label>
      )}
      {tab === 'free' && (
        <div className="row" aria-label="정렬">
          {([['wins', '정답 수'], ['rate', '정답률'], ['plays', '플레이 수']] as [Sort, string][]).map(([id, label]) => (
            <button key={id} className={`btn ${sort === id ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={sort === id} onClick={() => setSort(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="stack" role="alert">
          <p className="form-error">{error}</p>
          <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </div>
      )}
      {!error && !ready && <p className="page-note" role="status">불러오는 중…</p>}
      {!error && ready && (tab === 'daily' || tab === 'week' || tab === 'all') && (
        (ready as ScoreRow[]).length === 0 ? <p className="muted">아직 기록이 없어요</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>순위</th><th>아이디</th><th>점수</th><th>행동</th></tr></thead>
              <tbody>
                {(ready as ScoreRow[]).map((r) => (
                  <tr key={r.user_id} className={meCls(r.user_id)}>
                    <td>{r.rank}</td><td><Handle handle={r.handle} /></td><td>{r.score}</td><td>{r.action_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {!error && ready && tab === 'contests' && <ContestsView data={ready as ContestsData} myId={myId} />}
      {!error && ready && tab === 'free' && (
        freeRows.length === 0 ? <p className="muted">아직 기록이 없어요</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>아이디</th><th>플레이</th><th>정답</th><th>정답률</th><th>평균</th>
                  {game && <><th>연속</th><th>최고 연속</th></>}
                </tr>
              </thead>
              <tbody>
                {freeRows.map((r) => (
                  <tr key={r.user_id} className={meCls(r.user_id)}>
                    <td><Handle handle={r.handle} /></td><td>{r.plays}</td><td>{r.wins}</td>
                    <td>{pct(r.win_rate)}</td><td>{r.avg_score}</td>
                    {game && <><td>{r.current_streak}</td><td>{r.best_streak ?? '-'}</td></>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function ContestsView({ data, myId }: { data: ContestsData; myId?: string }) {
  if (data.contests.length === 0 && data.totals.length === 0) return <p className="muted">아직 공식 대회 기록이 없어요</p>
  return (
    <>
      <h3 className="section-title">공식 대회 시상대</h3>
      {data.contests.map((c) => (
        <div key={c.contest_id} className="card">
          <Link to={`/contests/${c.contest_id}`} className="card-title">{c.title}</Link>
          <ol className="list">
            {c.podium.map((p, i) => (
              <li key={p.handle} className="list-row">{i + 1}위 <Handle handle={p.handle} /> · {p.score}점</li>
            ))}
          </ol>
        </div>
      ))}
      <h3 className="section-title">누적 점수</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>순위</th><th>아이디</th><th>합계</th></tr></thead>
          <tbody>
            {data.totals.map((t, i) => (
              <tr key={t.user_id} className={t.user_id === myId ? 'me' : undefined}>
                <td>{i + 1}</td><td><Handle handle={t.handle} /></td><td>{t.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
