import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, duel, duelErrorMessage, rpc } from '../../lib/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import type { DuelList } from './data.ts'

/**
 * 409 own_match는 대국 id를 싣지 않는다. 내가 만든 대기 대국들의 초대 코드를 확인해 그 대국을 찾는다.
 * own_match는 대기 중인 대국에서만 나오므로(handler.ts join) 내 대기 대국 중에 있다.
 */
async function findOwnMatch(code: string, myId: string | undefined): Promise<string | null> {
  const list = await rpc<DuelList>('duel_list')
  const mine = (list?.mine ?? []).filter((m) => m.status === 'waiting' && m.players[0]?.id === myId)
  for (const m of mine) {
    const c = await rpc<string | null>('duel_invite_code', { p_match: m.id })
    if (c && c.toLowerCase() === code.trim().toLowerCase()) return m.id
  }
  return null
}

export function DuelJoinPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [error, setError] = useState<{ code: string; text: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const started = useRef(-1)

  useEffect(() => {
    if (started.current === attempt) return // StrictMode 중복 호출 방지
    started.current = attempt
    setError(null)
    duel({ action: 'join', code })
      .then((v) => navigate(`/duel/${v.match_id}`, { replace: true }))
      .catch(async (e) => {
        const c = e instanceof ApiError ? e.code : 'network'
        if (c === 'own_match') {
          // 자기 대국 링크: 그 대국 화면으로
          const id = await findOwnMatch(code, profile?.id).catch(() => null)
          if (id) return navigate(`/duel/${id}`, { replace: true })
        }
        setError({ code: c, text: duelErrorMessage(c) })
      })
  }, [code, attempt, navigate, profile?.id])

  if (!error) return <p className="page-note" role="status">참가하는 중…</p>
  // 이미 시작했거나 끝난 대국·취소된 대국·자기 대국은 다시 시도해도 같다
  const retryable = !['full', 'not_waiting', 'own_match'].includes(error.code)
  return (
    <div className="stack" role="alert">
      <p className="form-error">{error.text}</p>
      {retryable && <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>}
      <Link className="btn btn-ghost btn-link" to="/duel">대전 탭으로</Link>
    </div>
  )
}
