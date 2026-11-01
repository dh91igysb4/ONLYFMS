import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { now } from '../../../lib/serverTime.ts'
import type { ContestRow } from '../../contests/data.ts'
import { countdown, kindLabel, phaseOf } from '../../contests/format.ts'
import { useAuth } from '../../auth/AuthProvider.tsx'
import { loadUpcomingContests } from '../../games/UpcomingContests.tsx'
import { BlockFrame } from '../BlockFrame.tsx'
import { useBlockData } from '../useBlockData.ts'

/** 남은 시간은 1초마다 다시 그리기만 한다(다시 불러오지 않는다). 행이 있을 때만 마운트된다. */
function ContestList({ rows }: { rows: ContestRow[] }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const t = now()
  return (
    <ul className="home-list">
      {rows.map((c) => (
        <li key={c.id}>
          <Link to={`/contests/${c.id}`} className="card card-link">
            <div className="row">
              <span className={`badge badge-${c.kind}`}>{kindLabel(c.kind)}</span>
              <strong className="card-title">{c.title}</strong>
            </div>
            <span className="card-status">
              {phaseOf(c, t) === 'live' ? '진행 중' : `시작까지 ${countdown(Date.parse(c.starts_at) - t)}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function ContestsBlock({ title }: { title: string }) {
  const { profile } = useAuth()
  const { state, retry } = useBlockData<ContestRow[]>(() => loadUpcomingContests(profile?.id), [profile?.id])

  return (
    <BlockFrame title={title} state={state} onRetry={retry}>
      {state.kind === 'done' && (state.data.length === 0
        ? (
          <>
            <p className="muted">진행 중이거나 곧 시작하는 대회가 없어요</p>
            <div className="card-actions">
              <Link className="btn btn-ghost" to="/contests">대회 보기</Link>
            </div>
          </>
        )
        : <ContestList rows={state.data} />)}
    </BlockFrame>
  )
}
