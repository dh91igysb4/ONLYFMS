import { moveDown, moveUp, toggle } from './layout.ts'
import type { HomeLayoutEntry } from './layout.ts'

type Props = {
  layout: HomeLayoutEntry[]
  titles: Record<string, string>
  onChange: (next: HomeLayoutEntry[]) => void
  disabled?: boolean
}

export function EditList({ layout, titles, onChange, disabled = false }: Props) {
  return (
    <div className="home-list">
      {layout.map((entry, i) => {
        const title = titles[entry.id] ?? entry.id
        return (
          <div key={entry.id} className="home-edit-row" data-off={entry.on ? undefined : 'true'}>
            <span style={{ flex: 1 }}>{title}</span>
            <button type="button" role="switch" aria-checked={entry.on} aria-label={`${title} 표시`}
              className="btn btn-sm btn-ghost" disabled={disabled}
              onClick={() => onChange(toggle(layout, entry.id))}>
              {entry.on ? '켜짐' : '꺼짐'}
            </button>
            <button type="button" aria-label={`${title} 위로`} className="btn btn-sm btn-ghost"
              disabled={disabled || i === 0} onClick={() => onChange(moveUp(layout, entry.id))}>↑</button>
            <button type="button" aria-label={`${title} 아래로`} className="btn btn-sm btn-ghost"
              disabled={disabled || i === layout.length - 1} onClick={() => onChange(moveDown(layout, entry.id))}>↓</button>
          </div>
        )
      })}
    </div>
  )
}
