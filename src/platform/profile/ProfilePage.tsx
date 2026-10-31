import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { games } from '../../games/index.ts'
import { kstDate } from '../../shared/kst.ts'
import { DuelSection } from './DuelSection.tsx'
import { pct } from '../leaderboard/LeaderboardPage.tsx'

type Stats = {
  daily_by_game: { game_id: string; days: number; avg_score: number }[]
  contests: { contest_id: string; title: string; kind: string; ends_at: string; rank: number; score: number }[]
  free_by_game: { game_id: string; plays: number; wins: number; win_rate: number; best_streak: number | null }[]
  recent: { type: 'daily' | 'contest' | 'free'; game_id: string | null; score: number; at: string }[]
}

const gameName = (id: string) => games.find((g) => g.manifest.id === id)?.manifest.name ?? id
const TYPE_LABEL = { daily: '데일리', contest: '대회', free: '자유 플레이' }

export function ProfilePage() {
  const { handle = '' } = useParams()
  const [stats, setStats] = useState<Stats | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    setStats(undefined)
    rpc<Stats | null>('user_stats', { p_handle: handle })
      .then((s) => { if (alive) setStats(s) })
      .catch((e) => { if (alive) setError(errorMessage(e instanceof ApiError ? e.code : 'network')) })
    return () => { alive = false }
  }, [handle, attempt])

  if (error) {
    return (
      <div className="stack" role="alert">
        <p className="form-error">{error}</p>
        <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
      </div>
    )
  }
  if (stats === undefined) return <p className="page-note" role="status">불러오는 중…</p>
  if (stats === null) return <p className="page-note">없는 사용자예요</p>

  return (
    <div className="stack">
      <h2 className="page-title">{handle}</h2>

      <h3 className="section-title">데일리</h3>
      {stats.daily_by_game.length === 0 ? <p className="muted">아직 기록이 없어요</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>게임</th><th>참여일</th><th>평균 점수</th></tr></thead>
            <tbody>
              {stats.daily_by_game.map((d) => (
                <tr key={d.game_id}><td>{gameName(d.game_id)}</td><td>{d.days}</td><td>{d.avg_score}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title">대회</h3>
      {stats.contests.length === 0 ? <p className="muted">참가한 대회가 없어요</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>대회</th><th>구분</th><th>순위</th><th>점수</th></tr></thead>
            <tbody>
              {stats.contests.map((c) => (
                <tr key={c.contest_id}>
                  <td><Link to={`/contests/${c.contest_id}`}>{c.title}</Link></td>
                  <td>{c.kind === 'official' ? '공식' : '친선'}</td>
                  <td>{c.rank}위</td><td>{c.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title">자유 플레이</h3>
      {stats.free_by_game.length === 0 ? <p className="muted">아직 기록이 없어요</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>게임</th><th>플레이</th><th>정답</th><th>정답률</th><th>최고 연속</th></tr></thead>
            <tbody>
              {stats.free_by_game.map((f) => (
                <tr key={f.game_id}>
                  <td>{gameName(f.game_id)}</td><td>{f.plays}</td><td>{f.wins}</td>
                  <td>{pct(f.win_rate)}</td><td>{f.best_streak ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title">최근 기록</h3>
      {stats.recent.length === 0 ? <p className="muted">아직 기록이 없어요</p> : (
        <ul className="list">
          {stats.recent.map((r, i) => (
            <li key={i} className="list-row">
              <span className="badge">{TYPE_LABEL[r.type]}</span>{' '}
              {r.game_id ? gameName(r.game_id) : ''} · {r.score}점 · {kstDate(Date.parse(r.at))}
            </li>
          ))}
        </ul>
      )}

      <DuelSection key={handle} handle={handle} />
    </div>
  )
}
