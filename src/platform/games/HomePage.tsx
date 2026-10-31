import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '../../lib/api.ts'
import { kstDate } from '../../shared/kst.ts'
import { games } from '../../games/index.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { flush, flushOnOnline } from './freeQueue.ts'
import { UpcomingContests } from './UpcomingContests.tsx'

type DailyRow = { user_id: string; score: number }
type Status = { kind: 'loading' } | { kind: 'done'; score: number } | { kind: 'todo' } | { kind: 'error' }

function statusText(s: Status | undefined): string {
  if (!s || s.kind === 'loading') return '확인 중…'
  if (s.kind === 'done') return `오늘 ${s.score}점`
  if (s.kind === 'todo') return '아직 안 풀었어요'
  return '오늘 기록을 불러오지 못했어요'
}

export function HomePage() {
  const { profile } = useAuth()
  const visible = games.filter((g) => !g.manifest.hidden || profile?.is_admin)
  const [status, setStatus] = useState<Record<string, Status>>({})

  useEffect(() => {
    void flush()
    return flushOnOnline()
  }, [])

  useEffect(() => {
    let alive = true
    const today = kstDate(Date.now())
    for (const g of games.filter((x) => (!x.manifest.hidden || profile?.is_admin) && x.manifest.modes.daily)) {
      rpc<DailyRow[] | null>('lb_daily', { p_day: today, p_game: g.manifest.id })
        .then((rows) => {
          const mine = (rows ?? []).find((r) => r.user_id === profile?.id)
          return mine ? ({ kind: 'done', score: mine.score } as Status) : ({ kind: 'todo' } as Status)
        })
        .catch(() => ({ kind: 'error' }) as Status)
        .then((st) => {
          if (alive) setStatus((prev) => ({ ...prev, [g.manifest.id]: st }))
        })
    }
    return () => { alive = false }
  }, [profile?.id, profile?.is_admin])

  return (
    <div className="stack">
      <h2>게임 목록</h2>
      <UpcomingContests />
      {visible.length === 0 && <p className="muted">아직 열린 게임이 없어요</p>}
      {visible.map(({ manifest: m }) => (
        <article key={m.id} className="card">
          <h3 className="card-title">{m.name}</h3>
          <p className="muted">{m.description}</p>
          {m.modes.daily && <p className="card-status">{statusText(status[m.id])}</p>}
          <div className="card-actions">
            {m.modes.daily && <Link className="btn btn-primary" to={`/play/${m.id}/daily`}>데일리</Link>}
            {m.modes.free && <Link className="btn btn-ghost" to={`/play/${m.id}/free`}>자유 플레이</Link>}
          </div>
        </article>
      ))}
    </div>
  )
}
