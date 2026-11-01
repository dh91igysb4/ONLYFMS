import { useRef, useState } from 'react'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { homeBlockIds, homeBlocks } from './blocks.ts'
import { EditList } from './EditList.tsx'
import { resolveLayout, toSaved } from './layout.ts'
import type { HomeLayoutEntry } from './layout.ts'
import './home.css'

const titles: Record<string, string> = Object.fromEntries(homeBlocks.map((b) => [b.id, b.title]))

export function HomePage() {
  const { profile, refresh } = useAuth()
  // undefined = 이번 마운트에서 저장한 적 없음. 저장 성공 후에는 보낸 값(배열 또는 null)
  const [savedLayout, setSavedLayout] = useState<HomeLayoutEntry[] | null | undefined>(undefined)
  const [editing, setEditing] = useState<HomeLayoutEntry[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)

  const effective = savedLayout !== undefined ? savedLayout : profile?.home_layout
  const layout = resolveLayout(effective, homeBlockIds)

  function startEdit() {
    setError(null)
    setEditing(layout.map((e) => ({ ...e })))
  }

  function cancel() {
    setError(null)
    setEditing(null)
  }

  async function save() {
    if (!editing || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    const toSend = toSaved(editing, homeBlockIds)
    try {
      await rpc('set_home_layout', { p_layout: toSend })
      setSavedLayout(toSend)
      setEditing(null)
      void refresh()
    } catch (e) {
      setError(errorMessage(e instanceof ApiError ? e.code : 'network'))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="stack">
        <h2>홈</h2>
        {error && <p className="form-error" role="alert">{error}</p>}
        <EditList layout={editing} titles={titles} onChange={setEditing} disabled={saving} />
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>완료</button>
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={cancel}>취소</button>
          <button type="button" className="btn btn-ghost" disabled={saving}
            onClick={() => setEditing(resolveLayout(null, homeBlockIds))}>기본값으로</button>
        </div>
      </div>
    )
  }

  const visible = layout.filter((e) => e.on)
  const byId = new Map(homeBlocks.map((b) => [b.id, b]))
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>홈</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={startEdit}>편집</button>
      </div>
      {visible.length === 0 ? (
        <p className="muted">표시할 블록이 없어요. 편집에서 켜 주세요</p>
      ) : (
        <div className="home-grid">
          {visible.map((e) => {
            const block = byId.get(e.id)
            return block ? <block.Component key={block.id} title={block.title} /> : null
          })}
        </div>
      )}
    </div>
  )
}
