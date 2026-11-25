import { useEffect, useRef, useState } from 'react'
import type { DuelGameProps } from '../ui.ts'
import type { Action, Last, View } from './logic.ts'
import { manifest } from './manifest.ts'
import { searchPlayers, type PlayerHit } from './search.ts'
import './ttt.css'

const DEBOUNCE_MS = 250
/** 테마 이름은 manifest 설정 선택지의 라벨을 쓴다(잉글랜드·스페인·이탈리아·독일·유럽 전체) */
const THEME_LABELS = new Map((manifest.options.find((o) => o.key === 'theme')?.choices ?? []).map((c) => [c.value, c.label]))

function lastLine(last: Last, names: [string, string]): string {
  const who = names[last.seat]
  let what: string
  if (last.type === 'pass') what = '턴 넘김'
  else if (last.type === 'acceptDraw') what = '무승부 수락'
  else {
    const verdict = last.steal ? (last.correct ? '스틸 성공' : '스틸 실패') : last.correct ? '맞음' : '틀림'
    what = `${last.name || '이름 없음'} → ${verdict}`
  }
  return `${who}: ${what}${last.offeredDraw ? ' · 무승부 제안' : ''}`
}

type SheetProps = {
  title: string
  busy: boolean
  onPick(hit: PlayerHit): void
  onClose(): void
}

function SearchSheet({ title, busy, onPick, onClose }: SheetProps) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlayerHit[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle')
  const seq = useRef(0)

  useEffect(() => {
    const term = q.trim()
    const n = ++seq.current
    if (term === '') {
      setHits([])
      setStatus('idle')
      return
    }
    setStatus('loading')
    const t = setTimeout(() => {
      searchPlayers(term).then(
        (r) => { if (n === seq.current) { setHits(r); setStatus('done') } },
        () => { if (n === seq.current) { setHits([]); setStatus('failed') } },
      )
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => () => { seq.current++ }, [])

  return (
    <div className="ttt-backdrop" onClick={onClose}>
      <div
        className="ttt-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      >
        <div className="ttt-sheet-head">
          <p className="ttt-sheet-title">{title}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>닫기</button>
        </div>
        <input
          type="search"
          className="input"
          placeholder="선수 이름"
          aria-label="선수 이름"
          autoFocus
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="ttt-hits" aria-live="polite">
          {status === 'loading' && <p className="muted ttt-note">찾는 중…</p>}
          {status === 'failed' && <p className="form-error ttt-note">검색하지 못했어요</p>}
          {status === 'done' && hits.length === 0 && <p className="muted ttt-note">찾는 선수가 없어요</p>}
          {status === 'done' && hits.map((h) => (
            <button key={h.id} type="button" className="ttt-hit" disabled={busy} onClick={() => onPick(h)}>
              <span className="ttt-hit-name">{h.name}</span>
              <span className="ttt-hit-meta">{[h.nation, h.birthYear !== null ? `${h.birthYear}년생` : null].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Game({ view, mySeat, toMove, finished, busy, error, onAction, names, header, footer }: DuelGameProps) {
  const v = view as View
  const mine = !finished && mySeat !== null && toMove === mySeat && v.toMove === mySeat
  const other = mySeat === null ? null : ((1 - mySeat) as 0 | 1)
  const mySteals = mySeat === null ? 0 : v.steals[mySeat]
  // 차례가 바뀌면 고른 칸·제안 체크를 버린다 (같은 화면에서는 한 컴포넌트가 두 사람 차례를 오간다)
  const turnKey = JSON.stringify([v.toMove, v.last, v.quiet])
  const [pickState, setPick] = useState<{ k: string; cell: number | null }>({ k: turnKey, cell: null })
  const [offerState, setOffer] = useState<{ k: string; on: boolean }>({ k: turnKey, on: false })
  const canOffer = mine && mySeat !== null && v.canOffer[mySeat]
  const offer = canOffer && offerState.k === turnKey && offerState.on

  const pickable = (i: number) => {
    if (!mine || busy) return false
    const o = v.cells[i].owner
    if (o === null) return true
    return o === other && mySteals > 0
  }
  const picked = pickState.k === turnKey && pickState.cell !== null && pickable(pickState.cell) ? pickState.cell : null

  function send(a: Action) {
    setOffer({ k: turnKey, on: false })
    setPick({ k: turnKey, cell: null })
    onAction(a)
  }
  const withOffer = <T extends Action>(a: T): T => (offer ? { ...a, offerDraw: true } : a)

  const rowLabel = (i: number) => v.rows[Math.floor(i / 3)].label
  const colLabel = (i: number) => v.cols[i % 3].label

  const theme = (v.theme && THEME_LABELS.get(v.theme)) || ''

  const offeredToMe = mine && other !== null && v.drawOffer === other

  return (
    <div className="ttt">
      {header && <div className="stack ttt-head">{header}</div>}

      <div className="ttt-board" role="group" aria-label="판">
        <div className="ttt-corner" data-testid="ttt-corner">{theme}</div>
        {v.cols.map((c) => <div key={c.id} className="ttt-label ttt-col">{c.label}</div>)}
        {v.rows.map((r, ri) => (
          <div key={r.id} className="ttt-row-wrap">
            <div className="ttt-label ttt-row">{r.label}</div>
            {[0, 1, 2].map((ci) => {
              const i = ri * 3 + ci
              const cell = v.cells[i]
              const isOpp = cell.owner !== null && cell.owner === other
              const isLast = v.last?.type === 'guess' && v.last.cell === i
              const ex = finished && v.examples ? v.examples[i] ?? [] : null
              return (
                <button
                  key={i}
                  type="button"
                  data-testid={`ttt-cell-${i}`}
                  className={`ttt-cell${cell.owner !== null ? ` ttt-seat${cell.owner}` : ''}${isLast ? ' ttt-last' : ''}`}
                  aria-label={`${rowLabel(i)} · ${colLabel(i)}${cell.name ? `, ${names[cell.owner ?? 0]} ${cell.name}` : ', 빈 칸'}${mine && isOpp ? `, 스틸(남은 ${mySteals}번)` : ''}`}
                  disabled={!pickable(i)}
                  onClick={() => setPick({ k: turnKey, cell: i })}
                >
                  {cell.name && <span className="ttt-name">{cell.name}</span>}
                  {mine && isOpp && <span className="ttt-steal">스틸(남은 {mySteals}번)</span>}
                  {ex && (
                    <span className="ttt-ex" data-testid={`ttt-examples-${i}`}>
                      {ex.length === 0 ? <span>예시 없음</span> : ex.map((n, k) => <span key={k}>{n}</span>)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className="ttt-info">
        <p className="ttt-steals">
          {[0, 1].map((s) => (
            <span key={s} className="ttt-who">
              <span className={`ttt-chip ttt-seat${s}`} aria-hidden="true" />
              {names[s]}: 스틸 {v.steals[s]}
            </span>
          ))}
        </p>
        {v.last && <p className="ttt-lastline">마지막 — {lastLine(v.last, names)}</p>}
      </div>

      {!finished && (
        <div className="ttt-controls">
          {offeredToMe && (
            <div className="ttt-offer" role="status">
              <p>{names[other!]}님이 무승부를 제안했어요. 수락하지 않고 두면 거절돼요.</p>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send({ type: 'acceptDraw' })}>무승부 수락</button>
            </div>
          )}
          {!mine && mySeat !== null && v.drawOffer === mySeat && <p className="muted ttt-note">무승부를 제안했어요</p>}
          <div className="ttt-row-actions">
            <button type="button" className="btn btn-ghost" disabled={!mine || busy} onClick={() => send(withOffer({ type: 'pass' }))}>턴 넘기기</button>
            <label className={`ttt-check${canOffer ? '' : ' ttt-check-off'}`}>
              <input
                type="checkbox"
                checked={offer}
                disabled={!canOffer || busy}
                onChange={(e) => setOffer({ k: turnKey, on: e.target.checked })}
              />
              무승부 제안
            </label>
          </div>
          {mine && <p className="muted ttt-note">칸을 눌러 가로·세로 조건을 모두 만족하는 선수를 대세요</p>}
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {footer && <div className="stack ttt-foot">{footer}</div>}

      {picked !== null && (
        <SearchSheet
          title={`${rowLabel(picked)} · ${colLabel(picked)}${v.cells[picked].owner !== null ? ` — 스틸(남은 ${mySteals}번)` : ''}`}
          busy={busy}
          onClose={() => setPick({ k: turnKey, cell: null })}
          onPick={(h) => send(withOffer({ type: 'guess', cell: picked, playerId: h.id, name: h.name }))}
        />
      )}
    </div>
  )
}
