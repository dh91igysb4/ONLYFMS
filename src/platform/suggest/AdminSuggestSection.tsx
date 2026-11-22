import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../lib/api.ts'
import { decideSuggestion, listAdminSuggestions, markSuggestionShipped, type AdminSuggestion } from './adminApi.ts'
import { STATUS_LABEL, suggestErrorMessage } from './api.ts'
import { targetName } from './targets.ts'
import './suggest.css'

const MAX_REASON = 200

const msg = (e: unknown) => suggestErrorMessage(e instanceof ApiError ? e.code : 'network')
const byVotes = (a: AdminSuggestion, b: AdminSuggestion) => b.votes - a.votes || b.createdAt.localeCompare(a.createdAt)

type Decide = (s: AdminSuggestion, approve: boolean, reason?: string) => Promise<void>

export function AdminSuggestSection() {
  const [items, setItems] = useState<AdminSuggestion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const rows = await listAdminSuggestions()
      if (alive.current) { setItems(rows); setLoadError(null) }
    } catch (e) {
      if (alive.current) setLoadError(msg(e))
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void load()
    return () => { alive.current = false }
  }, [load])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      setRejectingId(null)
      setReason('')
      await load()
    } catch (e) {
      if (alive.current) setActionError(msg(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const decide: Decide = (s, approve, why) => run(() => (why === undefined ? decideSuggestion(s.id, approve) : decideSuggestion(s.id, approve, why)))
  const ship = (s: AdminSuggestion) => run(() => markSuggestionShipped(s.id))

  const { pending, byTarget, progress } = useMemo(() => {
    const rows = items ?? []
    const groups = new Map<string, { recommend: AdminSuggestion[]; hold: AdminSuggestion[]; rejected: AdminSuggestion[] }>()
    const slot = (t: string) => {
      let g = groups.get(t)
      if (!g) { g = { recommend: [], hold: [], rejected: [] }; groups.set(t, g) }
      return g
    }
    let waiting = 0
    for (const s of [...rows].sort(byVotes)) {
      if (s.status === 'open' && s.verdict === null) waiting++
      else if (s.status === 'open' && s.verdict === 'recommend') slot(s.target).recommend.push(s)
      else if (s.status === 'open' && s.verdict === 'hold') slot(s.target).hold.push(s)
      else if (s.status === 'rejected') slot(s.target).rejected.push(s)
    }
    return {
      pending: waiting,
      byTarget: [...groups.entries()],
      progress: [...rows].sort(byVotes).filter((s) => s.status === 'planned' || s.status === 'design'),
    }
  }, [items])

  const empty = items !== null && pending === 0 && byTarget.length === 0 && progress.length === 0

  const row = (s: AdminSuggestion, buttons: React.ReactNode) => (
    <li key={s.id} className="suggest-admin-item">
      {s.summary && <strong>{s.summary}</strong>}
      <p className="suggest-body">{s.body}</p>
      <div className="suggest-meta">{s.handle ?? '알 수 없음'} · 공감 {s.votes}</div>
      {s.publicReason && <p className="suggest-reason">└ {s.publicReason}</p>}
      {s.note && <p className="suggest-note">주의: {s.note}</p>}
      {rejectingId === s.id ? (
        <div className="suggest-reject">
          <label className="suggest-field">
            거절 이유
            <input className="input" value={reason} maxLength={MAX_REASON} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="card-actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void decide(s, false, reason)}>거절 확정</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRejectingId(null); setReason('') }}>취소</button>
          </div>
        </div>
      ) : (
        <div className="card-actions">{buttons}</div>
      )}
    </li>
  )

  const approveBtn = (s: AdminSuggestion, label: string) => (
    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void decide(s, true)}>{label}</button>
  )
  const rejectBtn = (s: AdminSuggestion) => (
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setRejectingId(s.id); setReason('') }}>거절</button>
  )

  return (
    <section className="card stack" aria-label="제안 검토">
      <h3 className="card-title">제안 검토</h3>
      {loadError && (
        <div className="stack">
          <p className="form-error" role="alert">{loadError}</p>
          <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>다시 시도</button></div>
        </div>
      )}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {items === null && !loadError && <p className="muted">불러오는 중…</p>}
      {pending > 0 && <p className="muted">분류 대기 {pending}건</p>}
      {empty && <p className="muted">검토할 제안이 없어요</p>}

      {byTarget.map(([target, g]) => (
        <section key={target} className="stack" aria-label={targetName(target)}>
          <h4 className="suggest-admin-target">{targetName(target)}</h4>
          {g.recommend.length > 0 && (
            <div role="group" aria-label="추천" className="stack">
              <h5 className="suggest-admin-group">추천</h5>
              <ul className="suggest-list">
                {g.recommend.map((s) => row(s, <>{approveBtn(s, '승인')}{rejectBtn(s)}</>))}
              </ul>
            </div>
          )}
          {g.hold.length > 0 && (
            <div role="group" aria-label="보류 · 설계 필요" className="stack">
              <h5 className="suggest-admin-group">보류 · 설계 필요</h5>
              <ul className="suggest-list">
                {g.hold.map((s) => row(s, <>{approveBtn(s, '설계 예정으로')}{rejectBtn(s)}</>))}
              </ul>
            </div>
          )}
          {g.rejected.length > 0 && (
            <div role="group" aria-label="기각됨">
              <details>
                <summary>기각됨 {g.rejected.length}건</summary>
                <ul className="suggest-list">
                  {g.rejected.map((s) => row(s, approveBtn(s, '승인으로 뒤집기')))}
                </ul>
              </details>
            </div>
          )}
        </section>
      ))}

      {progress.length > 0 && (
        <div role="group" aria-label="진행 중" className="stack">
          <h4 className="suggest-admin-target">진행 중</h4>
          <ul className="suggest-list">
            {progress.map((s) => (
              <li key={s.id} className="suggest-admin-item">
                <div className="suggest-meta">{targetName(s.target)} · {STATUS_LABEL[s.status]}</div>
                <p className="suggest-body">{s.body}</p>
                <div className="card-actions">
                  {s.status === 'planned' && s.prUrl && (
                    <a className="btn btn-ghost btn-sm btn-link" href={s.prUrl} target="_blank" rel="noreferrer">PR</a>
                  )}
                  {s.status === 'design' && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void ship(s)}>반영됨으로 표시</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
