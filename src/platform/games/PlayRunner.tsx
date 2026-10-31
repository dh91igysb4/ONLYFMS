import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, errorMessage, play, type PlayView } from '../../lib/api.ts'
import { now, syncFromView } from '../../lib/serverTime.ts'
import { getGame } from '../../games/index.ts'
import { getGameComponent } from '../../games/ui.ts'
import type { Ctx } from '../../games/types.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import * as freeQueue from './freeQueue.ts'

export type PlayRunnerProps =
  | {
      mode: 'server'
      itemId: string
      /** 409 ended를 받았을 때. 없으면 문제를 다시 열어 종료 화면을 보여 준다. */
      onEnded?: () => void
    }
  | {
      mode: 'local'
      gameId: string
      options: Record<string, string>
      /** 주어지면 끝난 뒤 "한 판 더" 버튼을 보여 준다. */
      onNext?: () => void
    }

export function PlayRunner(props: PlayRunnerProps) {
  return props.mode === 'server' ? <ServerRunner {...props} /> : <LocalRunner {...props} />
}

function bodyOf(e: ApiError): { message?: string; view?: PlayView } {
  return (e.body ?? {}) as { message?: string; view?: PlayView }
}

function ServerRunner({ itemId, onEnded }: { itemId: string; onEnded?: () => void }) {
  const [view, setView] = useState<PlayView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  // 네트워크 오류로 결과를 모르는 요청. "다시 시도"가 같은 내용으로 다시 보낸다.
  const [retry, setRetry] = useState<{ kind: 'open' } | { kind: 'act'; payload: unknown } | null>(null)
  const [, setTick] = useState(0)
  const busyRef = useRef(false)
  const viewRef = useRef<PlayView | null>(null)

  const applyView = useCallback((v: PlayView) => {
    syncFromView(v.server_now)
    viewRef.current = v
    setView(v)
  }, [])

  const run = useCallback(
    async (kind: 'open' | 'act', payload?: unknown, reopened = false): Promise<void> => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setError(null)
      setRetry(null)
      try {
        const v =
          kind === 'open'
            ? await play({ action: 'open', item_id: itemId })
            : await play({
                action: 'act',
                item_id: itemId,
                expected_count: viewRef.current?.action_count ?? 0,
                payload,
              })
        applyView(v)
        if (kind === 'open') setNotice(null)
      } catch (e) {
        if (!(e instanceof ApiError)) {
          setError(errorMessage('unknown'))
        } else if (e.code === 'network' || e.status >= 500) {
          // 서버에 저장됐는지 모르므로 화면은 그대로 두고 다시 시도하게 한다.
          setError(errorMessage('network'))
          setRetry(kind === 'open' ? { kind: 'open' } : { kind: 'act', payload })
        } else if ((e.code === 'stale' || e.code === 'version_changed') && bodyOf(e).view) {
          applyView(bodyOf(e).view as PlayView)
          setNotice(errorMessage(e.code))
        } else if (e.code === 'ended' && kind === 'act') {
          busyRef.current = false
          if (onEnded) {
            onEnded()
          } else if (!reopened) {
            setBusy(false)
            await run('open', undefined, true)
            return
          } else {
            setError(errorMessage('ended'))
          }
        } else if (e.code === 'invalid_action') {
          setError(bodyOf(e).message ?? errorMessage('invalid_action'))
        } else if (kind === 'open') {
          setFatal(errorMessage(e.code))
        } else {
          setError(errorMessage(e.code))
        }
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [itemId, applyView, onEnded],
  )

  useEffect(() => {
    void run('open')
    // 문제가 바뀔 때만 다시 연다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  const live = view !== null && !view.finished
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [live])

  const Game = view ? getGameComponent(view.game_id) : undefined

  if (fatal) return <p className="form-error" role="alert">{fatal}</p>
  if (!view) {
    return (
      <div className="stack">
        {error ? <p className="form-error" role="alert">{error}</p> : <p className="muted">불러오는 중…</p>}
        {retry && <button className="btn btn-primary" onClick={() => void run('open')}>다시 시도</button>}
      </div>
    )
  }
  if (!Game) return <p className="form-error" role="alert">{errorMessage('unknown_game')}</p>

  const remainingMs = view.finished ? null : Math.max(0, Date.parse(view.ends_at) - now())

  return (
    <div className="stack">
      {notice && <p className="notice" role="status">{notice}</p>}
      {view.public_state !== null && view.public_state !== undefined ? (
        <Game
          publicState={view.public_state}
          finished={view.finished}
          score={view.score}
          reveal={view.reveal}
          busy={busy}
          error={error}
          remainingMs={remainingMs}
          onAction={(a) => void run('act', a)}
        />
      ) : (
        <>
          {view.score !== null && <p role="status">{view.score}점으로 마무리됐어요</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
      {retry && (
        <button className="btn btn-primary" disabled={busy} onClick={() => void run(retry.kind, retry.kind === 'act' ? retry.payload : undefined)}>
          다시 시도
        </button>
      )}
    </div>
  )
}

function LocalRunner({ gameId, options, onNext }: { gameId: string; options: Record<string, string>; onNext?: () => void }) {
  const { profile } = useAuth()
  const mod = getGame(gameId)
  const Game = getGameComponent(gameId)
  const init = useMemo(() => {
    if (!mod) return null
    const startedAt = Date.now()
    const puzzle = mod.logic.pickPuzzle(Math.random, options)
    const ctx: Ctx = { now: startedAt, startedAt, deadline: null }
    return { puzzle, startedAt, state: mod.logic.initState(puzzle, ctx) }
    // 새 판은 부모가 key로 다시 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [state, setState] = useState<unknown>(init?.state)
  const [error, setError] = useState<string | null>(null)
  const submitted = useRef(false)

  if (!mod || !Game || !init) return <p className="form-error" role="alert">{errorMessage('unknown_game')}</p>

  const ctx = (): Ctx => ({ now: Date.now(), startedAt: init.startedAt, deadline: null })
  const finished = mod.logic.isFinished(state, ctx())
  const score = finished ? mod.logic.score(state, ctx()) : null

  function onAction(action: unknown) {
    if (!mod || !init || finished) return
    const r = mod.logic.apply(init.puzzle, state, action, ctx())
    if ('error' in r) {
      setError(r.error)
      return
    }
    setError(null)
    setState(r.state)
    if (mod.logic.isFinished(r.state, ctx()) && !submitted.current) {
      submitted.current = true
      const final = mod.logic.score(r.state, ctx())
      void freeQueue.submit({
        client_id: crypto.randomUUID(),
        user_id: profile?.id ?? '',
        game_id: gameId,
        options,
        logic_version: mod.logic.version,
        solved: final > 0,
        score: final,
        action_count: mod.logic.actionCount(r.state),
      })
    }
  }

  return (
    <div className="stack">
      <Game
        publicState={mod.logic.publicState(state)}
        finished={finished}
        score={score}
        reveal={finished ? mod.logic.reveal(init.puzzle) : undefined}
        busy={false}
        error={error}
        remainingMs={null}
        onAction={onAction}
      />
      {finished && onNext && <button className="btn btn-primary" onClick={onNext}>한 판 더</button>}
    </div>
  )
}
