import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  const [focused, setFocused] = useState(false)
  const sortId = useId()
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

  // 위에서 대상을 골랐으면 그 대상으로 올린다. 올릴 대상 선택은 '전체'일 때만 보인다
  const target = filter ?? draftTarget ?? targets[0].id
  const canPost = body.trim().length >= MIN_LEN && !posting
  // 입력칸은 처음 1줄, 누르거나 글자가 있으면 4줄로 펼치고 올리기 버튼을 보인다
  const open = focused || body.length > 0

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
      <h2 className="page-title sr-only">제안</h2>

      <div className="suggest-bar">
        <span className="suggest-target">
          <select aria-label="대상" value={filter ?? ''} onChange={(e) => setFilter(e.target.value || null)}>
            <option value="">전체</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </span>
        <span className="fm-seg" role="radiogroup" aria-label="정렬">
          {([['new', '최신'], ['votes', '공감순']] as [Sort, string][]).map(([v, label]) => (
            <Fragment key={v}>
              <input type="radio" id={`${sortId}-${v}`} name="suggest-sort" checked={sort === v} onChange={() => setSort(v)} />
              <label htmlFor={`${sortId}-${v}`}>{label}</label>
            </Fragment>
          ))}
        </span>
      </div>

      <form className="fm-panel suggest-form" onSubmit={(e) => { e.preventDefault(); if (canPost) void submit() }}>
        <div className="suggest-compose">
          {filter === null && (
            <select className="input suggest-draft-target" aria-label="올릴 대상" value={target} onChange={(e) => setDraftTarget(e.target.value)}>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <textarea
            className="input"
            aria-label="제안 내용"
            rows={open ? 4 : 1}
            value={body}
            maxLength={MAX_LEN}
            placeholder="어떤 게임에 뭘 바꾸면 좋을지 적어줘"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        {postError && <p className="form-error" role="alert">{postError}</p>}
        {open && (
          <div className="suggest-actions">
            <span className="muted">{body.trim().length}/{MAX_LEN}</span>
            {/* 누르는 순간 입력칸이 blur돼도 버튼이 사라지지 않게 mousedown 기본 동작을 막는다 */}
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canPost} onMouseDown={(e) => e.preventDefault()}>올리기</button>
          </div>
        )}
      </form>

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
        <section className="fm-panel">
        <h3 className="fm-panel-head">제안 {shown.length}개</h3>
        <ul className="suggest-list" aria-label="제안 목록">
          {shown.map((s) => (
            <li key={s.id} id={itemDomId(s.id)} tabIndex={-1} className="suggest-item">
              <div className="suggest-meta">
                <span>{targetName(s.target)}</span>
                <span className={`suggest-status is-${s.status}`}>{STATUS_LABEL[s.status]}</span>
              </div>
              <p className="suggest-body">{s.body}</p>
              {s.publicReason && <p className="suggest-reason">{s.publicReason}</p>}
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
        </section>
      )}
    </div>
  )
}
