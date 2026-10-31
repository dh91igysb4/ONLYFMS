import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.tsx'
import { supabase } from '../../lib/supabase.ts'

export function Layout() {
  const { profile } = useAuth()
  return (
    <div className="layout">
      <header className="app-header">
        <div className="header-row">
          <h1 className="app-title">ONLYFMS</h1>
          <div className="header-user">
            <span className="muted">{profile?.handle}</span>
            <button className="btn btn-ghost" onClick={() => void supabase.auth.signOut()}>로그아웃</button>
          </div>
        </div>
        <nav className="nav" aria-label="주 메뉴">
          <NavLink to="/" end>게임</NavLink>
          <NavLink to="/contests">대회</NavLink>
          <NavLink to="/leaderboard">리더보드</NavLink>
          {profile?.handle && <NavLink to={`/u/${profile.handle}`}>내 프로필</NavLink>}
          {profile?.is_admin && <NavLink to="/admin">관리자</NavLink>}
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
