// 마을회관 창: 명예의 전당(FamePanel), 엘리베이터(ElevatorPanel). 설계 docs/superpowers/specs/2026-11-25-village-hall-design.md §3·§4
import { useState } from 'react'
import type { FameBoard } from '../../platform/world/hallOfFame.ts'
import type { AreaId } from './data.ts'

type FameProps = { boards: readonly FameBoard[] | null; start: number; error: boolean }

/** 게시판 하나씩: 제목 · 기준, 1~3위, 이전/다음. boards가 null이면 불러오는 중(또는 실패) */
export function FamePanel({ boards, start, error }: FameProps) {
  const [i, setI] = useState(start)
  if (!boards) return <section className="fish-panel-body" aria-label="명예의 전당"><p className="muted">{error ? '불러오지 못했어요' : '불러오는 중이에요'}</p></section>
  if (boards.length === 0) return <section className="fish-panel-body" aria-label="명예의 전당"><p className="muted">아직 기록이 없어요</p></section>
  const at = Math.min(Math.max(i, 0), boards.length - 1)
  const b = boards[at]
  return (
    <section className="fish-panel-body fish-fame" aria-label="명예의 전당">
      <h4 className="fish-fame-title">{`${b.title} · ${b.label}`}</h4>
      {b.rows.length === 0 ? (
        <p className="muted">아직 기록이 없어요</p>
      ) : (
        <ol className="fish-fame-rows">
          {b.rows.map((r, n) => (
            <li key={`${r.handle}-${n}`} className="fish-fame-row">
              <span className="fish-fame-rank">{n + 1}위</span>
              <span className="fish-fame-handle">{r.handle}</span>
              <span className="fish-fame-value">{r.text}</span>
              {r.detail && <span className="fish-fame-detail muted">{r.detail}</span>}
            </li>
          ))}
        </ol>
      )}
      {error && <p className="fish-shop-note">새로 불러오지 못했어요</p>}
      <div className="fish-fame-nav">
        <button type="button" className="btn btn-ghost btn-sm" disabled={at === 0} onClick={() => setI(at - 1)}>이전</button>
        <span className="muted">{`${at + 1} / ${boards.length}`}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={at === boards.length - 1} onClick={() => setI(at + 1)}>다음</button>
      </div>
    </section>
  )
}

/** 층(회관 계단과 같은 층). area가 없는 층은 공사 중 */
const FLOORS: readonly { n: number; area?: AreaId }[] = [{ n: 1, area: 'hall' }, { n: 2, area: 'hall2' }, { n: 3 }, { n: 4 }]

/** 층 선택: 지금 층은 표시만, 열린 층은 누르면 그 층 엘리베이터 앞으로, 안 연 층(2층 전시관이 꺼져 있을 때 등)·3·4층은 공사 중 */
export function ElevatorPanel({ here, canGo, onGo }: { here: AreaId; canGo: (a: AreaId) => boolean; onGo: (a: AreaId) => void }) {
  return (
    <section className="fish-panel-body fish-elevator" aria-label="엘리베이터">
      {FLOORS.map((f) => {
        const area = f.area
        if (area === here) return <button key={f.n} type="button" className="btn btn-ghost btn-sm" disabled>{`${f.n}층 `}<span className="muted">지금 층</span></button>
        if (!area || !canGo(area)) return <button key={f.n} type="button" className="btn btn-ghost btn-sm" disabled>{`${f.n}층 `}<span className="muted">공사 중</span></button>
        return <button key={f.n} type="button" className="btn btn-ghost btn-sm" onClick={() => onGo(area)}>{`${f.n}층`}</button>
      })}
    </section>
  )
}
