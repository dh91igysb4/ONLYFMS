// 내 섬 창(내 섬 설계 docs/superpowers/specs/2026-11-25-my-island-design.md §5.3).
// 배 창: 마을 선착장에서 섬(낚시 섬)·내 섬·친구 섬 중 고른다. 섬 고르기 창: 처음 내 섬에 갈 때 모양을 하나 고른다.
// 섬 그림 캔버스 내부 색은 낚시 캔버스 예외.
import { useEffect, useRef } from 'react'
import type { WorldPlayer } from '../../lib/api.ts'
import { ISLE_LAYOUTS, type IsleLayoutId } from './data.ts'
import { isleMap } from './isle.ts'

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
