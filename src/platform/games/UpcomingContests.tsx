import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { now } from '../../lib/serverTime.ts'
import { syncServerTime } from '../contests/clock.ts'
import { getMyContestIds, listContests, type ContestRow } from '../contests/data.ts'
import { countdown, kindLabel, phaseOf } from '../contests/format.ts'
import { useAuth } from '../auth/AuthProvider.tsx'

const DAY = 24 * 3_600_000

// 진행 중이거나 24시간 안에 시작하는 대회 최대 3개. 공개 대회이거나 이미 참가한 대회만.
export async function loadUpcomingContests(profileId: string | undefined): Promise<ContestRow[]> {
  await syncServerTime()
  const t = now()
  const [all, mine] = await Promise.all([
    listContests(t),
    profileId ? getMyContestIds(profileId) : Promise.resolve(new Set<string>()),
  ])
  return all
    .filter((c) => {
      if (c.cancelled_at) return false
      const p = phaseOf(c, t)
      const soon = p === 'lobby' && Date.parse(c.starts_at) - t <= DAY
      return (p === 'live' || soon) && (c.visibility === 'public' || mine.has(c.id))
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, 3)
}

export function UpcomingContests() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<ContestRow[]>([])
  const [, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    loadUpcomingContests(profile?.id)
      .then((pick) => { if (alive) setRows(pick) })
      .catch(() => { /* 홈 화면은 대회 목록을 못 불러와도 게임 목록은 보여 준다 */ })
    return () => { alive = false }
  }, [profile?.id])

  useEffect(() => {
    if (rows.length === 0) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [rows.length])

  if (rows.length === 0) return null
  const t = now()
  return (
    <section className="fm-panel split-side" aria-label="진행 중·곧 시작 대회">
      <h3 className="fm-panel-head">진행 중·곧 시작 대회<Link to="/contests" aria-label="전체 대회">전체 ›</Link></h3>
      {rows.map((c) => (
        <Link key={c.id} to={`/contests/${c.id}`} className="fm-row">
          <span className={`badge badge-${c.kind}`}>{kindLabel(c.kind)}</span>
          <span className="fm-row-main">
            <span className="fm-row-title">{c.title}</span>
            <span className="fm-row-sub">
              {phaseOf(c, t) === 'live' ? '진행 중' : `시작까지 ${countdown(Date.parse(c.starts_at) - t)}`}
            </span>
          </span>
          <span className="fm-row-go" aria-hidden="true">›</span>
        </Link>
      ))}
    </section>
  )
}
