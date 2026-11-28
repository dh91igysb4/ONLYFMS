// 머리글 밸리 바로가기(FM 개편 설계 §4.3). 메인 미리보기가 있는 지속형 게임을 등록부에서 찾는다(HomePage와 같은 규칙, 게임 id 분기 없음)
import { Link } from 'react-router-dom'
import { worlds } from '../../games/index.ts'
import { getWorldPreview } from '../../games/ui.ts'
import { useAuth } from '../auth/AuthProvider.tsx'

export function ValleyButton() {
  const { profile } = useAuth()
  const isAdmin = !!profile?.is_admin
  const target = worlds.find((w) => w.manifest.preview && getWorldPreview(w.manifest.id) && (!w.manifest.hidden || isAdmin))
  if (!target) return null
  const m = target.manifest
  return (
    <Link className="btn btn-primary btn-sm valley-btn" to={`/world/${m.id}`} aria-label={`${m.name} 들어가기`}>
      {m.shortName ?? m.name}
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l5 4-5 4" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
    </Link>
  )
}
