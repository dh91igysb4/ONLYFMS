// 메인 바로가기 버튼 묶음(메인 미리보기 설계 §4.2). 버튼은 이름만, 할 일이 있으면 점·숫자.
// 버튼은 곧바로 그리고, 표시는 버튼마다 따로 불러온다(불러오는 중·실패면 표시만 없다).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { games } from '../../games/index.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import {
  buildShortcuts, loadDailyDone, loadMyOpenDuels, loadOpenContests, shortcutTarget, type Shortcut,
} from './shortcuts.ts'

type Ids = { id: string }[]

export function Shortcuts() {
  const { profile } = useAuth()
  const uid = profile?.id
  const list = buildShortcuts([...games], !!profile?.is_admin)
  const dailyIds = list.filter((s) => s.badge === 'daily').map((s) => s.gameId!).join(',')
  const [undone, setUndone] = useState<Record<string, boolean>>({})
  const [duels, setDuels] = useState<Ids | null>(null)
  const [contests, setContests] = useState<Ids | null>(null)

  useEffect(() => {
    if (!uid) return
    let alive = true
    for (const id of dailyIds ? dailyIds.split(',') : []) {
      loadDailyDone(id, uid).then((done) => { if (alive) setUndone((p) => ({ ...p, [id]: !done })) }, () => {})
    }
    loadMyOpenDuels().then((d) => { if (alive) setDuels(d) }, () => {})
    loadOpenContests(uid).then((c) => { if (alive) setContests(c) }, () => {})
    return () => { alive = false }
  }, [uid, dailyIds])

  function shape(s: Shortcut): { to: string; mark: string | null; name: string } {
    if (s.badge === 'daily') {
      const todo = undone[s.gameId!] === true
      return { to: s.to, mark: todo ? '●' : null, name: todo ? `${s.label}, 아직 안 풀었어요` : s.label }
    }
    if (s.badge === 'duels' || s.badge === 'contests') {
      const items = (s.badge === 'duels' ? duels : contests) ?? []
      const base = s.badge === 'duels' ? '/duel' : '/contests'
      const to = shortcutTarget(s.to, items, (id) => `${base}/${id}`)
      const word = s.badge === 'duels' ? '내 대국' : '진행·예정'
      return items.length > 0
        ? { to, mark: String(items.length), name: `${s.label}, ${word} ${items.length}개` }
        : { to, mark: null, name: s.label }
    }
    return { to: s.to, mark: null, name: s.label }
  }

  return (
    <nav className="home-shortcuts" aria-label="바로가기">
      {list.map((s) => {
        const { to, mark, name } = shape(s)
        return (
          <Link key={s.key} to={to} className="home-shortcut" aria-label={name}>
            <span className="home-shortcut-label">{s.label}</span>
            {mark && <span className="home-shortcut-mark" aria-hidden="true">{mark}</span>}
          </Link>
        )
      })}
    </nav>
  )
}
