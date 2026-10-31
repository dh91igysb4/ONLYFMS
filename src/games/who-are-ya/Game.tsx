import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { GameProps } from '../ui.ts'
import { compare, HINT_AFTER, MAX_GUESSES, type Arrow, type Feedback, type Snapshot, type State, type Tile } from './logic.ts'
import { FETCHED } from './data.ts'
import { DEFAULT_KIT, flag, KIT } from './kit.ts'
import { search, type Suggestion } from './search.ts'
import './wya.css'

function formatTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------- 그림 조각
const SHIRT = 'M21 7 L12 11 L3 23 L11 30 L16 25 L16 58 L48 58 L48 25 L53 30 L61 23 L52 11 L43 7 Q32 15 21 7 Z'
const SLEEVES = 'M21 7 L12 11 L3 23 L11 30 L16 25 L16 13 Z M43 7 L52 11 L61 23 L53 30 L48 25 L48 13 Z'

function KitShirt({ code }: { code: string }) {
  const id = 'wyak' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const [m, s, st] = KIT[code] ?? DEFAULT_KIT
  return (
    <svg className="wya-shirt" viewBox="0 0 64 64" aria-hidden="true">
      <defs><clipPath id={id}><path d={SHIRT} /></clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <rect width="64" height="64" fill={m} />
        {st === 's' && [18, 30, 42].map((x) => <rect key={x} x={x} y="0" width="6" height="64" fill={s} />)}
        {st === 'h' && <rect x="32" y="0" width="32" height="64" fill={s} />}
        {st === 'a' && <path d={SLEEVES} fill={s} />}
      </g>
      <path d={SHIRT} fill="none" stroke="#1c1030" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M21 7 Q32 15 43 7" fill="none" stroke={st === 'p' && s !== m ? s : '#1c1030'} strokeWidth="3" />
    </svg>
  )
}

function NumShirt({ n, fill }: { n: number | null; fill: string }) {
  return (
    <span className="wya-numshirt">
      <svg viewBox="0 0 64 64" aria-hidden="true"><path d={SHIRT} style={{ fill }} /></svg>
      <b>{n ?? '–'}</b>
    </span>
  )
}

function Flag({ cc, cn }: { cc: string; cn?: string }) {
  return (
    <span className="wya-flag" title={cn || cc} role="img" aria-label={cn || cc}>
      <span>{flag(cc)}</span>
    </span>
  )
}

function Chevrons({ dir }: { dir: '▲' | '▼' }) {
  return (
    <svg viewBox="0 0 20 34" aria-hidden="true" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      {dir === '▲'
        ? <><path d="M3 15 L10 8 L17 15" /><path d="M3 26 L10 19 L17 26" /></>
        : <><path d="M3 8 L10 15 L17 8" /><path d="M3 19 L10 26 L17 19" /></>}
    </svg>
  )
}

const TILE_WORD: Record<Tile, string> = { c: '일치', p: '같은 리그', a: '다름' }
const ARROW_WORD: Record<Exclude<Arrow, ''>, string> = { '▲': '정답이 더 큼', '▼': '정답이 더 작음' }

function TileBox({ label, k, arrow, children }: { label: string; k: Tile; arrow?: Arrow; children: ReactNode }) {
  const desc = `${label} ${TILE_WORD[k]}${arrow ? `, ${ARROW_WORD[arrow]}` : ''}`
  return (
    <div className="wya-tile" title={desc}>
      <div className={`wya-b wya-${k}`} aria-label={desc} role="img">
        <div className="wya-main">{children}</div>
        {arrow && <div className="wya-strip"><Chevrons dir={arrow} /></div>}
      </div>
      <div className="wya-l" aria-hidden="true">{label}</div>
    </div>
  )
}

function GuessRowView({ g, fb, className }: { g: Snapshot; fb: Feedback; className?: string }) {
  return (
    <li className={`wya-row ${className ?? ''}`}>
      <div>
        <div className="wya-nm">{g.name}</div>
        <div className="wya-cl">{g.team}</div>
      </div>
      <div className="wya-tiles">
        <TileBox label="클럽" k={fb.team}><KitShirt code={g.teamCode} /></TileBox>
        <TileBox label="국적" k={fb.nat}><Flag cc={g.cc} cn={g.cn} /></TileBox>
        <TileBox label="포지션" k={fb.pos}>{g.grp}</TileBox>
        <TileBox label="나이" k={fb.age} arrow={fb.ageArrow}>{g.age ?? '–'}</TileBox>
        <TileBox label="등번호" k={fb.shirt} arrow={fb.shirtArrow}>
          <NumShirt n={g.shirt} fill={fb.shirt === 'c' ? 'var(--shirt-hit)' : 'var(--shirt-miss)'} />
        </TileBox>
      </div>
    </li>
  )
}

/** 지금까지 맞힌 속성 (맞힌 추측의 값이 곧 정답의 값이다) */
function Revealed({ s }: { s: State }) {
  const hit = (k: keyof Feedback) => s.guesses.find((g) => g.fb[k] === 'c')
  const team = hit('team')
  const nat = hit('nat')
  const pos = hit('pos')
  const age = hit('age')
  const shirt = hit('shirt')
  if (!team && !nat && !pos && !age && !shirt) return null
  return (
    <div className="wya-rev" aria-label="맞힌 정보">
      {team && <span title={team.team}><KitShirt code={team.teamCode} /></span>}
      {nat && <Flag cc={nat.cc} cn={nat.cn} />}
      {pos && <span className="wya-x">{pos.grp}</span>}
      {age && <span className="wya-x">{age.age}세</span>}
      {shirt && <span className="wya-x">#{shirt.shirt}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- 검색
function Search({ guessed, n, busy, onPick }: { guessed: ReadonlySet<number>; n: number; busy: boolean; onPick(id: number): void }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const listId = useId()
  const list: Suggestion[] = useMemo(() => search(text, guessed), [text, guessed])
  const shown = open && list.length > 0

  function pick(id: number) {
    if (busy) return
    onPick(id)
    setText('')
    setOpen(false)
    setSel(0)
  }

  return (
    <div className="wya-search">
      <input
        type="text"
        role="combobox"
        aria-label="선수 이름 (영문, 한/영 상관없음)"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={`선수 이름 · ${n + 1}/${MAX_GUESSES}`}
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
            pick(list[Math.min(sel, list.length - 1)].id)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {shown && (
        <ul className="wya-sugg" id={listId} role="listbox" aria-label="선수 후보">
          {list.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === sel}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p.id)}
            >
              <Flag cc={p.cc} />
              <span className="wya-n">{p.name}</span>
              <span className="wya-m">{p.team} · {p.grp}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 화면
export function Game({ publicState, finished, score, reveal, busy, error, onAction, remainingMs }: GameProps) {
  const s = publicState as State
  const answer = reveal as Snapshot | undefined
  const [confirmGiveUp, setConfirmGiveUp] = useState(false)
  // 포기 확인은 3초 뒤나 추측이 늘면 풀린다.
  useEffect(() => {
    if (!confirmGiveUp) return
    const t = setTimeout(() => setConfirmGiveUp(false), 3000)
    return () => clearTimeout(t)
  }, [confirmGiveUp])
  const n = s.guesses.length
  useEffect(() => setConfirmGiveUp(false), [n])
  const guessed = useMemo(() => new Set(s.guesses.map((g) => g.id)), [s.guesses])
  const canHint = !busy && s.initials === null && n >= HINT_AFTER
  const rows = s.guesses.slice().reverse()

  return (
    <section className="wya">
      <div className="wya-meta">
        <strong>남은 기회 {MAX_GUESSES - n}</strong>
        {remainingMs !== null && !finished && <span className="muted wya-time">⏱ {formatTime(remainingMs)}</span>}
      </div>

      <div className="wya-card">
        <div className="wya-stage">
          {finished && answer ? (
            <div className="wya-ans">{answer.name}<small>{answer.team}</small></div>
          ) : (
            <>
              <Revealed s={s} />
              <div className="wya-q" aria-hidden="true">?</div>
            </>
          )}
        </div>

        {finished ? (
          answer && <ul className="wya-rows" aria-label="정답"><GuessRowView g={answer} fb={compare(answer, answer)} className="wya-answer" /></ul>
        ) : (
          <>
            <Search guessed={guessed} n={n} busy={busy} onPick={(id) => onAction({ type: 'guess', id })} />
            {s.initials && <p className="wya-hintline" role="status">이니셜 <b>{s.initials}</b></p>}
            <div className="wya-tools">
              <button type="button" disabled={!canHint} onClick={() => onAction({ type: 'hint' })}>
                {s.initials ? '힌트 사용함' : n >= HINT_AFTER ? '힌트(이니셜) -3점' : `힌트(이니셜)는 ${HINT_AFTER}번 틀린 뒤`}
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
      </div>

      {finished && (
        <div className="wya-result" role="status">
          <p className={`wya-msg ${s.won ? 'wya-win' : 'wya-lose'}`}>{s.won ? `${n}번 만에 정답` : '정답을 못 맞혔어요'}</p>
          {score !== null && <p className="wya-score">{score}점</p>}
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="wya-legend" aria-hidden="true">
        <span style={{ ['--c' as string]: 'var(--hit)' }}>같은 클럽</span>
        <span style={{ ['--c' as string]: 'var(--near)' }}>같은 리그, 다른 클럽</span>
        <span style={{ ['--c' as string]: 'var(--miss)' }}>다른 리그</span>
      </div>

      <ol className="wya-rows" aria-label="추측 기록" reversed>
        {rows.map((g, i) => (
          <GuessRowView key={g.id} g={g} fb={g.fb} className={i === 0 ? 'wya-latest' : ''} />
        ))}
      </ol>

      <p className="wya-foot">FotMob 스쿼드 {FETCHED} 수집 · 소속팀·등번호·나이는 수집 시점 기준</p>
    </section>
  )
}
