import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useFreeQueueFlush } from '../games/freeQueue.ts'
import { suggestionPendingCount } from '../suggest/adminApi.ts'
import { WalletBadge } from '../wallet/WalletBadge.tsx'
import { refreshWallet } from '../wallet/useWallet.ts'
import { walletEnabled } from '../wallet/enabled.ts'
import { Brand } from './Brand.tsx'
import { UserMenu } from './UserMenu.tsx'

export function Layout() {
  const { profile } = useAuth()
  useFreeQueueFlush()
  const isAdmin = !!profile?.is_admin
  const approved = profile?.status === 'approved'
  // 지갑을 쓰는 게임이 등록돼 있을 때만 잔액을 읽고 보여 준다
  const showGold = approved && walletEnabled()
  const uid = profile?.id
  // 앱 로드(또는 사용자가 바뀔 때) 잔액을 읽는다. 이후 갱신은 world 응답·각 화면이 맡는다(설계 §5.5)
  useEffect(() => {
    if (showGold && uid) void refreshWallet()
  }, [showGold, uid])
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
            <div className="header-right">
              {showGold && <WalletBadge />}
              {profile?.handle && <UserMenu handle={profile.handle} />}
            </div>
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
