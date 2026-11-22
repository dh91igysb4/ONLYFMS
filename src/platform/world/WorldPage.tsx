import { Link, useParams } from 'react-router-dom'
import { getWorld } from '../../games/index.ts'
import { getWorldComponent } from '../../games/ui.ts'
import { useAuth } from '../auth/AuthProvider.tsx'

/** 지속형 게임 화면 틀 (/world/:game). 게임 화면은 등록부에서 찾아 gameId만 넘긴다. */
export function WorldPage() {
  const { game = '' } = useParams()
  const { profile } = useAuth()
  const found = getWorld(game)
  // 숨김 게임은 관리자에게만 있는 게임이다. 그 밖의 사람에게는 없는 게임과 똑같이 보인다.
  const mod = found && (!found.manifest.hidden || !!profile?.is_admin) ? found : undefined
  const Component = getWorldComponent(game)

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
      <Component key={game} gameId={game} />
    </div>
  )
}
