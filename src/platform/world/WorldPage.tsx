import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { subscribeGoldCapped, type GoldCapped } from '../../lib/walletStore.ts'
import { formatGold } from '../wallet/format.ts'
import '../wallet/wallet.css'
import { getWorld } from '../../games/index.ts'
import { getWorldComponent } from '../../games/ui.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useGameScreen } from '../games/useGameScreen.ts'

/** 알림을 보여 주는 시간 */
const CAP_TOAST_MS = 3000

/** world 응답의 gold_capped(사이트 하루 상한으로 줄어든 수입)를 잠깐 알린다. 게임 id를 모른다 */
function useGoldCappedToast(): GoldCapped | null {
  const [capped, setCapped] = useState<GoldCapped | null>(null)
  useEffect(() => subscribeGoldCapped(setCapped), [])
  useEffect(() => {
    if (!capped) return
    const t = setTimeout(() => setCapped(null), CAP_TOAST_MS)
    return () => clearTimeout(t)
  }, [capped])
  return capped
}

/** 지속형 게임 화면 틀 (/world/:game). 게임 화면은 등록부에서 찾아 gameId만 넘긴다. */
export function WorldPage() {
  const { game = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const found = getWorld(game)
  // 숨김 게임은 관리자에게만 있는 게임이다. 그 밖의 사람에게는 없는 게임과 똑같이 보인다.
  const mod = found && (!found.manifest.hidden || !!profile?.is_admin) ? found : undefined
  const Component = getWorldComponent(game)
  useGameScreen(!!mod && !!Component)
  const capped = useGoldCappedToast()

  if (!mod || !Component) {
    return (
      <div className="stack">
        <p className="muted">없는 게임이에요</p>
        <Link to="/games">게임 목록으로</Link>
      </div>
    )
  }

  return (
    <div className="stack">
      <h2 className="page-title">{mod.manifest.name}</h2>
      <Component key={game} gameId={game} onOpenGames={() => navigate('/games')} />
      {capped && (
        <p className="wallet-cap-toast" role="status">
          오늘 골드 상한을 넘어 일부만 들어왔어요 (+{formatGold(capped.got)} / +{formatGold(capped.asked)})
        </p>
      )}
    </div>
  )
}
