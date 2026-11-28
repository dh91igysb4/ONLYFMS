// 머리글 오른쪽 위 계정 동그라미: 내 게임 캐릭터의 머리(없으면 아이디 첫 글자).
// manifest `avatar` 선언, 서버 user_records의 avatar 행, 화면 등록(getAvatarComponent)만으로 찾는다(게임 id 분기 없음, AvatarSection과 같은 규칙).
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { worlds } from '../../games/index.ts'
import { AVATAR_RECORD_KEY } from '../../games/types.ts'
import { getAvatarComponent } from '../../games/ui.ts'
import { rpc } from '../../lib/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { Avatar } from '../profile/Avatar.tsx'

type Row = { game_id: string; key: string; value: number; detail: string | null }
/** 30px 동그라미에 12칸 머리 × 2 = 24px */
const SCALE = 2

export function HeadAvatar({ handle }: { handle: string }) {
  const { profile } = useAuth()
  const isAdmin = !!profile?.is_admin
  const [rows, setRows] = useState<Row[]>([])
  // 게임 안에서 옷을 바꾸고 나오면 다시 읽는다
  const inWorld = useLocation().pathname.startsWith('/world/')

  useEffect(() => {
    if (inWorld) return
    let alive = true
    rpc<Row[] | null>('user_records', { p_handle: handle })
      .then((r) => { if (alive) setRows(r ?? []) })
      .catch(() => { if (alive) setRows([]) /* 첫 글자로 남는다 */ })
    return () => { alive = false }
  }, [handle, inWorld])

  for (const w of worlds) {
    const m = w.manifest
    if (!m.avatar || (m.hidden && !isAdmin)) continue
    const Comp = getAvatarComponent(m.id)
    const row = rows.find((r) => r.game_id === m.id && r.key === AVATAR_RECORD_KEY)
    if (Comp && row?.detail) {
      return <span className="avatar avatar-sm avatar-head" aria-hidden="true"><Comp data={row.detail} scale={SCALE} crop="head" /></span>
    }
  }
  return <Avatar handle={handle} size="sm" />
}
