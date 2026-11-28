import { Link, useNavigate, useParams } from 'react-router-dom'
import { getDuel } from '../../games/index.ts'
import { getRealtimeComponent } from '../../games/ui.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useGameScreen } from '../games/useGameScreen.ts'
import { isPcCapable } from './pcOnly.ts'

/**
 * 실시간 대전 혼자 연습 (레이싱 설계 §7, §9 단계 1). 기록 없음.
 * manifest `duel.realtime`이 있는 게임만. 숨김 게임은 관리자에게만 있다. 터치 전용 기기는 막는다(설계 §5.5).
 */
export function DuelPracticePage() {
  const { game = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const found = getDuel(game)
  const mod = found && (!found.manifest.hidden || !!profile?.is_admin) && found.manifest.duel?.realtime ? found : undefined
  const Race = mod ? getRealtimeComponent(game) : undefined
  const pc = isPcCapable()
  useGameScreen(!!Race && pc)

  if (!mod || !Race) {
    return (
      <div className="stack">
        <p className="muted">없는 게임이에요</p>
        <Link to="/duel">대전으로</Link>
      </div>
    )
  }
  if (!pc) {
    return (
      <div className="stack">
        <h2 className="page-title">{mod.manifest.name}</h2>
        <p className="muted">PC에서만 할 수 있어요</p>
        <Link to="/duel">대전으로</Link>
      </div>
    )
  }
  return <Race key={game} gameId={game} mode="practice" onExit={() => navigate('/duel')} />
}
