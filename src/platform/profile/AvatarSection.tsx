import { useEffect, useState } from 'react'
import { rpc } from '../../lib/api.ts'
import { worlds } from '../../games/index.ts'
import { AVATAR_RECORD_KEY } from '../../games/types.ts'
import { getAvatarComponent } from '../../games/ui.ts'
import { useAuth } from '../auth/AuthProvider.tsx'

type Row = { game_id: string; key: string; value: number; detail: string | null }
const SCALE = 4

/**
 * 프로필 요약 탭 맨 위의 게임 캐릭터. manifest `avatar` 선언, 서버 `user_records`의 avatar 행, 화면 등록(`getAvatarComponent`)만으로 그린다.
 * 게임별 분기 없음. 불러오는 중·실패·캐릭터 없음이면 아무것도 그리지 않는다(요약 탭의 다른 내용을 가리지 않게).
 */
export function AvatarSection({ handle }: { handle: string }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    let alive = true
    setRows([])
    rpc<Row[] | null>('user_records', { p_handle: handle })
      .then((r) => { if (alive) setRows(r ?? []) })
      .catch(() => { /* 캐릭터는 덤이라 조용히 넘어간다 */ })
    return () => { alive = false }
  }, [handle])

  const isAdmin = !!profile?.is_admin
  const shown = worlds.flatMap((w) => {
    const m = w.manifest
    const Comp = getAvatarComponent(m.id)
    const row = rows.find((r) => r.game_id === m.id && r.key === AVATAR_RECORD_KEY)
    if (!m.avatar || !Comp || !row?.detail || (m.hidden && !isAdmin)) return []
    return [{ id: m.id, label: m.avatar.label, game: m.name, Comp, data: row.detail }]
  })
  if (shown.length === 0) return null

  return (
    <div className="lb-panel">
      <h3 className="lb-caption">캐릭터</h3>
      <ul className="pf-avatars" aria-label="캐릭터">
        {shown.map(({ id, label, game, Comp, data }) => (
          <li key={id} className="pf-avatar-item">
            <Comp data={data} scale={SCALE} />
            <span className="pf-avatar-label">
              <strong>{label}</strong>
              <span className="muted">{game}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
