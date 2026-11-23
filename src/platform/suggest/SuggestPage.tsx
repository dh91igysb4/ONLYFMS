import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../lib/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import {
  deleteSuggestion, listSuggestions, postSuggestion, STATUS_LABEL, suggestErrorMessage, voteSuggestion,
  type Suggestion,
} from './api.ts'
import { suggestTargets, targetName } from './targets.ts'
import './suggest.css'

type Sort = 'new' | 'votes'

const MIN_LEN = 5
const MAX_LEN = 500

const msg = (e: unknown) => suggestErrorMessage(e instanceof ApiError ? e.code : 'network')
const byNewest = (a: Suggestion, b: Suggestion) => b.createdAt.localeCompare(a.createdAt)
const itemDomId = (id: string) => `suggestion-${id}`

export function SuggestPage() {
  const { profile } = useAuth()
  const targets = useMemo(() => suggestTargets(!!profile?.is_admin), [profile?.is_admin])
  const [filter, setFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('new')
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [draftTarget, setDraftTarget] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoadError(null)
    try {
      const rows = await listSuggestions(filter)
      if (mine === seq.current) setItems(rows)
    } catch (e) {
      if (mine === seq.current) setLoadError(msg(e))
    }
  }, [filter])

  useEffect(() => {
    setItems(null)
    void load()
    return () => { seq.current++ }
  }, [load])

  // 칩으로 대상을 골랐으면 그 대상으로 올린다. 대상 선택은 '전체'일 때만 보인다
  const target = filter ?? draftTarget ?? targets[0].id
  const canPost = body.trim().length >= MIN_LEN && !posting

  const shown = useMemo(() => {
    const rows = [...(items ?? [])]
    rows.sort(sort === 'votes' ? (a, b) => b.votes - a.votes || byNewest(a, b) : byNewest)
    return rows
  }, [items, sort])

  async function submit() {
    setPosting(true)
    setPostError(null)
    try {
      await postSuggestion(target, body.trim())
      setBody('')
      await load()
    } catch (e) {
      setPostError(msg(e))
    } finally {
      setPosting(false)
    }
  }

  async function toggleVote(s: Suggestion) {
    setActionError(null)
    try {
      const votes = await voteSuggestion(s.id, !s.voted)
      setItems((cur) => cur && cur.map((x) => (x.id === s.id ? { ...x, votes, voted: !s.voted } : x)))
    } catch (e) {
      setActionError(msg(e))
    }
  }

  async function remove(s: Suggestion) {
    if (confirmId !== s.id) {
      setConfirmId(s.id)
      return
    }
    setConfirmId(null)
    setActionError(null)
    try {
      await deleteSuggestion(s.id)
      setItems((cur) => cur && cur.filter((x) => x.id !== s.id))
    } catch (e) {
      setActionError(msg(e))
    }
  }

  function jumpTo(id: string) {
    const el = document.getElementById(itemDomId(id))
    if (!el) return
    el.scrollIntoView?.({ block: 'center' })
    el.focus()
  }

  const ids = new Set((items ?? []).map((s) => s.id))

  return (
    <div className="stack">
      <h2 className="page-title">제안</h2>

      <div className="suggest-chips" role="group" aria-label="대상 필터">
        <button type="button" className="btn btn-ghost btn-sm suggest-chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>전체</button>
        {targets.map((t) => (
          <button key={t.id} type="button" className="btn btn-ghost btn-sm suggest-chip" aria-pressed={filter === t.id} onClick={() => setFilter(t.id)}>
            {t.name}
          </button>
        ))}
      </div>

      <form className="card suggest-form" onSubmit={(e) => { e.preventDefault(); if (canPost) void submit() }}>
        {filter === null && (
          <label className="suggest-field">
            대상
            <select className="input" value={target} onChange={(e) => setDraftTarget(e.target.value)}>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <label className="suggest-field">
          제안 내용
          <textarea
            className="input"
            value={body}
            maxLength={MAX_LEN}
            placeholder="어떤 게임에 뭘 바꾸면 좋을지 적어줘"
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {postError && <p className="form-error" role="alert">{postError}</p>}
        <div className="card-actions">
          <button type="submit" className="btn btn-primary" disabled={!canPost}>올리기</button>
        </div>
      </form>

      <div className="row between">
        <div className="suggest-sort" role="group" aria-label="정렬">
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={sort === 'new'} onClick={() => setSort('new')}>최신</button>
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={sort === 'votes'} onClick={() => setSort('votes')}>공감순</button>
        </div>
      </div>

      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      {loadError ? (
        <div className="stack">
          <p className="form-error" role="alert">{loadError}</p>
          <div><button type="button" className="btn btn-ghost" onClick={() => void load()}>다시 시도</button></div>
        </div>
      ) : items === null ? (
        <p className="muted">불러오는 중…</p>
      ) : shown.length === 0 ? (
        <p className="muted suggest-empty">아직 제안이 없어요</p>
      ) : (
        <ul className="suggest-list">
          {shown.map((s) => (
            <li key={s.id} id={itemDomId(s.id)} tabIndex={-1} className="card suggest-item">
              <div className="suggest-meta">{targetName(s.target)} · {STATUS_LABEL[s.status]}</div>
              <p className="suggest-body">{s.body}</p>
              {s.publicReason && <p className="suggest-reason">└ {s.publicReason}</p>}
              <div className="row between">
                <span className="muted">{s.handle ?? '알 수 없음'}</span>
                <div className="card-actions">
                  {s.prUrl && (
                    <a className="btn btn-ghost btn-sm btn-link" href={s.prUrl} target="_blank" rel="noreferrer">PR</a>
                  )}
                  {s.duplicateOf && ids.has(s.duplicateOf) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => jumpTo(s.duplicateOf as string)}>원 제안 보기</button>
                  )}
                  {s.canDelete && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void remove(s)}
                      onBlur={() => setConfirmId((c) => (c === s.id ? null : c))}
                    >
                      {confirmId === s.id ? '정말 삭제' : '삭제'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm suggest-vote"
                    aria-label="공감"
                    aria-pressed={s.voted}
                    onClick={() => void toggleVote(s)}
                  >
                    ▲ {s.votes}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
