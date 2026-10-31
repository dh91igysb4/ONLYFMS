import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { games } from '../../games/index.ts'
import { now } from '../../lib/serverTime.ts'
import { kstDate, kstWeekStart } from '../../shared/kst.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import './leaderboard.css'

type Tab = 'daily' | 'week' | 'all' | 'contests' | 'free'
const TABS: { id: Tab; label: string }[] = [
  { id: 'daily', label: '오늘' },
  { id: 'week', label: '주간' },
  { id: 'all', label: '전체' },
  { id: 'contests', label: '대회' },
  { id: 'free', label: '자유 플레이' },
]

type ScoreRow = { rank: number; user_id: string; handle: string; score: number; action_count: number; finished_at: string | null }
type ContestsData = {
  contests: { contest_id: string; title: string; ends_at: string; podium: { handle: string; score: number }[] }[]
  totals: { user_id: string; handle: string; total: number }[]
}
type FreeRow = { user_id: string; handle: string; plays: number; wins: number; win_rate: number; current_streak: number; best_streak: number | null; avg_score: number }
type Sort = 'wins' | 'rate' | 'plays'
type Data = { tab: Tab; rows: ScoreRow[] | FreeRow[] | ContestsData }

export const pct = (r: number) => `${Math.round(r * 1000) / 10}%`

function sortFree(rows: FreeRow[], s: Sort): FreeRow[] {
  const by = {
    wins: (a: FreeRow, b: FreeRow) => b.wins - a.wins || b.win_rate - a.win_rate,
    rate: (a: FreeRow, b: FreeRow) => b.win_rate - a.win_rate || b.wins - a.wins,
    plays: (a: FreeRow, b: FreeRow) => b.plays - a.plays || b.wins - a.wins,
  }[s]
  return [...rows].sort(by)
}

function Handle({ handle }: { handle: string }) {
  return <Link to={`/u/${handle}`}>{handle}</Link>
}

const SORTS: [Sort, string][] = [['wins', '정답 수'], ['rate', '정답률'], ['plays', '플레이 수']]
const SORT_COLUMN: Record<Sort, string> = { wins: '정답', rate: '정답률', plays: '플레이' }

type Col = { label: string; num?: boolean; sorted?: boolean; rank?: boolean }
type Row = { id: string; top: boolean; me: boolean; cells: ReactNode[] }

/** 리더보드 공통 표. 1~3위(top)는 왼쪽 막대, 정렬 기준 열(sorted)은 굵게 + aria-sort. */
function LbTable({ cols, rows }: { cols: Col[]; rows: Row[] }) {
  const cellCls = (c: Col) => [c.num && 'num', c.sorted && 'key', c.rank && 'rank'].filter(Boolean).join(' ') || undefined
  return (
    <table className="lb-table">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.label} scope="col" className={c.num ? 'num' : undefined} aria-sort={c.sorted ? 'descending' : undefined}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={[r.top && 'top', r.me && 'me'].filter(Boolean).join(' ') || undefined}>
            {r.cells.map((cell, i) => <td key={cols[i].label} className={cellCls(cols[i])}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function LeaderboardPage() {
  const { profile } = useAuth()
  const myId = profile?.id
  const [tab, setTab] = useState<Tab>('daily')
  const [game, setGame] = useState('')
  const [sort, setSort] = useState<Sort>('wins')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const visible = games.filter((g) => !g.manifest.hidden || profile?.is_admin)

  useEffect(() => {
    let alive = true
    setError(null)
    setData(null)
    const today = kstDate(now())
    const p_game = game || null
    const call = async (): Promise<Data['rows']> => {
      switch (tab) {
        case 'daily': return rpc<ScoreRow[]>('lb_daily', { p_day: today, p_game })
        case 'week': return rpc<ScoreRow[]>('lb_range', { p_from: kstWeekStart(today), p_to: today, p_game })
        case 'all': return rpc<ScoreRow[]>('lb_range', { p_from: '2000-01-01', p_to: today, p_game })
        case 'contests': return rpc<ContestsData>('lb_contests', { p_from: '2000-01-01', p_to: today })
        case 'free': return rpc<FreeRow[]>('lb_free', { p_game })
      }
    }
    call()
      .then((rows) => { if (alive) setData({ tab, rows }) })
      .catch((e) => { if (alive) setError(errorMessage(e instanceof ApiError ? e.code : 'network')) })
    return () => { alive = false }
  }, [tab, game, attempt])

  const ready = data && data.tab === tab ? data.rows : null
  const freeRows = useMemo(() => (tab === 'free' && Array.isArray(ready) ? sortFree(ready as FreeRow[], sort) : []), [tab, ready, sort])

  return (
    <div className="stack">
      <h2 className="page-title">리더보드</h2>
      <div className="lb-tabs" role="tablist" aria-label="기간">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="lb-tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab !== 'contests' && (
        <div className="lb-filters">
          <span className="lb-pill">
            <select aria-label="게임" value={game} onChange={(e) => setGame(e.target.value)}>
              <option value="">전체 합계</option>
              {visible.map((g) => <option key={g.manifest.id} value={g.manifest.id}>{g.manifest.name}</option>)}
            </select>
          </span>
          {tab === 'free' && (
            <span className="lb-pill">
              <select aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </span>
          )}
        </div>
      )}
      {error && (
        <div className="stack" role="alert">
          <p className="form-error">{error}</p>
          <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </div>
      )}
      {!error && !ready && <p className="page-note" role="status">불러오는 중…</p>}
      {!error && ready && (tab === 'daily' || tab === 'week' || tab === 'all') && (
        (ready as ScoreRow[]).length === 0 ? <p className="muted">아직 기록이 없어요</p> : (
          <div className="lb-panel">
            <LbTable
              cols={[{ label: '순위', rank: true }, { label: '아이디' }, { label: '점수', num: true, sorted: true }, { label: '행동', num: true }]}
              rows={(ready as ScoreRow[]).map((r) => ({
                id: r.user_id, top: r.rank <= 3, me: r.user_id === myId,
                cells: [r.rank, <Handle handle={r.handle} />, r.score, r.action_count],
              }))}
            />
          </div>
        )
      )}
      {!error && ready && tab === 'contests' && <ContestsView data={ready as ContestsData} myId={myId} />}
      {!error && ready && tab === 'free' && (
        freeRows.length === 0 ? <p className="muted">아직 기록이 없어요</p> : (
          <div className="lb-panel">
            <LbTable
              cols={[
                { label: '아이디' },
                ...(['플레이', '정답', '정답률', '평균'].map((label) => ({ label, num: true, sorted: SORT_COLUMN[sort] === label }))),
                ...(game ? [{ label: '연속', num: true }, { label: '최고 연속', num: true }] : []),
              ]}
              rows={freeRows.map((r, i) => ({
                id: r.user_id, top: i < 3, me: r.user_id === myId,
                cells: [
                  <Handle handle={r.handle} />, r.plays, r.wins, pct(r.win_rate), r.avg_score,
                  ...(game ? [r.current_streak, r.best_streak ?? '-'] : []),
                ],
              }))}
            />
          </div>
        )
      )}
    </div>
  )
}

function ContestsView({ data, myId }: { data: ContestsData; myId?: string }) {
  if (data.contests.length === 0 && data.totals.length === 0) return <p className="muted">아직 공식 대회 기록이 없어요</p>
  return (
    <>
      <h3 className="section-title">공식 대회 시상대</h3>
      {data.contests.map((c) => (
        <section key={c.contest_id} className="lb-panel">
          <h4 className="lb-caption"><Link to={`/contests/${c.contest_id}`}>{c.title}</Link></h4>
          <LbTable
            cols={[{ label: '순위', rank: true }, { label: '아이디' }, { label: '점수', num: true, sorted: true }]}
            rows={c.podium.map((p, i) => ({ id: p.handle, top: true, me: false, cells: [i + 1, <Handle handle={p.handle} />, p.score] }))}
          />
        </section>
      ))}
      <h3 className="section-title">누적 점수</h3>
      <div className="lb-panel">
        <LbTable
          cols={[{ label: '순위', rank: true }, { label: '아이디' }, { label: '합계', num: true, sorted: true }]}
          rows={data.totals.map((t, i) => ({ id: t.user_id, top: i < 3, me: t.user_id === myId, cells: [i + 1, <Handle handle={t.handle} />, t.total] }))}
        />
      </div>
    </>
  )
}
