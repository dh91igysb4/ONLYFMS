import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'

export function JoinPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const started = useRef(-1)

  useEffect(() => {
    if (started.current === attempt) return // StrictMode 중복 호출 방지
    started.current = attempt
    setError(null)
    rpc<string>('join_by_invite_code', { p_code: code })
      .then((id) => navigate(`/contests/${id}`, { replace: true }))
      .catch((e) => setError(errorMessage(e instanceof ApiError ? e.code : 'network')))
  }, [code, attempt, navigate])

  if (!error) return <p className="page-note" role="status">참가하는 중…</p>
  return (
    <div className="stack" role="alert">
      <p className="form-error">{error}</p>
      <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
      <Link className="btn btn-ghost btn-link" to="/contests">대회 목록</Link>
    </div>
  )
}
