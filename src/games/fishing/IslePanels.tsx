// 내 섬 창(내 섬 설계 docs/superpowers/specs/2026-11-25-my-island-design.md §5.3).
// 배 창: 마을 선착장에서 섬(낚시 섬)·내 섬·친구 섬 중 고른다. 섬 고르기 창: 처음 내 섬에 갈 때 모양을 하나 고른다.
// 작업대 창(B단계): 도구 올리기·다음 구역 개간. 섬 그림 캔버스 내부 색은 낚시 캔버스 예외.
import { useEffect, useRef, useState } from 'react'
import type { WorldPlayer } from '../../lib/api.ts'
import { ISLE_LAYOUTS, type IsleLayoutId } from './data.ts'
import { isleMap } from './isle.ts'
import { ISLE_ZONES, TOOL_IDS, TOOL_MAX, clearCost, toolCost, zoneNeeds, type Cost, type Mats, type ToolId } from './isleEcon.ts'
import type { IsleState } from './logic.ts'

type BoatProps = {
  busy: boolean
  /** 친구 섬 목록(누르기 전·불러오는 중이면 null) */
  friends: readonly WorldPlayer[] | null
  /** 창 안 안내(구경 실패 등) */
  note: string | null
  onIsland: () => void
  onMine: () => void
  onFriends: () => void
  onFriend: (p: WorldPlayer) => void
}

export function BoatPanel({ busy, friends, note, onIsland, onMine, onFriends, onFriend }: BoatProps) {
  return (
    <section className="fish-panel-body fish-boat" aria-label="배">
      <div className="fish-boat-dests">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onIsland}>섬</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onMine}>내 섬</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onFriends}>친구 섬</button>
      </div>
      {friends && friends.length === 0 && <p className="muted">아직 섬이 있는 친구가 없어요</p>}
      {friends && friends.length > 0 && (
        <ul className="fish-boat-friends">
          {friends.map((p) => (
            <li key={p.id}>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onFriend(p)}>{`${p.handle}의 섬`}</button>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="fish-shop-note" role="status">{note}</p>}
    </section>
  )
}

/** 섬 모양 그림의 칸 색(캔버스 내부) */
const ISLE_COLORS: Readonly<Record<string, string>> = {
  '~': '#3a7bd5', '.': '#e8d49a', ',': '#6fbf4a', '=': '#c9a36a', f: '#6fbf4a', T: '#2f7a32', o: '#8a8a8a', K: '#8b5a2b', B: '#b8935a', D: '#b8935a',
}

function IsleThumb({ layout }: { layout: IsleLayoutId }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const map = isleMap(layout)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx || typeof ctx.fillRect !== 'function') return
    map.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        ctx.fillStyle = ISLE_COLORS[row[x]] ?? '#3a7bd5'
        ctx.fillRect(x * 2, y * 2, 2, 2)
      }
    })
  }, [map])
  return <canvas ref={ref} className="fish-isle-thumb" width={map.w * 2} height={map.h * 2} aria-hidden="true" />
}

export function IsleChoosePanel({ busy, onChoose }: { busy: boolean; onChoose: (layout: IsleLayoutId) => void }) {
  return (
    <section className="fish-panel-body fish-isle-choose" aria-label="섬 고르기">
      <p className="muted">고르면 바꿀 수 없어요</p>
      <div className="fish-isle-options">
        {ISLE_LAYOUTS.map((l) => (
          <button key={l.id} type="button" className="btn btn-ghost fish-isle-option" disabled={busy} onClick={() => onChoose(l.id)}>
            <IsleThumb layout={l.id} />
            <span>{l.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

const TOOL_NAMES: Readonly<Record<ToolId, string>> = { axe: '도끼', pick: '곡괭이', shovel: '삽' }
const matLine = (m: Mats) => `나무 ${m.wood} · 돌 ${m.stone} · 철 ${m.iron}`
const costLine = (c: Cost) => {
  const parts = [c.wood ? `나무 ${c.wood}` : '', c.stone ? `돌 ${c.stone}` : '', c.iron ? `철 ${c.iron}` : '', c.gold ? `${c.gold.toLocaleString('ko-KR')} G` : '']
  return parts.filter(Boolean).join(' · ')
}
const enough = (have: Mats, gold: number, c: Cost) => have.wood >= c.wood && have.stone >= c.stone && have.iron >= c.iron && gold >= c.gold

type WorkbenchProps = {
  isle: IsleState
  gold: number
  busy: boolean
  onCraft: (tool: ToolId, tier: number, price: number) => void
  onClear: (zone: number, price: number) => void
}

/** 작업대(내 섬 B 설계 §5.5): 도구 올리기·다음 구역 개간. 가진 재료를 맨 위에 */
export function WorkbenchPanel({ isle, gold, busy, onCraft, onClear }: WorkbenchProps) {
  const [tab, setTab] = useState<'tools' | 'clear'>('tools')
  const next = isle.cleared + 1
  return (
    <section className="fish-panel-body fish-workbench" aria-label="작업대">
      <p className="muted">{matLine(isle.mats)}</p>
      <div className="fish-dex-tabs" role="tablist" aria-label="작업대">
        <button type="button" role="tab" aria-selected={tab === 'tools'} className={`fish-dex-tab${tab === 'tools' ? ' fish-dex-tab-on' : ''}`} onClick={() => setTab('tools')}>도구</button>
        <button type="button" role="tab" aria-selected={tab === 'clear'} className={`fish-dex-tab${tab === 'clear' ? ' fish-dex-tab-on' : ''}`} onClick={() => setTab('clear')}>개간</button>
      </div>
      {tab === 'tools' && (
        <ul className="fish-workbench-list">
          {TOOL_IDS.map((t) => {
            const tier = isle.tools[t]
            const cost = tier < TOOL_MAX ? toolCost(tier + 1) : null
            return (
              <li key={t} className="fish-rod">
                <div className="fish-rod-info">
                  <strong>{`${TOOL_NAMES[t]} ${tier}단계`}</strong>
                  {cost ? <span className="muted">{`${tier + 1}단계: ${costLine(cost)}`}</span> : <span className="muted">최고 단계</span>}
                </div>
                {cost && (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy || !enough(isle.mats, gold, cost)} onClick={() => onCraft(t, tier + 1, cost.gold)}>올리기</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {tab === 'clear' && (next > ISLE_ZONES ? (
        <p className="muted">섬을 모두 개간했어요</p>
      ) : (() => {
        const cost = clearCost(next)
        const need = zoneNeeds(next)
        const short = TOOL_IDS.filter((t) => isle.tools[t] < need[t])
        return (
          <div className="fish-rod">
            <div className="fish-rod-info">
              <strong>{`구역 ${next}/${ISLE_ZONES}`}</strong>
              <span className="muted">{costLine(cost)}</span>
              {short.length > 0 && <span className="fish-shop-note">{`${short.map((t) => `${TOOL_NAMES[t]} ${need[t]}단계`).join(' · ')}가 있어야 해요`}</span>}
            </div>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || short.length > 0 || !enough(isle.mats, gold, cost)} onClick={() => onClear(next, cost.gold)}>개간하기</button>
          </div>
        )
      })())}
    </section>
  )
}
