import { Link } from 'react-router-dom'
import { duels } from '../../../games/index.ts'
import { rpc } from '../../../lib/api.ts'
import { useAuth } from '../../auth/AuthProvider.tsx'
import { BlockFrame } from '../BlockFrame.tsx'
import { useBlockData } from '../useBlockData.ts'

type Row = { handle: string; rating: number; rated_games: number; wins: number; draws: number; losses: number; placed: boolean }
type Item = { id: string; name: string; rows: Row[] }

export function EloBlock({ title }: { title: string }) {
  const { profile } = useAuth()
  const { state, retry } = useBlockData<Item[]>(async () => {
    const targets = duels.filter((d) => !d.manifest.hidden || profile?.is_admin)
    return Promise.all(targets.map(async (d) => ({
      id: d.manifest.id,
      name: d.manifest.name,
      rows: (await rpc<Row[] | null>('lb_duel', { p_game: d.manifest.id })) ?? [],
    })))
  }, [profile?.id, profile?.handle, profile?.is_admin])

  return (
    <BlockFrame title={title} state={state} onRetry={retry}>
      {state.kind === 'done' && (state.data.length === 0
        ? <p className="muted">열린 대전 게임이 없어요</p>
        : state.data.map((it) => {
          const placed = it.rows.filter((r) => r.placed)
          const mine = it.rows.find((r) => r.handle === profile?.handle)
          const rank = mine?.placed ? placed.indexOf(mine) + 1 : 0
          return (
            <div key={it.id}>
              <h4>{it.name}</h4>
              {mine
                ? (
                  <>
                    <p className="card-status">{`레이팅 ${mine.rating}`}</p>
                    <p className="muted">{`레이팅 대전 ${mine.wins}승 ${mine.draws}무 ${mine.losses}패`}</p>
                    <p className="muted">{mine.placed ? `${rank}위` : '배치 중'}</p>
                  </>
                )
                : (
                  <>
                    <p className="muted">아직 레이팅 대전 기록이 없어요</p>
                    <div className="card-actions">
                      <Link className="btn btn-ghost" to="/duel">대전하러 가기</Link>
                    </div>
                  </>
                )}
              {placed.length > 0 && (
                <ul className="home-list">
                  {placed.slice(0, 3).map((r, i) => (
                    <li key={r.handle}>{`${i + 1}. ${r.handle} ${r.rating}`}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        }))}
    </BlockFrame>
  )
}
