import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, errorMessage } from '../../lib/api.ts'
import { now } from '../../lib/serverTime.ts'
import { syncServerTime } from './clock.ts'
import { getEntryCounts, listContests, type ContestRow } from './data.ts'
import { feeOf as rawFee } from './fee.ts'
import { walletEnabled } from '../wallet/enabled.ts'
import { formatGold } from '../wallet/format.ts'
import '../wallet/wallet.css'

// 지갑이 보이기 전에는 참가비를 보이지 않는다
const feeOf = (c: ContestRow) => (walletEnabled() ? rawFee(c) : 0)
import { kindLabel, kstLabel, phaseOf } from './format.ts'

function Section({ title, rows, empty, counts }: { title: string; rows: ContestRow[]; empty: string; counts: Map<string, number> }) {
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
          {feeOf(c) > 0 && (
            <span className="contest-fee">
              참가비 <strong>{formatGold(feeOf(c))}</strong>
              {counts.has(c.id) && <> · 모인 돈 <strong>{formatGold(feeOf(c) * counts.get(c.id)!)}</strong></>}
            </span>
          )}
        </Link>
      ))}
    </section>
  )
}

export function ContestListPage() {
  const [rows, setRows] = useState<ContestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [counts, setCounts] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    let alive = true
    setError(null)
    ;(async () => {
      await syncServerTime()
      const r = await listContests(now())
      if (alive) setRows(r)
      // 참가비 대회만 참가자 수를 읽어 모인 돈을 보인다(실패해도 목록은 그대로)
      const feeIds = r.filter((c) => feeOf(c) > 0 && !c.cancelled_at).map((c) => c.id)
      if (feeIds.length > 0) {
        const m = await getEntryCounts(feeIds)
        if (alive) setCounts(m)
      }
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
          <Section title="진행 중" rows={live} counts={counts} empty="진행 중인 대회가 없어요" />
          <Section title="예정" rows={upcoming} counts={counts} empty="예정된 대회가 없어요" />
          <Section title="종료" rows={ended} counts={counts} empty="최근 30일 안에 끝난 대회가 없어요" />
        </div>
      )}
    </div>
  )
}
