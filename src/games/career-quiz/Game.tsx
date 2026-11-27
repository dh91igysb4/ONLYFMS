import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { GameProps } from '../ui.ts'
import { searchFootballPlayers, type FootballPlayerHit } from '../../lib/footballSearch.ts'
import { NATIONS } from './nations.ts'
import { HINT_AFTER, HINT_PENALTY, MAX_TRIES, type PublicLine, type PublicState, type Reveal } from './logic.ts'
import './cq.css'

function years(from: number, to: number | null): string {
  return to === null ? `${from}–` : from === to ? `${from}` : `${from}–${to}`
}

function Career({ lines, label }: { lines: readonly PublicLine[]; label: string }) {
  return (
    <ol className="cq-lines" aria-label={label}>
      {lines.map((l, i) => (
        <li key={i} className={l[2] === null ? 'cq-line cq-hidden' : 'cq-line'}>
          <span className="cq-years">{years(l[0], l[1])}</span>
          {l[2] === null ? (
            <span className="cq-team" aria-label="가린 클럽">■■■</span>
          ) : (
            <span className="cq-team">
              {l[2]}
              {l[3] === 1 && <span className="cq-loan">임대</span>}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------- 검색
/** iso2(gb-eng 같은 지역은 태그 시퀀스) → 국기 이모지. 없으면 흰 깃발(후알야와 같다) */
function flagEmoji(iso: string): string {
  if (iso === '') return '🏳️'
  const [cc, sub] = iso.split('-')
  if (sub) return String.fromCodePoint(0x1f3f4, ...[...cc + sub].map((ch) => 0xe0000 + ch.charCodeAt(0)), 0xe007f)
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 97))
}

function Flag({ nationId }: { nationId: string | null }) {
  const [iso, name] = (nationId && NATIONS[nationId]) || ['', '국적 모름']
  return (
    <span className="cq-flag" title={name} role="img" aria-label={name}>
      <span>{flagEmoji(iso)}</span>
    </span>
  )
}

const DEBOUNCE_MS = 250

function Search({ guessed, n, busy, onPick }: {
  guessed: ReadonlySet<string>
  n: number
  busy: boolean
  onPick(hit: FootballPlayerHit): void
}) {
  const [text, setText] = useState('')
  const [hits, setHits] = useState<FootballPlayerHit[]>([])
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const listId = useId()
  const seq = useRef(0)

  useEffect(() => {
    const my = ++seq.current
    if (text.trim() === '') {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      searchFootballPlayers(text, 10).then(
        (r) => { if (my === seq.current) { setHits(r); setFailed(false) } },
        () => { if (my === seq.current) { setHits([]); setFailed(true) } },
      )
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text])

  const list = useMemo(() => hits.filter((h) => !guessed.has(h.id)).slice(0, 8), [hits, guessed])
  const shown = open && list.length > 0

  function pick(h: FootballPlayerHit) {
    if (busy) return
    onPick(h)
    setText('')
    setHits([])
    setOpen(false)
    setSel(0)
  }

  return (
    <div className="cq-search">
      <input
        type="text"
        role="combobox"
        aria-label="선수 이름 (영문·한글로 검색)"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={`선수 이름 · ${n + 1}/${MAX_TRIES}`}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        value={text}
        readOnly={busy}
        onChange={(e) => { setText(e.target.value); setOpen(true); setSel(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!shown) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(list[Math.min(sel, list.length - 1)])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {failed && <p className="form-error" role="alert">검색이 안 돼요. 잠시 뒤 다시 입력해 주세요</p>}
      {shown && (
        <ul className="cq-sugg" id={listId} role="listbox" aria-label="선수 후보">
          {list.map((h, i) => (
            <li
              key={h.id}
              role="option"
              aria-selected={i === sel}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
            >
              <Flag nationId={h.nation_id} />
              <span className="cq-n">{h.name_en}</span>
              <span className="cq-m">{[h.position, h.birth_year].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 화면
export function Game({ publicState, finished, score, reveal, busy, error, onAction }: GameProps) {
  const s = publicState as PublicState
  const answer = reveal as Reveal | undefined
  const [confirmGiveUp, setConfirmGiveUp] = useState(false)
  const used = s.guesses.length + s.opens
  useEffect(() => {
    if (!confirmGiveUp) return
    const t = setTimeout(() => setConfirmGiveUp(false), 3000)
    return () => clearTimeout(t)
  }, [confirmGiveUp])
  useEffect(() => setConfirmGiveUp(false), [used])
  const guessed = useMemo(() => new Set(s.guesses.map((g) => g.id)), [s.guesses])
  const challenge = s.mode === 'challenge'
  const canOpen = challenge && !busy && s.opened < s.lines.length
  const canHint = !busy && s.initials === null && s.guesses.length >= HINT_AFTER
  const lines: readonly PublicLine[] = finished && answer ? answer.lines : s.lines

  return (
    <section className="cq">
      {/* 넓은 화면: 왼쪽(따라붙음) 경력·입력·도구·결과, 오른쪽 답한 선수 기록 (후알야와 같다) */}
      <div className="split split-sticky">
        <div className="cq-side">
          <div className="cq-meta">
            <strong>남은 기회 {MAX_TRIES - used}</strong>
            <span className="muted">{challenge ? `챌린지 · 열린 줄 ${s.opened}/${s.lines.length}` : '일반'}</span>
          </div>

          <div className="card cq-card">
            {finished && answer && (
              <p className="cq-ans">{answer.nameEn}</p>
            )}
            <Career lines={lines} label={finished ? '정답 선수의 경력' : '경력'} />
            {!finished && canOpen && (
              <button type="button" className="btn btn-ghost btn-sm cq-open" onClick={() => onAction({ type: 'open' })}>
                한 줄 열기 (기회 1번 사용)
              </button>
            )}
          </div>

          {!finished && (
            <>
              <Search
                guessed={guessed}
                n={used}
                busy={busy}
                onPick={(h) => onAction({ type: 'guess', id: h.id, name: h.name_en })}
              />
              {s.initials && <p className="cq-hintline" role="status">이니셜 <b>{s.initials}</b></p>}
              <div className="cq-tools">
                <button type="button" disabled={!canHint} onClick={() => onAction({ type: 'hint' })}>
                  {s.initials ? '힌트 사용함' : s.guesses.length >= HINT_AFTER ? `힌트(이니셜) -${HINT_PENALTY}점` : `힌트(이니셜)는 ${HINT_AFTER}번 답한 뒤`}
                </button>
                {confirmGiveUp ? (
                  <button type="button" disabled={busy} onClick={() => { setConfirmGiveUp(false); onAction({ type: 'give_up' }) }}>
                    한 번 더 누르면 포기
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setConfirmGiveUp(true)}>포기하고 정답 보기</button>
                )}
              </div>
            </>
          )}

          {finished && (
            <div className="cq-result" role="status">
              <p className={s.won ? 'cq-win' : 'cq-lose'}>
                {s.won ? (challenge ? `${s.opened}줄 보고 정답` : `${s.guesses.length}번 만에 정답`) : '정답을 못 맞혔어요'}
              </p>
              {score !== null && <p className="cq-score">{score}점</p>}
            </div>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="cq-hist">
          <h3 className="cq-histhead">답한 선수{s.guesses.length > 0 && ` ${s.guesses.length}`}</h3>
          {s.guesses.length > 0 ? (
            <ol className="cq-guesses" aria-label="답한 선수">
              {s.guesses.map((g) => (
                <li key={g.id} className={s.won && g === s.guesses[s.guesses.length - 1] ? 'cq-hit' : ''}>{g.name}</li>
              ))}
            </ol>
          ) : (
            <p className="cq-histempty muted">아직 답한 선수가 없어요</p>
          )}

          <p className="cq-foot muted">경력: 위키데이터(CC0) · 1군 클럽만, 연도는 시즌 기준이 아닐 수 있어요</p>
        </div>
      </div>
    </section>
  )
}
