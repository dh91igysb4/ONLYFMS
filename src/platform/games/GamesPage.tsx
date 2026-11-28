import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '../../lib/api.ts'
import { kstDate } from '../../shared/kst.ts'
import { now } from '../../lib/serverTime.ts'
import { games, worlds } from '../../games/index.ts'
import type { Manifest } from '../../games/types.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { UpcomingContests } from './UpcomingContests.tsx'
import { gameSections } from './sections.ts'

type DailyRow = { user_id: string; score: number }
type Status = { kind: 'loading' } | { kind: 'done'; score: number } | { kind: 'todo' } | { kind: 'error' }

function statusText(s: Status | undefined): string {
  if (!s || s.kind === 'loading') return '확인 중…'
  if (s.kind === 'done') return `오늘 ${s.score}점`
  if (s.kind === 'todo') return '아직 안 풀었어요'
  return '오늘 기록을 불러오지 못했어요'
}

export function GamesPage() {
  const { profile } = useAuth()
  const visible = games.filter((g) => !g.manifest.hidden || profile?.is_admin)
  const visibleWorlds = worlds.filter((w) => !w.manifest.hidden || profile?.is_admin)
  const [status, setStatus] = useState<Record<string, Status>>({})
  const sections = gameSections(visible.map((g) => g.manifest), visibleWorlds.map((w) => w.manifest))

  useEffect(() => {
    let alive = true
    const today = kstDate(now()) // 서버 시계 기준 (브라우저 시계가 틀려도 같은 날짜)
    for (const g of games.filter((x) => (!x.manifest.hidden || profile?.is_admin) && x.manifest.modes.daily)) {
      rpc<DailyRow[] | null>('lb_daily', { p_day: today, p_game: g.manifest.id })
        .then((rows) => {
          const mine = (rows ?? []).find((r) => r.user_id === profile?.id)
          return mine ? ({ kind: 'done', score: mine.score } as Status) : ({ kind: 'todo' } as Status)
        })
        .catch(() => ({ kind: 'error' }) as Status)
        .then((st) => {
          if (alive) setStatus((prev) => ({ ...prev, [g.manifest.id]: st }))
        })
    }
    return () => { alive = false }
  }, [profile?.id, profile?.is_admin])

  return (
    <div className="stack">
      <h2 className="page-title sr-only">게임 목록</h2>
      {/* 넓은 화면: 왼쪽 게임 구역, 오른쪽 좁은 열에 대회 */}
      <div className="split split-aside">
        <UpcomingContests />
        {/* 주제별 구역(manifest topic)마다 판 하나: 넓은 화면은 좌우 두 칸, 본문 칸이 충분히 넓으면 3단(게임이 많은 구역이 2칸),
            휴대폰은 위아래. 3단 기준은 theme.css .games-sections 컨테이너 쿼리 */}
        <div className="split-main games-sections">
          <div className="split split-even">
            {sections.length === 0 && <p className="muted">아직 열린 게임이 없어요</p>}
            {sections.map((sec) => (
              <section key={sec.key} className={sec.wide ? 'fm-panel games-sec-wide' : 'fm-panel'} aria-label={sec.title}>
                <h3 className="fm-panel-head">{sec.title}</h3>
                <div className="games-rows">
                  {sec.games.map((m) => <GameRow key={m.id} m={m} status={status[m.id]} />)}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 게임 한 줄: 지속형·자유 플레이만 있는 게임은 줄 전체가 링크, 데일리 게임은 오른쪽에 데일리·자유 버튼 */
function GameRow({ m, status }: { m: Manifest; status: Status | undefined }) {
  if (m.category === 'world') {
    return (
      <Link to={`/world/${m.id}`} className="fm-row" aria-label={`${m.name} 입장`}>
        <span className="fm-row-main">
          <span className="fm-row-title">{m.name}</span>
          <span className="fm-row-sub">{m.description}</span>
        </span>
        <span className="fm-row-go">입장 ›</span>
      </Link>
    )
  }
  if (!m.modes.daily && m.modes.free) {
    return (
      <Link to={`/play/${m.id}/free`} className="fm-row" aria-label={m.name}>
        <span className="fm-row-main">
          <span className="fm-row-title">{m.name}</span>
          <span className="fm-row-sub">{m.description}</span>
        </span>
        <span className="fm-row-go" aria-hidden="true">›</span>
      </Link>
    )
  }
  return (
    <div className="fm-row" role="group" aria-label={m.name}>
      <span className="fm-row-main">
        <span className="fm-row-title">{m.name}</span>
        <span className="fm-row-sub">
          {m.description}
          {m.modes.daily && <> · <span className="games-status">{statusText(status)}</span></>}
        </span>
      </span>
      <span className="fm-row-actions">
        {m.modes.daily && <Link className="btn btn-primary btn-sm" to={`/play/${m.id}/daily`} aria-label={`${m.name} 데일리`}>데일리</Link>}
        {m.modes.free && <Link className="btn btn-ghost btn-sm" to={`/play/${m.id}/free`} aria-label={`${m.name} 자유 플레이`}>자유</Link>}
      </span>
    </div>
  )
}
