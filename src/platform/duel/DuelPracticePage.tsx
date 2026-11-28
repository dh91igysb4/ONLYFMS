import { Link, useNavigate, useParams } from 'react-router-dom'
import { getDuel } from '../../games/index.ts'
import { getRealtimeComponent } from '../../games/ui.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useGameScreen } from '../games/useGameScreen.ts'

/**
 * 실시간 대전 혼자 연습 (레이싱 설계 §7, §9 단계 1). 기록 없음.
 * manifest `duel.realtime`이 있는 게임만. 숨김 게임은 관리자에게만 있다. 터치 기기는 게임 화면이 화면 버튼을 띄운다.
 */
export function DuelPracticePage() {
  const { game = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const found = getDuel(game)
  const mod = found && (!found.manifest.hidden || !!profile?.is_admin) && found.manifest.duel?.realtime ? found : undefined
  const Race = mod ? getRealtimeComponent(game) : undefined
  useGameScreen(!!Race)

  if (!mod || !Race) {
    return (
      <div className="stack">
        <p className="muted">없는 게임이에요</p>
        <Link to="/duel">대전으로</Link>
      </div>
    )
  }
  return <Race key={game} gameId={game} mode="practice" onExit={() => navigate('/duel')} />
}
