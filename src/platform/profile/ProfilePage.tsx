import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { duels, games } from '../../games/index.ts'
import { kstDate } from '../../shared/kst.ts'
import { normalizeHandle } from '../../shared/handle.ts'
import { DuelSection } from './DuelSection.tsx'
import { useAuth } from '../auth/AuthProvider.tsx'
import { AppearanceSettings } from './AppearanceSettings.tsx'
import { Avatar } from './Avatar.tsx'
import { pct } from '../leaderboard/LeaderboardPage.tsx'
import '../leaderboard/leaderboard.css'
import './profile.css'

type Stats = {
  daily_by_game: { game_id: string; days: number; avg_score: number }[]
  contests: { contest_id: string; title: string; kind: string; ends_at: string; rank: number; score: number }[]
  free_by_game: { game_id: string; plays: number; wins: number; win_rate: number; best_streak: number | null }[]
  recent: { type: 'daily' | 'contest' | 'free'; game_id: string | null; score: number; at: string }[]
}
type Wdl = { w: number; d: number; l: number }
type DuelRecent = {
  id: string; opponent_handle: string | null; result: 'win' | 'draw' | 'loss'
  rated: boolean; ended_at: string; my_score: number | null; opp_score: number | null
}
type DuelStat = { game_id: string; rating: number; all: Wdl; recent: DuelRecent[] }
type H2hGames = { games: { game_id: string; a_wins: number; draws: number; b_wins: number }[] }

type Tab = 'summary' | 'puzzle' | 'duel' | 'settings'
const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: '요약' },
  { id: 'puzzle', label: '퍼즐' },
  { id: 'duel', label: '대전' },
  { id: 'settings', label: '설정' },
]

const gameName = (id: string) => games.find((g) => g.manifest.id === id)?.manifest.name ?? id
const duelName = (id: string) => duels.find((d) => d.manifest.id === id)?.manifest.name ?? id
const TYPE_LABEL = { daily: '데일리', contest: '대회', free: '자유 플레이' }
const RESULT = { win: '승', draw: '무', loss: '패' }
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const day = (iso: string) => kstDate(Date.parse(iso))
const SUMMARY_SIZE = 10

type SummaryRow = { key: string; at: string; badge: string; text: string }

export function ProfilePage() {
  const { handle = '' } = useParams()
  const { profile } = useAuth()
  const me = profile?.handle ?? ''
  const mine = !!me && normalizeHandle(me) === normalizeHandle(handle)
  const [params, setParams] = useSearchParams()
  const [stats, setStats] = useState<Stats | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // 상단 카드·요약용. 실패해도 페이지는 그대로 보이고 해당 숫자만 '–' (대전 탭은 DuelSection이 따로 불러온다)
  const [duelStats, setDuelStats] = useState<DuelStat[] | null | undefined>(undefined)
  const [h2h, setH2h] = useState<Wdl | null>(null)
  const uid = useId()
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  useEffect(() => {
    let alive = true
    setError(null)
    setStats(undefined)
    rpc<Stats | null>('user_stats', { p_handle: handle })
      .then((s) => { if (alive) setStats(s) })
      .catch((e) => { if (alive) setError(errorMessage(e instanceof ApiError ? e.code : 'network')) })
    return () => { alive = false }
  }, [handle, attempt])

  useEffect(() => {
    let alive = true
    setDuelStats(undefined)
    rpc<DuelStat[] | null>('duel_stats', { p_handle: handle, p_game: null })
      .then((s) => { if (alive) setDuelStats(s ?? []) })
      .catch(() => { if (alive) setDuelStats(null) })
    return () => { alive = false }
  }, [handle, attempt])

  useEffect(() => {
    setH2h(null)
    if (mine || !me) return
    let alive = true
    rpc<H2hGames | null>('duel_h2h', { p_handle_a: me, p_handle_b: handle, p_game: null })
      .then((d) => {
        if (!alive || !d) return
        setH2h({ w: sum(d.games.map((g) => g.a_wins)), d: sum(d.games.map((g) => g.draws)), l: sum(d.games.map((g) => g.b_wins)) })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [handle, me, mine, attempt])

  const tabs = mine ? TABS : TABS.filter((t) => t.id !== 'settings')
  const asked = params.get('tab')
  const tab: Tab = tabs.find((t) => t.id === asked)?.id ?? 'summary'

  function select(next: Tab) {
    setParams((p) => { const q = new URLSearchParams(p); q.set('tab', next); return q }, { replace: true })
  }
  function onTabKey(e: KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === tab)
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    const next = tabs[(to + tabs.length) % tabs.length].id
    select(next)
    tabRefs.current[next]?.focus()
  }

  const summary = useMemo<SummaryRow[]>(() => {
    const puzzle = (stats?.recent ?? []).map((r, i) => ({
      key: `p${i}`, at: r.at, badge: TYPE_LABEL[r.type],
      text: `${r.game_id ? `${gameName(r.game_id)} · ` : ''}${r.score}점 · ${day(r.at)}`,
    }))
    const duel = (duelStats ?? []).flatMap((g) => g.recent.map((r) => ({
      key: `d${r.id}`, at: r.ended_at, badge: '대전',
      text: `${duelName(g.game_id)} · vs ${r.opponent_handle ?? '알 수 없음'} · ${RESULT[r.result]}`
        + `${r.my_score !== null && r.opp_score !== null ? ` ${r.my_score} : ${r.opp_score}` : ''}`
        + ` · ${day(r.ended_at)}${r.rated ? '' : ' · 친선'}`,
    })))
    const t = (iso: string) => Date.parse(iso)
    return [...puzzle, ...duel].sort((a, b) => t(b.at) - t(a.at)).slice(0, SUMMARY_SIZE)
  }, [stats, duelStats])

  if (error) {
    return (
      <div className="stack" role="alert">
        <p className="form-error">{error}</p>
        <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
      </div>
    )
  }
  if (stats === undefined) return <p className="page-note" role="status">불러오는 중…</p>
  if (stats === null) return <p className="page-note">없는 사용자예요</p>

  const playedDuels = (duelStats ?? []).filter((g) => g.all.w + g.all.d + g.all.l > 0)
  const chips: { label: string; value: string }[] = [
    { label: '데일리 참여', value: `${sum(stats.daily_by_game.map((d) => d.days))}` },
    { label: '자유 플레이', value: `${sum(stats.free_by_game.map((f) => f.plays))}` },
    {
      label: '대전 최고 레이팅',
      value: duelStats === undefined ? '…' : playedDuels.length === 0 ? '–' : `${Math.max(...playedDuels.map((g) => g.rating))}`,
    },
    { label: '공식 대회', value: `${stats.contests.filter((c) => c.kind === 'official').length}` },
  ]
  const h2hTotal = h2h ? h2h.w + h2h.d + h2h.l : 0
  const tabId = (t: Tab) => `${uid}-tab-${t}`
  const panelId = `${uid}-panel`

  return (
    <div className="stack pf">
      <section className="pf-card" aria-labelledby={`${uid}-name`}>
        <div className="pf-id">
          <Avatar handle={handle} size="lg" />
          <h2 className="page-title pf-name" id={`${uid}-name`}>{handle}</h2>
        </div>
        <ul className="pf-chips" aria-label="요약 기록">
          {chips.map((c) => (
            <li key={c.label} className="pf-chip">
              <span className="pf-chip-value">{c.value}</span>
              <span className="pf-chip-label">{c.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {h2h && h2hTotal > 0 && (
        <button type="button" className="pf-h2h" onClick={() => select('duel')}>
          나와의 대전 전적 <strong>{h2h.w}승 {h2h.d}무 {h2h.l}패</strong>
          <span className="pf-h2h-arrow" aria-hidden="true" />
        </button>
      )}

      <div className="lb-tabs" role="tablist" aria-label="프로필 보기">
        {tabs.map((t) => (
          <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el }} type="button" role="tab" className="lb-tab"
            id={tabId(t.id)} aria-selected={tab === t.id} aria-controls={panelId} tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)} onKeyDown={onTabKey}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="stack" role="tabpanel" id={panelId} aria-labelledby={tabId(tab)}>
        {tab === 'summary' && (
          <div className="lb-panel">
            <h3 className="lb-caption">최근 기록</h3>
            {summary.length === 0 ? <p className="muted pf-empty">아직 기록이 없어요</p> : (
              <ul className="pf-recent" aria-label="최근 기록">
                {summary.map((r) => (
                  <li key={r.key} className="pf-recent-row">
                    <span className="badge">{r.badge}</span> <span>{r.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'puzzle' && (
          <>
            <div className="lb-panel">
              <h3 className="lb-caption">데일리</h3>
              {stats.daily_by_game.length === 0 ? <p className="muted pf-empty">아직 기록이 없어요</p> : (
                <table className="lb-table">
                  <thead><tr><th scope="col">게임</th><th scope="col" className="num">참여일</th><th scope="col" className="num">평균 점수</th></tr></thead>
                  <tbody>
                    {stats.daily_by_game.map((d) => (
                      <tr key={d.game_id}><td>{gameName(d.game_id)}</td><td className="num">{d.days}</td><td className="num">{d.avg_score}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="lb-panel">
              <h3 className="lb-caption">대회</h3>
              {stats.contests.length === 0 ? <p className="muted pf-empty">참가한 대회가 없어요</p> : (
                <table className="lb-table">
                  <thead><tr><th scope="col">대회</th><th scope="col">구분</th><th scope="col" className="num">순위</th><th scope="col" className="num">점수</th></tr></thead>
                  <tbody>
                    {stats.contests.map((c) => (
                      <tr key={c.contest_id}>
                        <td><Link to={`/contests/${c.contest_id}`}>{c.title}</Link></td>
                        <td>{c.kind === 'official' ? '공식' : '친선'}</td>
                        <td className="num">{c.rank}위</td><td className="num">{c.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="lb-panel">
              <h3 className="lb-caption">자유 플레이</h3>
              {stats.free_by_game.length === 0 ? <p className="muted pf-empty">아직 기록이 없어요</p> : (
                <table className="lb-table">
                  <thead><tr><th scope="col">게임</th><th scope="col" className="num">플레이</th><th scope="col" className="num">정답</th><th scope="col" className="num">정답률</th><th scope="col" className="num">최고 연속</th></tr></thead>
                  <tbody>
                    {stats.free_by_game.map((f) => (
                      <tr key={f.game_id}>
                        <td>{gameName(f.game_id)}</td><td className="num">{f.plays}</td><td className="num">{f.wins}</td>
                        <td className="num">{pct(f.win_rate)}</td><td className="num">{f.best_streak ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {tab === 'duel' && <DuelSection key={handle} handle={handle} />}

        {tab === 'settings' && mine && <div className="card"><AppearanceSettings /></div>}
      </div>
    </div>
  )
}
