// 메인 최근 대전 판(FM 개편 설계 §4.4 홈): 끝난 대국 앞 3개와 승·무·패 칸 5개. 끝난 대국이 없으면 판을 숨긴다.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.tsx'
import type { DuelListItem } from '../duel/data.ts'
import { loadDuelList, recentChips, type Chip } from './shortcuts.ts'

const CHIP_TEXT: Record<Chip, string> = { win: '승', draw: '무', loss: '패' }
const CHIP_NAME: Record<Chip, string> = { win: '승리', draw: '무승부', loss: '패배' }

function line(m: DuelListItem, myId: string): { opp: string; score: string } {
  const seat = m.players.findIndex((p) => p.id === myId)
  const opp = m.players[seat === 0 ? 1 : 0]?.handle ?? '알 수 없음'
  const score = m.status === 'void' ? '무효'
    : m.final_scores && seat >= 0 ? `${m.final_scores[seat]} : ${m.final_scores[seat === 0 ? 1 : 0]}` : ''
  return { opp: `vs ${opp}`, score }
}

export function HomeDuels() {
  const { profile } = useAuth()
  const uid = profile?.id ?? ''
  const [recent, setRecent] = useState<DuelListItem[] | undefined | 'fail'>(undefined)

  useEffect(() => {
    let alive = true
    loadDuelList().then((d) => { if (alive) setRecent(d.recent) }, () => { if (alive) setRecent('fail') })
    return () => { alive = false }
  }, [])

  if (recent === undefined || (recent !== 'fail' && recent.length === 0)) return null
  const chips = recent === 'fail' ? [] : recentChips(recent, uid)
  return (
    <section className="fm-panel" aria-label="최근 대전">
      <h3 className="fm-panel-head">최근 대전<Link to="/duel" aria-label="전체 대전">전체 ›</Link></h3>
      {recent === 'fail' ? <p className="fm-empty">불러오지 못했어요</p> : (
        <>
          {chips.length > 0 && (
            <div className="fm-row home-duel-form">
              <span className="fm-row-sub">최근 {chips.length}경기</span>
              <span className="fm-chips">
                {chips.map((c, i) => <span key={i} className={`fm-chip is-${c}`} aria-label={CHIP_NAME[c]}>{CHIP_TEXT[c]}</span>)}
              </span>
            </div>
          )}
          {recent.slice(0, 3).map((m) => {
            const { opp, score } = line(m, uid)
            return (
              <Link key={m.id} to={`/duel/${m.id}`} className="fm-row">
                <span className="fm-row-main"><span className="fm-row-title">{opp}</span></span>
                {score && <span className="fm-row-value">{score}</span>}
                <span className="fm-row-go" aria-hidden="true">›</span>
              </Link>
            )
          })}
        </>
      )}
    </section>
  )
}
