import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useFreeQueueFlush } from '../games/freeQueue.ts'
import { Brand } from './Brand.tsx'
import { UserMenu } from './UserMenu.tsx'

export function Layout() {
  const { profile } = useAuth()
  useFreeQueueFlush()
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
            {profile?.is_admin && <NavLink to="/admin">관리자</NavLink>}
          </nav>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
