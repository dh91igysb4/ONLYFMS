import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useFreeQueueFlush } from '../games/freeQueue.ts'
import { suggestionPendingCount } from '../suggest/adminApi.ts'
import { PrizeNotice } from '../wallet/PrizeNotice.tsx'
import { WalletBadge } from '../wallet/WalletBadge.tsx'
import { refreshWallet } from '../wallet/useWallet.ts'
import { walletEnabled } from '../wallet/enabled.ts'
import { Brand } from './Brand.tsx'
import { UserMenu } from './UserMenu.tsx'
import { ValleyButton } from './ValleyButton.tsx'

export function Layout() {
  const { profile } = useAuth()
  useFreeQueueFlush()
  const isAdmin = !!profile?.is_admin
  const approved = profile?.status === 'approved'
  // 지갑을 쓰는 게임이 등록돼 있을 때만 잔액을 읽고 보여 준다
  const showGold = approved && walletEnabled()
  const uid = profile?.id
  // 앱 로드(또는 사용자가 바뀔 때) my_wallet()을 부른다. 이후 갱신은 world 응답·각 화면이 맡는다(설계 §5.5).
  // my_wallet()은 끝난 대회 정산(settle_due, 설계 §8)도 맡으므로 지갑 화면이 보이지 않아도 승인 사용자면 언제나 부른다
  // (보이지 않는 동안 정산이 밀렸다가 지갑을 켜는 날 한꺼번에 들어와 그날 사이트 상한을 채우지 않게). 표시만 showGold로 가린다
  useEffect(() => {
    if (approved && uid) void refreshWallet()
  }, [approved, uid])
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
              {approved && <ValleyButton />}
              {profile?.handle && <UserMenu handle={profile.handle} isAdmin={isAdmin} adminPending={pending} />}
            </div>
          </div>
          <nav className="nav" aria-label="주 메뉴">
            <NavLink to="/" end>홈</NavLink>
            <NavLink to="/games">게임</NavLink>
            <NavLink to="/duel">대전</NavLink>
            <NavLink to="/leaderboard">순위</NavLink>
            <NavLink to="/contests">대회</NavLink>
            <NavLink to="/suggest">제안</NavLink>
          </nav>
        </div>
      </header>
      <main className="page">
        {showGold && uid && <PrizeNotice uid={uid} />}
        <Outlet />
      </main>
    </div>
  )
}
