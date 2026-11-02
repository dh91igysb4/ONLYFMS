import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, errorMessage, play, type PlayView } from '../../lib/api.ts'
import { now, syncFromView } from '../../lib/serverTime.ts'
import { getGame } from '../../games/index.ts'
import { getGameComponent } from '../../games/ui.ts'
import type { Ctx } from '../../games/types.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import * as freeQueue from './freeQueue.ts'
import * as freeLogQueue from './freeLogQueue.ts'
import { newSeed, seedHex } from './seed.ts'
import { rngFromSeed } from '../../shared/rng.ts'

export type PlayRunnerProps =
  | {
      mode: 'server'
      itemId: string
      /** 409 ended를 받았을 때. 없으면 문제를 다시 열어 종료 화면을 보여 준다. */
      onEnded?: () => void
      /** 문제의 끝남 여부가 정해지거나 바뀔 때(처음 연 문제가 이미 끝났을 때 포함). */
      onFinishedChange?: (finished: boolean) => void
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

function ServerRunner({
  itemId,
  onEnded,
  onFinishedChange,
}: {
  itemId: string
  onEnded?: () => void
  onFinishedChange?: (finished: boolean) => void
}) {
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

  // 오류 메시지는 그대로 두고 화면만 서버 상태로 맞춘다. 실패해도 조용히 넘긴다.
  const refreshView = useCallback(async () => {
    try {
      applyView(await play({ action: 'open', item_id: itemId }))
    } catch (e) {
      // 409에 화면이 실려 오면 그것을 쓰고, 나머지는 다음 행동에서 다시 맞춰진다
      if (e instanceof ApiError && bodyOf(e).view) applyView(bodyOf(e).view as PlayView)
    }
  }, [itemId, applyView])

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
        } else if (e.status === 409 && bodyOf(e).view) {
          // stale·version_changed·finished·ended: 서버가 준 화면(상태·점수·정답)을 그대로 보여 준다
          applyView(bodyOf(e).view as PlayView)
          if (e.code === 'ended' && onEnded) onEnded()
          else setNotice(errorMessage(e.code))
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
          // 응답을 놓친 앞선 행동(예: 힌트)이 이미 반영됐을 수 있으니 화면을 서버 상태로 새로 고친다
          if (kind === 'act') void refreshView()
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
    [itemId, applyView, onEnded, refreshView],
  )

  // 남은 시간이 0이 된 뒤 한 번만 다시 연다. 서버가 그 시점 점수로 확정한 화면을 받는다.
  const expiredRef = useRef(false)

  useEffect(() => {
    expiredRef.current = false
    void run('open')
    // 문제가 바뀔 때만 다시 연다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  const finished = view ? view.finished : null
  const finishedCb = useRef(onFinishedChange)
  finishedCb.current = onFinishedChange
  useEffect(() => {
    if (finished !== null) finishedCb.current?.(finished)
  }, [finished])

  const live = view !== null && !view.finished
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [live])

  const remainingMs = view && !view.finished ? Math.max(0, Date.parse(view.ends_at) - now()) : null
  useEffect(() => {
    if (remainingMs !== 0 || expiredRef.current) return
    expiredRef.current = true
    void (async () => {
      await refreshView()
      if (viewRef.current?.finished) setNotice(errorMessage('timeout'))
    })()
  }, [remainingMs, refreshView])

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
          {view.score === null && view.finished && <p className="muted" role="status">이 문제는 풀지 않고 끝났어요</p>}
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
    const seed = newSeed()
    const puzzle = mod.logic.pickPuzzle(rngFromSeed(seed), options)
    const ctx: Ctx = { now: startedAt, startedAt, deadline: null }
    return { puzzle, seed, startedAt, state: mod.logic.initState(puzzle, ctx) }
    // 새 판은 부모가 key로 다시 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [, setState] = useState<unknown>(init?.state)
  // 화면이 다시 그려지기 전에 onAction이 여러 번 불려도 매번 직전 결과에 적용하려고 ref로 쥔다.
  const stateRef = useRef<unknown>(init?.state)
  // 적용된 행동과 출제 시드. 제출 지점이 읽어 간다.
  const actionsRef = useRef<unknown[]>([])
  const seedRef = useRef<Uint8Array>(init?.seed ?? new Uint8Array(16))
  const [error, setError] = useState<string | null>(null)
  const submitted = useRef(false)

  if (!mod || !Game || !init) return <p className="form-error" role="alert">{errorMessage('unknown_game')}</p>

  const ctx = (): Ctx => ({ now: Date.now(), startedAt: init.startedAt, deadline: null })
  const state = stateRef.current
  const finished = mod.logic.isFinished(state, ctx())
  const score = finished ? mod.logic.score(state, ctx()) : null

  function onAction(action: unknown) {
    if (!mod || !init) return
    const cur = stateRef.current
    if (mod.logic.isFinished(cur, ctx())) return
    const r = mod.logic.apply(init.puzzle, cur, action, ctx())
    if ('error' in r) {
      setError(r.error)
      return
    }
    setError(null)
    actionsRef.current.push(action)
    stateRef.current = r.state
    setState(r.state)
    if (mod.logic.isFinished(r.state, ctx()) && !submitted.current) {
      submitted.current = true
      const final = mod.logic.score(r.state, ctx())
      const clientId = crypto.randomUUID()
      const userId = profile?.id ?? ''
      const p = freeQueue.submit({
        client_id: clientId,
        user_id: userId,
        game_id: gameId,
        options,
        logic_version: mod.logic.version,
        solved: final > 0,
        score: final,
        action_count: mod.logic.actionCount(r.state),
      })
      void freeLogQueue.submitLog(
        { client_id: clientId, user_id: userId, seed: seedHex(seedRef.current), actions: [...actionsRef.current] },
        p,
      )
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
