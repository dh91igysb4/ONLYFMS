import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { PlayRunner } from '../games/PlayRunner.tsx'
import { syncServerTime } from './clock.ts'
import { getEntries, getItems } from './data.ts'

type State = { kind: 'loading' } | { kind: 'ready'; itemId: string } | { kind: 'error'; message: string }

export function ContestItemPage() {
  const { id = '', position = '' } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    const set = (s: State) => { if (alive) setState(s) }
    setState({ kind: 'loading' })
    ;(async () => {
      await syncServerTime()
      const [items, entries] = await Promise.all([getItems(id), getEntries(id)])
      const it = items.find((x) => x.position === Number(position))
      if (!it) return set({ kind: 'error', message: '없는 문제예요' })
      // 참가 기록이 없으면 먼저 참가시킨다(멱등). open이 403 not_joined가 되지 않게 한다.
      if (!profile?.id || !entries.includes(profile.id)) {
        try {
          await rpc('join_contest', { p_id: id })
        } catch (e) {
          const code = e instanceof ApiError ? e.code : 'network'
          // 이미 끝난 대회는 종료 화면을 보이도록 그대로 연다
          if (code !== 'contest_closed') return set({ kind: 'error', message: errorMessage(code) })
        }
      }
      set({ kind: 'ready', itemId: it.id })
    })().catch((e) => set({ kind: 'error', message: errorMessage(e instanceof ApiError ? e.code : 'network') }))
    return () => { alive = false }
  }, [id, position, profile?.id, attempt])

  if (state.kind === 'loading') return <p className="page-note" role="status">불러오는 중…</p>
  if (state.kind === 'error') {
    return (
      <div className="stack" role="alert">
        <p className="form-error">{state.message}</p>
        <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        <Link className="btn btn-ghost" to={`/contests/${id}`}>대회로 돌아가기</Link>
      </div>
    )
  }
  return (
    <div className="stack">
      <Link className="muted" to={`/contests/${id}`}>← 대회로 돌아가기</Link>
      <PlayRunner mode="server" itemId={state.itemId} onEnded={() => navigate(`/contests/${id}`)} />
    </div>
  )
}
