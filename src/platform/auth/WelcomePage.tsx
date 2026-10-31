import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from './AuthProvider.tsx'
import { Loading, ProfileRetry } from './Guard.tsx'
import { safeRedirect } from './redirect.ts'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { supabase } from '../../lib/supabase.ts'
import { Brand } from '../layout/Brand.tsx'

export const HANDLE_RE = /^[a-z0-9_]{3,16}$/
export const normalizeHandle = (s: string) => s.trim().toLowerCase()

export function WelcomePage() {
  const { session, profile, loading, error: loadError, refresh } = useAuth()
  const [params] = useSearchParams()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const redirect = safeRedirect(params.get('redirect'))

  // 승인 대기 중에는 가끔 다시 확인해 승인되면 바로 넘어간다.
  useEffect(() => {
    if (!session || profile?.status !== 'pending' || !profile.handle) return
    const t = setInterval(() => void refresh(), 15000)
    return () => clearInterval(t)
  }, [session, profile, refresh])

  if (loading) return <Loading />
  if (!session) return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  if (!profile && loadError) return <ProfileRetry />
  if (profile?.handle && profile.status === 'approved') return <Navigate to={redirect} replace />

  const normalized = normalizeHandle(input)
  const valid = HANDLE_RE.test(normalized)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await rpc<string>('set_handle', { new_handle: normalized })
      await refresh()
    } catch (err) {
      setError(errorMessage(err instanceof ApiError ? err.code : 'unknown'))
    } finally {
      setBusy(false)
    }
  }

  const logout = <button className="btn btn-ghost" onClick={() => void supabase.auth.signOut()}>로그아웃</button>

  if (!profile?.handle) {
    return (
      <main className="auth-page">
        <Brand />
        <h2>아이디를 정해 주세요</h2>
        <form onSubmit={submit} className="stack">
          <label htmlFor="handle">아이디</label>
          <input
            id="handle"
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            maxLength={40}
          />
          {input.trim() !== '' && <p className="muted">저장될 아이디: {normalized}</p>}
          <p className="muted">영문 소문자, 숫자, _ 로 3~16자 (한 번 정하면 바꿀 수 없어요)</p>
          <button className="btn btn-primary" type="submit" disabled={!valid || busy}>아이디 정하기</button>
          {error && <p role="alert" className="form-error">{error}</p>}
        </form>
        {logout}
      </main>
    )
  }

  return (
    <main className="auth-page">
      <Brand />
      {profile.status === 'rejected' ? (
        <p>가입이 승인되지 않았어요. 문의는 관리자에게 해 주세요.</p>
      ) : (
        <p>가입 신청이 접수됐어요. 관리자가 승인하면 바로 이용할 수 있어요.</p>
      )}
      <p className="muted">아이디: {profile.handle}</p>
      {logout}
    </main>
  )
}
