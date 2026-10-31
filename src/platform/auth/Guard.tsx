import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider.tsx'

export function Loading() {
  return <p className="page-note" role="status">불러오는 중…</p>
}

export function RequireApproved({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Loading />
  const back = encodeURIComponent(loc.pathname + loc.search)
  if (!session) return <Navigate to={`/login?redirect=${back}`} replace />
  if (!profile || !profile.handle || profile.status !== 'approved') {
    return <Navigate to={`/welcome?redirect=${back}`} replace />
  }
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) return <Loading />
  if (!profile?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}
