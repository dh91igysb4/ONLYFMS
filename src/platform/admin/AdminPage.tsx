import { useCallback, useEffect, useState } from 'react'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { games } from '../../games/index.ts'
import { now } from '../../lib/serverTime.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { listContests, type ContestRow } from '../contests/data.ts'
import { kindLabel, kstLabel, phaseOf } from '../contests/format.ts'

const BANK_WARN_BELOW = 30

type Status = 'pending' | 'approved' | 'rejected'
const TABS: { id: Status; label: string }[] = [
  { id: 'pending', label: '대기' },
  { id: 'approved', label: '승인' },
  { id: 'rejected', label: '거절' },
]
type UserRow = { id: string; handle: string | null; email: string; status: Status; created_at: string }

const msg = (e: unknown) => errorMessage(e instanceof ApiError ? e.code : 'network')
const day = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso))

export function AdminPage() {
  return (
    <div className="stack">
      <h2 className="page-title">관리자</h2>
      <UsersSection />
      <ContestsSection />
      <BankSection />
    </div>
  )
}

function UsersSection() {
  const { profile } = useAuth()
  const myId = profile?.id
  const [tab, setTab] = useState<Status>('pending')
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    rpc<UserRow[]>('admin_list_users', { p_status: tab })
      .then((r) => { if (alive) { setRows(r ?? []); setError('') } })
      .catch((e) => { if (alive) setError(msg(e)) })
    return () => { alive = false }
  }, [tab, tick])

  const switchTab = (t: Status) => {
    setTab(t); setRows(null); setError(''); setConfirmId(null); setEditId(null)
  }

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try {
      await f()
      setConfirmId(null); setEditId(null)
      setTick((n) => n + 1)
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }
  const setStatus = (id: string, status: Status) => act(() => rpc('admin_set_status', { p_user: id, p_status: status }))

  return (
    <section className="stack" aria-label="가입 승인">
      <h3 className="section-title">가입 승인</h3>
      <div className="row" role="tablist" aria-label="상태">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => switchTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!rows && !error && <p className="page-note" role="status">불러오는 중…</p>}
      {rows && rows.length === 0 && <p className="muted">해당하는 사용자가 없어요</p>}
      {rows && rows.length > 0 && (
        <ul className="list">
          {rows.map((u) => {
            const mine = u.id === myId
            return (
              <li key={u.id} className="list-row stack">
                <div>
                  <strong>{u.handle ?? '아이디 미설정'}</strong>{' '}
                  <span className="muted">{u.email}</span>
                </div>
                <span className="muted">가입일 {day(u.created_at)}</span>
                {editId === u.id && (
                  <form className="row" onSubmit={(e) => {
                    e.preventDefault()
                    void act(() => rpc('admin_set_handle', { p_user: u.id, p_handle: handle.trim() }))
                  }}>
                    <label className="field">
                      <span className="muted">새 아이디</span>
                      <input className="input" value={handle} onChange={(e) => setHandle(e.target.value)}
                        autoCapitalize="none" autoComplete="off" />
                    </label>
                    <button className="btn btn-primary" type="submit" disabled={busy || !handle.trim()}>저장</button>
                    <button className="btn btn-ghost" type="button" onClick={() => setEditId(null)}>닫기</button>
                  </form>
                )}
                <div className="row">
                  {!mine && u.status !== 'approved' && (
                    <button className="btn btn-primary" disabled={busy} onClick={() => setStatus(u.id, 'approved')}>승인</button>
                  )}
                  {!mine && u.status !== 'rejected' && (confirmId === u.id ? (
                    <>
                      <button className="btn btn-primary" disabled={busy} onClick={() => setStatus(u.id, 'rejected')}>거절 확인</button>
                      <button className="btn btn-ghost" onClick={() => setConfirmId(null)}>그만두기</button>
                    </>
                  ) : (
                    <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmId(u.id)}>거절</button>
                  ))}
                  {editId !== u.id && (
                    <button className="btn btn-ghost" disabled={busy}
                      onClick={() => { setEditId(u.id); setHandle(u.handle ?? ''); setError('') }}>아이디 변경</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ContestsSection() {
  const [rows, setRows] = useState<ContestRow[] | null>(null)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    const t = now()
    listContests(t)
      .then((r) => {
        if (!alive) return
        setRows(r.filter((c) => c.kind !== 'daily' && ['lobby', 'live'].includes(phaseOf(c, t))))
        setError('')
      })
      .catch((e) => { if (alive) setError(msg(e)) })
    return () => { alive = false }
  }, [tick])

  const cancel = async (id: string) => {
    setBusy(true); setError('')
    try {
      await rpc('cancel_contest', { p_id: id })
      setConfirmId(null)
      setTick((n) => n + 1)
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="stack" aria-label="대회 관리">
      <h3 className="section-title">대회 관리</h3>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!rows && !error && <p className="page-note" role="status">불러오는 중…</p>}
      {rows && rows.length === 0 && <p className="muted">진행 중이거나 예정된 대회가 없어요</p>}
      {rows && rows.length > 0 && (
        <ul className="list">
          {rows.map((c) => (
            <li key={c.id} className="list-row stack">
              <div>
                <strong>{c.title}</strong> <span className="muted">{kindLabel(c.kind)}</span>
              </div>
              <span className="muted">{kstLabel(c.starts_at)} ~ {kstLabel(c.ends_at)}</span>
              <div className="row">
                {confirmId === c.id ? (
                  <>
                    <button className="btn btn-primary" disabled={busy} onClick={() => cancel(c.id)}>취소 확인</button>
                    <button className="btn btn-ghost" onClick={() => setConfirmId(null)}>그만두기</button>
                  </>
                ) : (
                  <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmId(c.id)}>취소</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type PuzzleItem = { puzzle_key: string; puzzle: Record<string, unknown> }

/** 파일 내용을 검사해 문제 배열로 바꾼다. 잘못되면 한국어 오류 문구를 던진다. */
function parsePuzzles(text: string): PuzzleItem[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('JSON 형식이 올바르지 않아요')
  }
  if (!Array.isArray(data) || data.length === 0) throw new Error('문제 배열(JSON) 형식이 올바르지 않아요')
  data.forEach((it, i) => {
    const o = it as { puzzle_key?: unknown; puzzle?: unknown } | null
    const ok = o && typeof o === 'object' && typeof o.puzzle_key === 'string' && o.puzzle_key.trim() !== '' &&
      typeof o.puzzle === 'object' && o.puzzle !== null && !Array.isArray(o.puzzle)
    if (!ok) throw new Error(`${i + 1}번째 문제의 형식이 올바르지 않아요`)
  })
  return data as PuzzleItem[]
}

function BankSection() {
  const bankGames = games.filter((g) => g.manifest.puzzleSource === 'bank')
  const [remaining, setRemaining] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState('')
  const [game, setGame] = useState(bankGames[0]?.manifest.id ?? '')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const hasBank = bankGames.length > 0

  const load = useCallback(async () => {
    try {
      const r = await rpc<{ game_id: string; remaining: number }[]>('admin_bank_status')
      setRemaining(Object.fromEntries((r ?? []).map((x) => [x.game_id, x.remaining])))
    } catch (e) {
      setError(msg(e))
    }
  }, [])
  useEffect(() => { if (hasBank) void load() }, [hasBank, load])

  const onFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return
    setError(''); setResult('')
    setBusy(true)
    try {
      const puzzles = parsePuzzles(await file.text())
      const r = await rpc<{ added: number; skipped: number }[]>('admin_upload_puzzles', { p_game: game, p_puzzles: puzzles })
      const row = r?.[0] ?? { added: 0, skipped: 0 }
      setResult(`추가 ${row.added}개, 건너뜀 ${row.skipped}개`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === 'items_invalid' ? '문제 파일의 형식이 올바르지 않아요' : msg(e)) : e instanceof Error && e.message ? e.message : msg(e))
    } finally {
      setBusy(false)
      try { input.value = '' } catch { /* 무시 */ }
    }
  }

  return (
    <section className="stack" aria-label="문제 은행">
      <h3 className="section-title">문제 은행</h3>
      {!hasBank && <p className="muted">문제 은행을 쓰는 게임이 없어요</p>}
      {hasBank && (
        <>
          <ul className="list">
            {bankGames.map((g) => {
              const n = remaining?.[g.manifest.id]
              return (
                <li key={g.manifest.id} className="list-row stack">
                  <strong>{g.manifest.name}</strong>
                  <span className="muted">{n === undefined ? '불러오는 중…' : `남은 문제 ${n}개`}</span>
                  {n !== undefined && n < BANK_WARN_BELOW && (
                    <p className="form-error" role="status">문제가 얼마 남지 않았어요. 새 문제를 올려 주세요</p>
                  )}
                </li>
              )
            })}
          </ul>
          <label className="field">
            <span className="muted">게임</span>
            <select className="input" value={game} onChange={(e) => setGame(e.target.value)}>
              {bankGames.map((g) => <option key={g.manifest.id} value={g.manifest.id}>{g.manifest.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="muted">문제 파일</span>
            <input className="input" type="file" accept=".json,application/json" disabled={busy}
              onChange={(e) => void onFile(e.currentTarget)} />
          </label>
          <p className="muted">[{'{'} "puzzle_key": "...", "puzzle": {'{'}...{'}'} {'}'}, ...] 형식의 JSON 파일</p>
          {result && <p role="status">{result}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  )
}
