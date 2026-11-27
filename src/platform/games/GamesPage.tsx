import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '../../lib/api.ts'
import { kstDate } from '../../shared/kst.ts'
import { now } from '../../lib/serverTime.ts'
import { games, worlds } from '../../games/index.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { UpcomingContests } from './UpcomingContests.tsx'
import { gameSections } from './sections.ts'

type DailyRow = { user_id: string; score: number }
type Status = { kind: 'loading' } | { kind: 'done'; score: number } | { kind: 'todo' } | { kind: 'error' }

function statusText(s: Status | undefined): string {
  if (!s || s.kind === 'loading') return '확인 중…'
  if (s.kind === 'done') return `오늘 ${s.score}점`
  if (s.kind === 'todo') return '아직 안 풀었어요'
  return '오늘 기록을 불러오지 못했어요'
}

export function GamesPage() {
  const { profile } = useAuth()
  const visible = games.filter((g) => !g.manifest.hidden || profile?.is_admin)
  const visibleWorlds = worlds.filter((w) => !w.manifest.hidden || profile?.is_admin)
  const [status, setStatus] = useState<Record<string, Status>>({})
  const sections = gameSections(visible.map((g) => g.manifest), visibleWorlds.map((w) => w.manifest))

  useEffect(() => {
    let alive = true
    const today = kstDate(now()) // 서버 시계 기준 (브라우저 시계가 틀려도 같은 날짜)
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
      <h2 className="page-title">게임 목록</h2>
      {/* 넓은 화면: 왼쪽 게임 구역, 오른쪽 좁은 열에 대회 */}
      <div className="split split-aside">
        <UpcomingContests />
        {/* 주제별 구역(manifest topic): 넓은 화면은 좌우 두 칸, 휴대폰은 위아래. 구역이 하나뿐이면 제목 없이 한 칸 */}
        <div className="split split-even split-main">
          {sections.length === 0 && <p className="muted">아직 열린 게임이 없어요</p>}
          {sections.map((sec) => (
            <section key={sec.key} className="stack" aria-label={sec.title}>
              {sections.length > 1 && <h3 className="section-title">{sec.title}</h3>}
              <div className="grid-cards">
                {sec.games.map((m) => (m.category === 'world' ? (
                  <article key={m.id} className="card">
                    <h3 className="card-title">{m.name}</h3>
                    <p className="muted">{m.description}</p>
                    <div className="card-actions">
                      <Link className="btn btn-primary" to={`/world/${m.id}`}>들어가기</Link>
                    </div>
                  </article>
                ) : (
                  <article key={m.id} className="card">
                    <h3 className="card-title">{m.name}</h3>
                    <p className="muted">{m.description}</p>
                    {m.modes.daily && <p className="card-status">{statusText(status[m.id])}</p>}
                    <div className="card-actions">
                      {m.modes.daily && <Link className="btn btn-primary" to={`/play/${m.id}/daily`}>데일리</Link>}
                      {m.modes.free && <Link className="btn btn-ghost" to={`/play/${m.id}/free`}>자유 플레이</Link>}
                    </div>
                  </article>
                )))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
