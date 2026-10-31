import type { ReactNode } from 'react'

export type Col = { label: string; num?: boolean; sorted?: boolean; rank?: boolean }
export type Row = { id: string; top: boolean; me: boolean; cells: ReactNode[] }

/** 리더보드 공통 표 (leaderboard.css). 1~3위(top)는 왼쪽 막대, 정렬 기준 열(sorted)은 굵게 + aria-sort. */
export function LbTable({ cols, rows }: { cols: Col[]; rows: Row[] }) {
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
