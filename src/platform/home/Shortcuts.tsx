// 메인 오늘 판·게임 판(FM 개편 설계 §4.4 홈, 메인 미리보기 설계 §4.2).
// 줄은 곧바로 그리고, 표시는 줄마다 따로 불러온다(불러오는 중이면 비우고, 실패면 그 줄에 "불러오지 못했어요").
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { games } from '../../games/index.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import {
  buildShortcuts, loadDailyScore, loadMyOpenDuels, loadOpenContests, shortcutTarget, type Shortcut,
} from './shortcuts.ts'

const FAIL = '불러오지 못했어요'

type Ids = { id: string }[]
/** undefined = 불러오는 중, 'fail' = 실패 */
type Load<T> = T | undefined | 'fail'

function useShortcuts(): Shortcut[] {
  const { profile } = useAuth()
  return buildShortcuts([...games], !!profile?.is_admin)
}

function Row({ to, name, title, value }: { to: string; name: string; title: string; value: string | null }) {
  return (
    <Link to={to} className="fm-row" aria-label={name}>
      <span className="fm-row-main"><span className="fm-row-title">{title}</span></span>
      {value && <span className={value === FAIL ? 'fm-row-sub' : 'fm-row-value'}>{value}</span>}
      <span className="fm-row-go" aria-hidden="true">›</span>
    </Link>
  )
}

export function TodayPanel() {
  const { profile } = useAuth()
  const uid = profile?.id
  const list = useShortcuts().filter((s) => s.badge !== null)
  const dailyIds = list.filter((s) => s.badge === 'daily').map((s) => s.gameId!).join(',')
  const [scores, setScores] = useState<Record<string, Load<number | null>>>({})
  const [duels, setDuels] = useState<Load<Ids>>(undefined)
  const [contests, setContests] = useState<Load<Ids>>(undefined)

  useEffect(() => {
    if (!uid) return
    let alive = true
    for (const id of dailyIds ? dailyIds.split(',') : []) {
      loadDailyScore(id, uid).then(
        (v) => { if (alive) setScores((p) => ({ ...p, [id]: v })) },
        () => { if (alive) setScores((p) => ({ ...p, [id]: 'fail' })) },
      )
    }
    loadMyOpenDuels().then((d) => { if (alive) setDuels(d) }, () => { if (alive) setDuels('fail') })
    loadOpenContests(uid).then((c) => { if (alive) setContests(c) }, () => { if (alive) setContests('fail') })
    return () => { alive = false }
  }, [uid, dailyIds])

  function shape(s: Shortcut): { to: string; value: string | null; name: string } {
    if (s.badge === 'daily') {
      const v = scores[s.gameId!]
      if (v === undefined) return { to: s.to, value: null, name: s.label }
      if (v === 'fail') return { to: s.to, value: FAIL, name: s.label }
      const text = v === null ? '아직 안 풀었어요' : `오늘 ${v}점`
      return { to: s.to, value: text, name: `${s.label}, ${text}` }
    }
    const isDuel = s.badge === 'duels'
    const items = isDuel ? duels : contests
    if (items === undefined) return { to: s.to, value: null, name: s.label }
    if (items === 'fail') return { to: s.to, value: FAIL, name: s.label }
    const base = isDuel ? '/duel' : '/contests'
    const to = shortcutTarget(s.to, items, (id) => `${base}/${id}`)
    if (items.length === 0) return { to, value: '없음', name: s.label }
    const text = `${isDuel ? '내 대국' : '진행·예정'} ${items.length}개`
    return { to, value: text, name: `${s.label}, ${text}` }
  }

  return (
    <section className="fm-panel" aria-label="오늘">
      <h3 className="fm-panel-head">오늘</h3>
      {list.map((s) => {
        const { to, value, name } = shape(s)
        return <Row key={s.key} to={to} name={name} title={s.label} value={value} />
      })}
    </section>
  )
}

export function GamesPanel() {
  const list = useShortcuts().filter((s) => s.badge === null)
  if (list.length === 0) return null
  return (
    <section className="fm-panel" aria-label="게임">
      <h3 className="fm-panel-head">게임<Link to="/games" aria-label="전체 게임">전체 ›</Link></h3>
      {list.map((s) => <Row key={s.key} to={s.to} name={s.label} title={s.label} value={null} />)}
    </section>
  )
}
