// 메인 화면(메인 미리보기 설계 §4): 정사각형 밸리 미리보기 + 이름만 있는 바로가기 버튼.
// 미리보기는 manifest `preview`가 있는 지속형 게임을 등록부(getWorldPreview)로 찾는다(게임 id 분기 없음).
// 메인은 world 함수를 부르지 않는다: 옷차림·열린 지역은 user_records, 위치는 브라우저 저장값(게임 쪽)에서 읽는다.
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { worlds } from '../../games/index.ts'
import { getWorldPreview } from '../../games/ui.ts'
import { rpc } from '../../lib/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { Shortcuts } from './Shortcuts.tsx'
import './home.css'

/** 미리보기 정사각형 한 변의 최대(px) */
const MAX_SIZE = 480
const FALLBACK_SIZE = 320

type RecordRow = { game_id: string; key: string; value: number; detail: string | null }
type PreviewRecord = { key: string; detail: string | null }

/** 렌더 중 예외를 잡아 대체 화면으로 바꾼다 */
class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const clampSize = (w: number) => Math.max(1, Math.min(MAX_SIZE, Math.floor(w)))

export function HomePage() {
  const { profile } = useAuth()
  const isAdmin = !!profile?.is_admin
  const target = worlds.find((w) => w.manifest.preview && getWorldPreview(w.manifest.id) && (!w.manifest.hidden || isAdmin))
  const Preview = target ? getWorldPreview(target.manifest.id) : undefined
  const [records, setRecords] = useState<PreviewRecord[]>([])
  const [failed, setFailed] = useState(false)
  const [size, setSize] = useState(FALLBACK_SIZE)
  const boxRef = useRef<HTMLDivElement>(null)
  const gameId = target?.manifest.id
  const handle = profile?.handle

  useEffect(() => {
    if (!gameId || !handle) return
    let alive = true
    rpc<RecordRow[] | null>('user_records', { p_handle: handle })
      .then((rows) => {
        if (!alive) return
        setRecords((rows ?? []).filter((r) => r.game_id === gameId).map((r) => ({ key: r.key, detail: r.detail })))
      })
      .catch(() => { /* 기본 옷차림·기본 지역으로 그린다 */ })
    return () => { alive = false }
  }, [gameId, handle])

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    if (el.clientWidth > 0) setSize(clampSize(el.clientWidth))
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setSize(clampSize(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const name = target ? `${target.manifest.name} 들어가기` : ''
  const fallback = target ? (
    <Link className="btn btn-primary home-valley-fallback" to={`/world/${target.manifest.id}`} aria-label={name}>{name}</Link>
  ) : null

  return (
    <div className="home">
      <h2 className="sr-only">홈</h2>
      <div ref={boxRef} className="home-valley-box">
        {target && Preview && (failed ? fallback : (
          <PreviewBoundary fallback={fallback}>
            <Link className="home-valley" to={`/world/${target.manifest.id}`} aria-label={name} style={{ width: size, height: size }}>
              <Preview userId={profile?.id ?? ''} records={records} size={size} onFail={() => setFailed(true)} />
              <span className="home-valley-enter" aria-hidden="true">들어가기</span>
            </Link>
          </PreviewBoundary>
        ))}
      </div>
      <Shortcuts />
    </div>
  )
}
