import type { ReactNode } from 'react'
import type { BlockState } from './useBlockData.ts'
import './home.css'

export function BlockFrame({ title, state, onRetry, children }: {
  title: string
  state: BlockState<unknown>
  onRetry: () => void
  children?: ReactNode
}) {
  return (
    <section className="card home-block" aria-label={title}>
      <h3 className="card-title">{title}</h3>
      {state.kind === 'loading' && <p className="muted">불러오는 중…</p>}
      {state.kind === 'error' && (
        <>
          <p className="muted">불러오지 못했어요</p>
          <div className="card-actions">
            <button type="button" className="btn" onClick={onRetry}>다시 시도</button>
          </div>
        </>
      )}
      {state.kind === 'done' && children}
    </section>
  )
}
