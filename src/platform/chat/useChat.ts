import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api.ts'
import { supabase } from '../../lib/supabase.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import {
  chatErrorMessage, deleteChat, listChat, postChat, removeChatImage, uploadChatImage, type ChatMessage,
} from './api.ts'
import { prepareChatImage } from './image.ts'

const POLL_MS = 5000
/** listChat이 한 번에 받는 개수(api.ts). 꽉 차면 더 오래된 글이 있을 수 있다. */
const PAGE = 100

/** Realtime(postgres_changes) 행: DB 열 이름 그대로, handle·mine이 없다. */
type RealtimeRow = {
  id: string
  item_id: string
  user_id: string | null
  body: string | null
  image_path: string | null
  created_at: string
  deleted_at: string | null
}

function codeOf(e: unknown): string {
  return e instanceof ApiError ? e.code : 'unknown'
}

function byTime(a: ChatMessage, b: ChatMessage): number {
  const d = Date.parse(a.createdAt) - Date.parse(b.createdAt)
  if (d) return d
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * id로 합친다. 새로 온 것이 이기되, 모르는 아이디는 이미 아는 값으로 채우고 지운 표시는 되돌리지 않는다.
 * onlyKnown이면 이미 있는 id만 고친다(Realtime UPDATE: 불러온 범위 밖 행이 끼면 이전 글 커서가 틀어진다).
 */
function merge(prev: ChatMessage[], incoming: ChatMessage[], onlyKnown = false): ChatMessage[] {
  const map = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) {
    const old = map.get(m.id)
    if (!old) {
      if (!onlyKnown) map.set(m.id, m)
      continue
    }
    const deleted = old.deleted || m.deleted
    map.set(m.id, {
      ...m,
      handle: m.handle ?? old.handle,
      deleted,
      body: deleted ? null : m.body,
      imagePath: deleted ? null : m.imagePath,
    })
  }
  return [...map.values()].sort(byTime)
}

export type UseChat = {
  messages: ChatMessage[]
  error: string | null
  send(body: string | null, file: File | null): Promise<boolean>
  remove(id: string): Promise<void>
  loadOlder(): Promise<void>
  hasOlder: boolean
}

export function useChat(itemId: string): UseChat {
  const { profile } = useAuth()
  const userId = profile?.id ?? null
  const userHandle = profile?.handle ?? null
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const handles = useRef(new Map<string, string>())
  const messagesRef = useRef<ChatMessage[]>([])
  const alive = useRef(true)
  const olderBusy = useRef(false)
  // 불러오기 오류 문구. 이후 폴링이 성공하면 이 문구만 지운다(보내기 오류는 남긴다).
  const loadErrorRef = useRef<string | null>(null)

  const apply = useCallback((incoming: ChatMessage[], onlyKnown = false) => {
    for (const m of incoming) if (m.userId && m.handle) handles.current.set(m.userId, m.handle)
    setMessages((prev) => {
      const next = merge(prev, incoming, onlyKnown)
      messagesRef.current = next
      return next
    })
  }, [])

  useEffect(() => {
    alive.current = true
    handles.current = new Map()
    messagesRef.current = []
    setMessages([])
    setError(null)
    setHasOlder(false)

    let inflight = false
    let first = true
    let poll: ReturnType<typeof setInterval> | null = null
    const stop = () => {
      if (poll !== null) clearInterval(poll)
      poll = null
    }

    // 처음 불러오기와 5초 폴링이 함께 쓴다. 진행 중이면 겹쳐 보내지 않는다.
    const refresh = async () => {
      if (inflight || !alive.current) return
      inflight = true
      try {
        const rows = await listChat(itemId)
        if (!alive.current) return
        apply(rows)
        if (first) setHasOlder(rows.length >= PAGE)
        first = false
        const stale = loadErrorRef.current
        if (stale) {
          loadErrorRef.current = null
          setError((e) => (e === stale ? null : e))
        }
      } catch (e) {
        if (!alive.current) return
        const code = codeOf(e)
        // 처음 실패는 보여 주고, 폴링 중 일시 오류는 조용히 넘긴다. 거부되면 폴링을 멈춘다.
        if (first || code === 'forbidden') {
          const text = chatErrorMessage(code)
          loadErrorRef.current = text
          setError(text)
        }
        if (code === 'forbidden') stop()
      } finally {
        inflight = false
      }
    }

    void refresh()

    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel(`daily-chat:${itemId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'daily_chat', filter: `item_id=eq.${itemId}` },
          (payload: { eventType?: string; new?: Partial<RealtimeRow> }) => {
            const r = payload.new
            if (!alive.current || !r || !r.id || r.item_id !== itemId) return
            if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return
            const uid = r.user_id ?? null
            apply([{
              id: r.id,
              userId: uid,
              handle: uid ? handles.current.get(uid) ?? null : null,
              body: r.body ?? null,
              imagePath: r.image_path ?? null,
              createdAt: r.created_at ?? new Date().toISOString(),
              deleted: r.deleted_at != null,
              mine: uid !== null && uid === userId,
            }], payload.eventType === 'UPDATE')
          },
        )
        .subscribe((status: string) => {
          // 실패해도 5초 폴링이 계속 맞춘다
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('chat: realtime', status)
        })
    } catch (e) {
      console.warn('chat: realtime subscribe failed', e)
    }

    poll = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refresh()
    }, POLL_MS)

    return () => {
      alive.current = false
      stop()
      if (channel) {
        try { void supabase.removeChannel(channel) } catch { /* ignore */ }
      }
    }
  }, [itemId, userId, apply])

  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0]
    if (!oldest || olderBusy.current) return
    olderBusy.current = true
    try {
      const rows = await listChat(itemId, oldest.createdAt)
      if (!alive.current) return
      apply(rows)
      setHasOlder(rows.length >= PAGE)
    } catch (e) {
      if (alive.current) setError(chatErrorMessage(codeOf(e)))
    } finally {
      olderBusy.current = false
    }
  }, [itemId, apply])

  const send = useCallback(async (body: string | null, file: File | null): Promise<boolean> => {
    const text = body?.trim() ? body.trim() : null
    if (!text && !file) return false
    if (!userId) {
      setError(chatErrorMessage('unauthorized'))
      return false
    }
    let path: string | null = null
    try {
      if (file) {
        const blob = await prepareChatImage(file)
        path = await uploadChatImage(itemId, userId, blob)
      }
      let posted: { id: string; createdAt: string }
      try {
        posted = await postChat(itemId, text, path)
      } catch (e) {
        // 올린 파일이 남지 않게 지운다. 지우기 실패는 원래 오류를 가리지 않는다.
        if (path) {
          const p = path
          await removeChatImage(p).catch((err) => console.warn('chat: 올린 사진을 지우지 못했어요', p, err))
        }
        throw e
      }
      if (!alive.current) return true
      setError(null)
      loadErrorRef.current = null
      apply([{
        id: posted.id,
        userId,
        handle: userHandle,
        body: text,
        imagePath: path,
        createdAt: posted.createdAt,
        deleted: false,
        mine: true,
      }])
      return true
    } catch (e) {
      if (alive.current) setError(chatErrorMessage(codeOf(e)))
      return false
    }
  }, [itemId, userId, userHandle, apply])

  const remove = useCallback(async (id: string) => {
    try {
      await deleteChat(id)
      const m = messagesRef.current.find((x) => x.id === id)
      if (m && alive.current) apply([{ ...m, deleted: true, body: null, imagePath: null }])
    } catch (e) {
      if (alive.current) setError(chatErrorMessage(codeOf(e)))
    }
  }, [apply])

  return { messages, error, send, remove, loadOlder, hasOlder }
}
