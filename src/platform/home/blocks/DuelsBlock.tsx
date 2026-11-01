import { Link } from 'react-router-dom'
import { getDuel } from '../../../games/index.ts'
import { rpc } from '../../../lib/api.ts'
import { useAuth } from '../../auth/AuthProvider.tsx'
import type { DuelList } from '../../duel/data.ts'
import { BlockFrame } from '../BlockFrame.tsx'
import { useBlockData } from '../useBlockData.ts'

const MAX = 5

export function DuelsBlock({ title }: { title: string }) {
  const { profile } = useAuth()
  const { state, retry } = useBlockData<DuelList>(
    async () => {
      const r = await rpc<DuelList | null>('duel_list')
      return { lobby: r?.lobby ?? [], mine: r?.mine ?? [], recent: r?.recent ?? [], due: r?.due ?? [] }
    },
    [profile?.id],
  )

  return (
    <BlockFrame title={title} state={state} onRetry={retry}>
      {state.kind === 'done' && (() => {
        const shown = state.data.mine
          .flatMap((m) => {
            const d = getDuel(m.game_id)
            if (!d || (d.manifest.hidden && !profile?.is_admin)) return []
            const opp = m.status === 'waiting' ? undefined : m.players.find((p) => p.id !== profile?.id)
            const label = opp ? `${d.manifest.name} · vs ${opp.handle ?? '?'}` : `${d.manifest.name} · 상대 기다리는 중`
            return [{ id: m.id, label }]
          })
          .slice(0, MAX)
        return (
          <>
            {shown.length === 0
              ? <p className="muted">진행 중인 대전이 없어요</p>
              : (
                <ul className="home-list">
                  {shown.map((s) => (
                    <li key={s.id}><Link to={`/duel/${s.id}`}>{s.label}</Link></li>
                  ))}
                </ul>
              )}
            <p className="card-status">{`공개 대기실 ${state.data.lobby.length}개`}</p>
            <div className="card-actions">
              <Link className="btn btn-primary" to="/duel">대전하러 가기</Link>
            </div>
          </>
        )
      })()}
    </BlockFrame>
  )
}
