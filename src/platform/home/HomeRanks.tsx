// 메인 오늘 순위 판(FM 개편 설계 §4.4 홈): 오늘 전체 데일리 위 3명 + 4위 밖이면 내 줄.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.tsx'
import { loadTodayTop, type RankRow } from './shortcuts.ts'

type State = { top: RankRow[]; me: RankRow | null } | undefined | 'fail'

export function HomeRanks() {
  const { profile } = useAuth()
  const uid = profile?.id
  const [data, setData] = useState<State>(undefined)

  useEffect(() => {
    if (!uid) return
    let alive = true
    setData(undefined)
    loadTodayTop(uid).then((d) => { if (alive) setData(d) }, () => { if (alive) setData('fail') })
    return () => { alive = false }
  }, [uid])

  const rows = data && data !== 'fail' ? [...data.top, ...(data.me ? [data.me] : [])] : []
  return (
    <section className="fm-panel" aria-label="오늘 순위">
      <h3 className="fm-panel-head">오늘 순위<Link to="/leaderboard" aria-label="전체 순위">전체 ›</Link></h3>
      {data === 'fail' && <p className="fm-empty">불러오지 못했어요</p>}
      {data && data !== 'fail' && rows.length === 0 && <p className="fm-empty">아직 오늘 기록이 없어요</p>}
      {rows.length > 0 && (
        <table className="fm-table">
          <thead><tr><th className="num">#</th><th>이름</th><th className="num">점수</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className={r.user_id === uid ? 'is-me' : undefined}>
                <td className="num">{r.rank}</td><td>{r.handle}</td><td className="num">{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
