import type { ReactNode } from 'react'

/** 표 판(FM 개편 설계 §4.4 순위): 제목 띠 왼쪽 제목, 오른쪽 N명 */
export function LbPanel({ title, count, children }: { title: ReactNode; count?: number; children: ReactNode }) {
  return (
    <section className="fm-panel lb-panel">
      <h3 className="fm-panel-head">{title}{count !== undefined && <span className="fm-panel-aside">{count}명</span>}</h3>
      <div className="lb-scroll">{children}</div>
    </section>
  )
}

export type Col = { label: string; num?: boolean; sorted?: boolean; rank?: boolean }
export type Row = { id: string; top: boolean; me: boolean; cells: ReactNode[] }

/** 리더보드 공통 표 (theme.css .fm-table + leaderboard.css). 1~3위(top)는 왼쪽 막대, 내 줄은 is-me, 정렬 기준 열(sorted)은 굵게 + aria-sort. */
export function LbTable({ cols, rows }: { cols: Col[]; rows: Row[] }) {
  const cellCls = (c: Col) => [c.num && 'num', c.sorted && 'key', c.rank && 'rank'].filter(Boolean).join(' ') || undefined
  return (
    <table className="fm-table lb-table">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.label} scope="col" className={c.num ? 'num' : undefined} aria-sort={c.sorted ? 'descending' : undefined}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={[r.top && 'top', r.me && 'is-me'].filter(Boolean).join(' ') || undefined}>
            {r.cells.map((cell, i) => <td key={cols[i].label} className={cellCls(cols[i])}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
