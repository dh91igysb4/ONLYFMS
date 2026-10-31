import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { errorMessage } from '../../lib/api.ts'
import { useAuth } from './AuthProvider.tsx'

export function Loading() {
  return <p className="page-note" role="status">불러오는 중…</p>
}

export function ProfileRetry() {
  const { error, refresh } = useAuth()
  return (
    <div className="page-note" role="alert">
      <p>불러오지 못했어요{error ? ` — ${errorMessage(error)}` : ''}</p>
      <button className="btn btn-primary" onClick={() => void refresh()}>다시 시도</button>
    </div>
  )
}

export function RequireApproved({ children }: { children: ReactNode }) {
  const { session, profile, loading, error } = useAuth()
  const loc = useLocation()
  if (loading) return <Loading />
  const back = encodeURIComponent(loc.pathname + loc.search)
  if (!session) return <Navigate to={`/login?redirect=${back}`} replace />
  if (!profile && error) return <ProfileRetry />
  if (!profile || !profile.handle || profile.status !== 'approved') {
    return <Navigate to={`/welcome?redirect=${back}`} replace />
  }
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, loading, error } = useAuth()
  if (loading) return <Loading />
  if (!profile && error) return <ProfileRetry />
  if (!profile?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}
