import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useFreeQueueFlush } from '../games/freeQueue.ts'
import { suggestionPendingCount } from '../suggest/adminApi.ts'
import { Brand } from './Brand.tsx'
import { UserMenu } from './UserMenu.tsx'

export function Layout() {
  const { profile } = useAuth()
  useFreeQueueFlush()
  const isAdmin = !!profile?.is_admin
  const { pathname } = useLocation()
  const [pending, setPending] = useState(0)
  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    suggestionPendingCount().then((n) => { if (alive) setPending(n) }).catch(() => {})
    return () => { alive = false }
  }, [isAdmin, pathname])
  return (
    <div className="layout">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="header-row">
            <Brand />
            {profile?.handle && <UserMenu handle={profile.handle} />}
          </div>
          <nav className="nav" aria-label="주 메뉴">
            <NavLink to="/" end>홈</NavLink>
            <NavLink to="/games">게임</NavLink>
            <NavLink to="/contests">대회</NavLink>
            <NavLink to="/duel">대전</NavLink>
            <NavLink to="/leaderboard">리더보드</NavLink>
            <NavLink to="/suggest">제안</NavLink>
            {isAdmin && (
              <NavLink to="/admin">
                관리자
                {pending > 0 && <> <span className="badge" aria-label={`결정 대기 제안 ${pending}건`}>{pending}</span></>}
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
