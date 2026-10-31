import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.ts'
import { errorMessage } from '../../lib/api.ts'
import { safeRedirect } from './redirect.ts'
import { Brand } from '../layout/Brand.tsx'

export function LoginPage() {
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const redirect = safeRedirect(params.get('redirect'))

  async function login() {
    setError(null)
    try {
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${location.origin}/welcome?redirect=${encodeURIComponent(redirect)}` },
      })
      if (e) setError(errorMessage('network'))
    } catch {
      setError(errorMessage('network'))
    }
  }

  return (
    <main className="auth-page">
      <Brand />
      <p className="muted">축구 퀴즈를 친구들과 함께</p>
      <button className="btn btn-primary" onClick={login}>구글로 로그인</button>
      {error && <p role="alert" className="form-error">{error}</p>}
    </main>
  )
}
