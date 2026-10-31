// 대국 화면의 서버 상태 훅 (대전 설계 §7.2, §10).
// - 마운트 시 view, Realtime "바뀜" 신호마다 view, 신호와 무관하게 5초마다 view.
// - 마감이 지나면 그 마감에 대해 tick을 한 번만 보낸다(409 not_due면 마감이 바뀔 때까지 기다린다).
// - 409에 최신 화면(view)이 실려 오면 조용히 그것으로 바꾼다. version_changed만 문구를 띄운다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, duel, duelErrorMessage, type DuelView } from '../../lib/api.ts'
import { supabase } from '../../lib/supabase.ts'
import { now, syncFromView } from '../../lib/serverTime.ts'

/** duel_list()의 대국 한 줄 (0009_duel.sql `_duel_item`) */
export type DuelListItem = {
  id: string
  game_id: string
  rated: boolean
  visibility: 'public' | 'invite'
  turn_seconds: number
  status: DuelView['status']
  players: { id: string; handle: string | null; rating: number }[]
  created_by_handle: string | null
  created_at: string
  winner: 0 | 1 | null
  end_reason: string | null
  final_scores: [number, number] | null
}
export type DuelList = { lobby: DuelListItem[]; mine: DuelListItem[]; recent: DuelListItem[]; due: string[] }

export const POLL_MS = 5000
const CLOCK_MS = 1000
/** tick이 네트워크 오류 등으로 실패했을 때 다시 보내기까지 */
const TICK_RETRY_MS = 5000

const RANK: Record<DuelView['status'], number> = { waiting: 0, active: 1, finished: 2, void: 2 }

/** 늦게 도착한 옛 응답이 새 화면을 덮지 않게 한다 (action_no는 늘기만 하고, 상태는 되돌아가지 않는다) */
function isNewer(next: DuelView, cur: DuelView | null): boolean {
  if (!cur || cur.match_id !== next.match_id) return true
  if (next.action_no !== cur.action_no) return next.action_no > cur.action_no
  return RANK[next.status] >= RANK[cur.status]
}

function bodyView(e: unknown): DuelView | null {
  if (!(e instanceof ApiError)) return null
  const v = (e.body as { view?: DuelView } | undefined)?.view
  return v && typeof v === 'object' ? v : null
}

export type DuelMatch = {
  view: DuelView | null
  error: string | null
  /** 처음 불러오기에서 대국을 볼 수 없다고 확정된 경우(없음·참가자 아님 등) */
  fatal: string | null
  busy: boolean
  act(payload: unknown): void
  resign(): void
  cancel(): void
}

export function useDuelMatch(id: string): DuelMatch {
  const [view, setView] = useState<DuelView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const viewRef = useRef<DuelView | null>(null)
  const busyRef = useRef(false)
  const alive = useRef(true)
  /** 대국이 바뀔 때마다 1 증가. 이전 대국의 응답·오류는 이 값이 다르면 버린다 */
  const gen = useRef(0)
  /** view 요청은 한 번에 하나. 진행 중에 또 필요해지면 끝난 뒤 한 번만 다시 부른다 */
  const inflightRef = useRef(false)
  const rerunRef = useRef(false)
  /** 이 마감에 대해 tick을 이미 보냈다 */
  const tickedFor = useRef<string | null>(null)
  const tickRetryAt = useRef(0)
  const idRef = useRef(id)
  idRef.current = id

  /** 요청을 보낸 시점의 대국이 아직 이 화면의 대국인가 */
  const current = useCallback((g: number, forId: string) => alive.current && g === gen.current && forId === idRef.current, [])

  const apply = useCallback((v: DuelView) => {
    if (!alive.current || v.match_id !== idRef.current) return
    if (!isNewer(v, viewRef.current)) return
    syncFromView(v.server_now)
    viewRef.current = v
    setView(v)
  }, [])

  // 화면만 서버 상태로 맞춘다. 실패는 조용히 넘기고 다음 폴링이 다시 맞춘다.
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const refresh = useCallback(async () => {
    if (inflightRef.current) {
      rerunRef.current = true
      return
    }
    inflightRef.current = true
    const g = gen.current
    const forId = idRef.current
    try {
      const v = await duel({ action: 'view', match_id: forId })
      if (!current(g, forId)) return
      apply(v)
      setFatal(null)
    } catch (e) {
      if (!current(g, forId)) return
      const v = bodyView(e)
      if (v) {
        apply(v)
        if (e instanceof ApiError && e.code === 'version_changed') setError(duelErrorMessage(e.code))
      } else if (e instanceof ApiError && (e.status === 403 || e.status === 404) && !viewRef.current) {
        setFatal(duelErrorMessage(e.code))
      }
    } finally {
      // 대국이 바뀌었으면 새 대국 쪽이 이미 상태를 초기화했다
      if (g === gen.current) {
        inflightRef.current = false
        if (rerunRef.current && alive.current) {
          rerunRef.current = false
          void refreshRef.current()
        }
      }
    }
  }, [apply, current])
  refreshRef.current = refresh

  /** 사용자 행동(move·resign·cancel). 한 번에 하나만 */
  const send = useCallback(
    async (body: Record<string, unknown>) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setError(null)
      const g = gen.current
      const forId = idRef.current
      try {
        const v = await duel({ ...body, match_id: forId })
        if (current(g, forId)) apply(v)
      } catch (e) {
        if (!current(g, forId)) return
        const v = bodyView(e)
        if (v) {
          // stale·not_your_turn·finished 등: 최신 화면으로 조용히 바꾼다
          apply(v)
          if (e instanceof ApiError && e.code === 'version_changed') setError(duelErrorMessage(e.code))
        } else if (e instanceof ApiError) {
          if (e.code === 'invalid_action') {
            setError((e.body as { message?: string } | undefined)?.message ?? duelErrorMessage(e.code))
          } else {
            setError(duelErrorMessage(e.status >= 500 ? 'network' : e.code))
          }
          // 응답을 놓쳤거나 화면이 어긋났을 수 있으니 서버 상태로 맞춘다
          void refresh()
        } else {
          setError(duelErrorMessage('network'))
          void refresh()
        }
      } finally {
        if (g === gen.current) {
          busyRef.current = false
          if (alive.current) setBusy(false)
        }
      }
    },
    [apply, current, refresh],
  )

  const tickIfDue = useCallback(() => {
    const v = viewRef.current
    if (!v || v.status !== 'active' || v.my_seat === null || !v.turn_deadline) return
    if (tickedFor.current === v.turn_deadline) return
    // 서버 시계로 보정한 지금 (브라우저 시계가 빨라도 마감 전에는 보내지 않는다)
    if (Date.parse(v.turn_deadline) - now() > 0) return
    if (Date.now() < tickRetryAt.current) return
    const deadline = v.turn_deadline
    const g = gen.current
    const forId = v.match_id
    tickedFor.current = deadline
    duel({ action: 'tick', match_id: forId })
      .then((r) => { if (current(g, forId)) apply(r) })
      .catch((e) => {
        if (!current(g, forId)) return
        const fresh = bodyView(e)
        if (fresh) {
          // not_due·finished 등: 받은 화면으로 맞추고, 같은 마감에는 다시 보내지 않는다
          apply(fresh)
          if (e instanceof ApiError && e.code === 'version_changed') setError(duelErrorMessage(e.code))
        } else if (tickedFor.current === deadline) {
          // 보내지 못했다(네트워크 등): 잠시 뒤 다시 보낸다
          tickedFor.current = null
          tickRetryAt.current = Date.now() + TICK_RETRY_MS
        }
      })
  }, [apply, current])

  // 대국이 바뀌면 처음부터
  useEffect(() => {
    alive.current = true
    gen.current += 1
    inflightRef.current = false
    rerunRef.current = false
    busyRef.current = false
    viewRef.current = null
    tickedFor.current = null
    tickRetryAt.current = 0
    setView(null)
    setError(null)
    setFatal(null)
    setBusy(false)
    void refresh()

    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel(`duel:${id}`)
        .on('broadcast', { event: 'update' }, () => { void refresh() })
        .subscribe((status: string) => {
          // 실패해도 5초 폴링이 계속 맞춘다
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('duel: realtime', status)
        })
    } catch (e) {
      console.warn('duel: realtime subscribe failed', e)
    }
    // 신호와 무관하게 돈다 (Realtime이 끊겨도 대국이 끝까지 진행되도록)
    const poll = setInterval(() => {
      const s = viewRef.current?.status
      if (s === 'finished' || s === 'void') return
      void refresh()
    }, POLL_MS)
    return () => {
      alive.current = false
      clearInterval(poll)
      if (channel) {
        try { void supabase.removeChannel(channel) } catch { /* ignore */ }
      }
    }
  }, [id, refresh])

  // 남은 시간 표시와 마감 확인
  const live = view?.status === 'active'
  const [, setClock] = useState(0)
  useEffect(() => {
    if (!live) return
    tickIfDue()
    const t = setInterval(() => {
      setClock((n) => n + 1)
      tickIfDue()
    }, CLOCK_MS)
    return () => clearInterval(t)
  }, [live, tickIfDue])

  const act = useCallback(
    (payload: unknown) => {
      const v = viewRef.current
      // 내 차례가 아니면 보내지 않는다
      if (!v || v.status !== 'active' || v.my_seat === null || v.to_move !== v.my_seat) return
      void send({ action: 'move', expected_action_no: v.action_no, payload })
    },
    [send],
  )
  const resign = useCallback(() => { void send({ action: 'resign' }) }, [send])
  const cancel = useCallback(() => { void send({ action: 'cancel' }) }, [send])

  return { view, error, fatal, busy, act, resign, cancel }
}

/** 남은 시간(ms). 서버 시계로 보정한다 */
export function remainingMs(v: DuelView): number | null {
  if (v.status !== 'active' || !v.turn_deadline) return null
  return Math.max(0, Date.parse(v.turn_deadline) - now())
}

export function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
