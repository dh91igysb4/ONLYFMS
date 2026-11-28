// 과제 창(데일리 과제·업적 설계 2026-11-28 §9): 오늘(데일리 3개·리롤·주간) · 업적(분야별·단계·칭호) · 지역 과제(기존 도전과제 10개).
import { useState } from 'react'
import { ChallengePanel } from './Menus.tsx'
import { rewardText, taskText, WEEK_NEED, type DailyTask } from './daily.ts'
import { ACHIEVEMENTS, CAT_NAMES, achvScore, achvValue, hasTitle, newAchv, type AchvCat } from './achievements.ts'
import { kstDayOf, newStats } from './stats.ts'
import type { State, View } from './logic.ts'

type Tab = 'daily' | 'achv' | 'region'
type Props = { view: View; busy: boolean; now: number; onReroll(index: number): void; onTitle(id: string | null): void }
const TIER_NAMES = { easy: '쉬움', normal: '보통', hard: '어려움' } as const
const MEDAL = ['동', '은', '금'] as const
const CATS: readonly AchvCat[] = ['collect', 'skill', 'record', 'explore', 'economy', 'isle', 'gallery', 'daily', 'hidden']
const num = (n: number) => n.toLocaleString('ko-KR')

function TaskRow({ t, canReroll, busy, onReroll }: { t: DailyTask; canReroll: boolean; busy: boolean; onReroll(): void }) {
  return (
    <li className={`fish-rod${t.done ? ' fish-rod-owned' : ''}`}>
      <div className="fish-rod-info">
        <strong>{`${TIER_NAMES[t.tier]} · ${taskText(t)}`}</strong>
        <progress className="fish-goal-bar" max={t.target} value={t.progress} aria-label={`${taskText(t)} 진행`} />
        <span className="muted">{t.done ? `완료 · 받은 보상 ${rewardText(t.reward)}` : `${num(t.progress)}/${num(t.target)} · 보상 ${rewardText(t.reward)}`}</span>
      </div>
      {canReroll && !t.done && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onReroll} aria-label={`${taskText(t)} 바꾸기`}>바꾸기</button>
      )}
    </li>
  )
}

export function GoalsPanel({ view, busy, now, onReroll, onTitle }: Props) {
  const [tab, setTab] = useState<Tab>('daily')
  const [cat, setCat] = useState<AchvCat>('collect')
  const daily = view.daily
  const today = kstDayOf(now)
  const achv = view.achv ?? newAchv()
  const state = { ...view, stats: view.stats ?? newStats() } as unknown as State
  const score = achvScore(achv)
  const titles = ACHIEVEMENTS.filter((d) => hasTitle(achv, d.id))
  return (
    <section className="fish-panel-body" aria-label="과제">
      <div className="fish-dex-tabs" role="tablist" aria-label="과제 종류">
        {([['daily', '오늘'], ['achv', '업적'], ['region', '지역 과제']] as const).map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`fish-dex-tab${tab === id ? ' fish-dex-tab-on' : ''}`} onClick={() => setTab(id)}>{name}</button>
        ))}
      </div>
      {tab === 'daily' && (
        !daily || daily.day !== today || daily.tasks.length === 0 ? (
          <p className="muted">오늘의 과제를 불러오는 중이에요</p>
        ) : (
          <>
            <p className="muted">{`매일 자정(한국 시간)에 새 과제 3개 · 셋 다 하면 보너스 · 이번 주 ${daily.week.days}/${WEEK_NEED}일${daily.week.claimed ? ' (주간 보상 받음)' : ''}`}</p>
            <ul className="fish-rods" aria-label="오늘의 과제">
              {daily.tasks.map((t, i) => <TaskRow key={`${t.id}-${i}`} t={t} canReroll={!daily.rerolled} busy={busy} onReroll={() => onReroll(i)} />)}
            </ul>
            <p className="muted">{daily.rerolled ? '오늘은 과제를 이미 한 번 바꿨어요' : '끝나지 않은 과제 하나를 하루 한 번 바꿀 수 있어요'}</p>
          </>
        )
      )}
      {tab === 'achv' && (
        <>
          <p className="muted">{`업적 점수 ${num(score.score)} · ${score.count}단계`}</p>
          <label className="fish-goal-title">
            <span>칭호</span>
            <select value={achv.title ?? ''} disabled={busy || titles.length === 0} onChange={(e) => onTitle(e.target.value || null)} aria-label="칭호">
              <option value="">{titles.length === 0 ? '아직 칭호가 없어요' : '보이지 않기'}</option>
              {titles.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </label>
          <div className="fish-dex-tabs" role="tablist" aria-label="업적 분야">
            {CATS.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={cat === c} className={`fish-dex-tab${cat === c ? ' fish-dex-tab-on' : ''}`} onClick={() => setCat(c)}>{CAT_NAMES[c]}</button>
            ))}
          </div>
          <ul className="fish-rods" aria-label={`${CAT_NAMES[cat]} 업적`}>
            {ACHIEVEMENTS.filter((d) => d.cat === cat).map((d) => {
              const have = achv.tiers[d.id] ?? 0
              const maxed = have >= d.tiers.length
              if (d.cat === 'hidden') {
                return (
                  <li key={d.id} className={`fish-rod${maxed ? ' fish-rod-owned' : ''}`}>
                    <div className="fish-rod-info">
                      <strong>{maxed ? d.name : '???'}</strong>
                      <span className="muted">{maxed ? `${d.hint} · 칭호 "${d.title}"` : '조건을 채우면 드러나요'}</span>
                    </div>
                  </li>
                )
              }
              const v = achvValue(state, d.id)
              const next = maxed ? d.tiers[d.tiers.length - 1] : d.tiers[have]
              return (
                <li key={d.id} className={`fish-rod${maxed ? ' fish-rod-owned' : ''}`}>
                  <div className="fish-rod-info">
                    <strong>{`${d.name}${have > 0 ? ` · ${d.tiers.length === 1 ? '달성' : MEDAL[have - 1]}` : ''}`}</strong>
                    <progress className="fish-goal-bar" max={next} value={Math.min(v, next)} aria-label={`${d.name} 진행`} />
                    <span className="muted">
                      {maxed ? `완료 · 칭호 "${d.title}"` : `${num(Math.min(v, next))}/${num(next)}${d.unit} · 다음 보상 ${num(d.gold[have])} JWD${have === d.tiers.length - 1 ? ` · 칭호 "${d.title}"` : ''}`}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {tab === 'region' && <ChallengePanel view={view} />}
    </section>
  )
}
