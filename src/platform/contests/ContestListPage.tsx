import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, errorMessage } from '../../lib/api.ts'
import { now } from '../../lib/serverTime.ts'
import { syncServerTime } from './clock.ts'
import { listContests, type ContestRow } from './data.ts'
import { kindLabel, kstLabel, phaseOf } from './format.ts'

function Section({ title, rows, empty }: { title: string; rows: ContestRow[]; empty: string }) {
  return (
    <section className="stack" aria-label={title}>
      <h3 className="section-title">{title}</h3>
      {rows.length === 0 && <p className="muted">{empty}</p>}
      {rows.map((c) => (
        <Link key={c.id} to={`/contests/${c.id}`} className="card card-link">
          <div className="row">
            <span className={`badge badge-${c.kind}`}>{kindLabel(c.kind)}</span>
            {c.visibility === 'invite' && <span className="badge">초대</span>}
          </div>
          <strong className="card-title">{c.title}</strong>
          <span className="muted">{kstLabel(c.starts_at)}</span>
        </Link>
      ))}
    </section>
  )
}

export function ContestListPage() {
  const [rows, setRows] = useState<ContestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    ;(async () => {
      await syncServerTime()
      const r = await listContests(now())
      if (alive) setRows(r)
    })().catch((e) => { if (alive) setError(errorMessage(e instanceof ApiError ? e.code : 'network')) })
    return () => { alive = false }
  }, [attempt])

  const t = now()
  const active = (rows ?? []).filter((c) => !c.cancelled_at)
  const live = active.filter((c) => phaseOf(c, t) === 'live')
  const upcoming = active.filter((c) => phaseOf(c, t) === 'lobby')
  const ended = active.filter((c) => phaseOf(c, t) === 'ended').sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at))

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="page-title">대회</h2>
        <Link className="btn btn-primary btn-link" to="/contests/new">대회 만들기</Link>
      </div>
      {error && (
        <div className="stack" role="alert">
          <p className="form-error">{error}</p>
          <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </div>
      )}
      {!error && rows === null && <p className="page-note" role="status">불러오는 중…</p>}
      {rows && (
        <div className="split split-3">
          <Section title="진행 중" rows={live} empty="진행 중인 대회가 없어요" />
          <Section title="예정" rows={upcoming} empty="예정된 대회가 없어요" />
          <Section title="종료" rows={ended} empty="최근 30일 안에 끝난 대회가 없어요" />
        </div>
      )}
    </div>
  )
}
