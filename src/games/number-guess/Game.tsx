import { useState } from 'react'
import type { GameProps } from '../ui.ts'
import { MAX_GUESSES, type State } from './logic.ts'

const FEEDBACK = {
  up: '↑ 더 큰 수예요',
  down: '↓ 더 작은 수예요',
  hit: '정답!',
} as const

function formatTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Game({ publicState, finished, score, reveal, busy, error, onAction, remainingMs }: GameProps) {
  const s = publicState as State
  const [text, setText] = useState('')
  const [confirmGiveUp, setConfirmGiveUp] = useState(false)
  const answer = (reveal as { answer?: number } | undefined)?.answer
  const trimmed = text.trim()
  const valid = /^\d+$/.test(trimmed)

  function submit() {
    if (busy || finished || !valid) return
    onAction({ type: 'guess', value: Number(trimmed) })
    setText('')
  }

  return (
    <section className="ng">
      <div className="ng-meta">
        <strong>남은 기회 {MAX_GUESSES - s.guesses.length}</strong>
        {remainingMs !== null && !finished && <span className="muted ng-time">⏱ {formatTime(remainingMs)}</span>}
      </div>

      {s.parity && (
        <p className="ng-hint" role="status">힌트: 정답은 {s.parity === 'even' ? '짝수' : '홀수'}예요</p>
      )}

      <ol className="ng-list" aria-label="추측 기록">
        {s.guesses.map((g, i) => (
          <li key={i} className={`ng-row ng-${s.feedback[i]}`}>
            <span className="ng-num">{g}</span>
            <span>{FEEDBACK[s.feedback[i]]}</span>
          </li>
        ))}
      </ol>

      {finished ? (
        <div className="ng-result" role="status">
          {answer !== undefined && <p>정답은 {answer}였어요</p>}
          {score !== null && <p className="ng-score">{score}점</p>}
        </div>
      ) : (
        <>
          <div className="ng-input">
            <input
              className="input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="추측할 숫자"
              placeholder="숫자를 입력하세요"
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            />
            <button className="btn btn-primary" disabled={busy || !valid} onClick={submit}>추측</button>
          </div>
          <div className="ng-actions">
            <button className="btn btn-ghost" disabled={busy || s.hintUsed} onClick={() => onAction({ type: 'hint' })}>
              힌트 (-1점)
            </button>
            {confirmGiveUp ? (
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => { setConfirmGiveUp(false); onAction({ type: 'give_up' }) }}
              >
                정말 포기할까요?
              </button>
            ) : (
              <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmGiveUp(true)}>포기</button>
            )}
          </div>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  )
}
