import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import { signedChatImageUrl, type ChatMessage } from './api.ts'
import { useChat } from './useChat.ts'
import './chat.css'

const MAX_CHARS = 300
const KST_MS = 9 * 3600_000

/** 한국 시각 HH:MM */
function hhmm(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t + KST_MS)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** 글자 수(코드 포인트, DB의 char_length와 같다) */
function charCount(s: string): number {
  return [...s].length
}

type UrlState = Record<string, string | 'failed'>

/** 경로별 서명 주소. 불러오기에 실패하면 새 주소를 한 번만 다시 받는다(만료 대비). */
function useSignedUrls() {
  const [urls, setUrls] = useState<UrlState>({})
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  // ref만 쓰는 고정 함수 묶음
  const [api] = useState(() => {
    const requested = new Set<string>()
    const retried = new Set<string>()
    const load = (path: string) => {
      signedChatImageUrl(path).then(
        (u) => { if (alive.current) setUrls((s) => ({ ...s, [path]: u })) },
        () => { if (alive.current) fail(path) },
      )
    }
    const fail = (path: string) => {
      if (retried.has(path)) {
        setUrls((s) => ({ ...s, [path]: 'failed' }))
        return
      }
      retried.add(path)
      load(path)
    }
    const ensure = (path: string) => {
      if (requested.has(path)) return
      requested.add(path)
      load(path)
    }
    return { ensure, onError: fail }
  })
  return { urls, ...api }
}

export function DailyChat({ itemId }: { itemId: string }) {
  const { profile } = useAuth()
  const isAdmin = !!profile?.is_admin
  const { messages, error, send, remove, loadOlder, hasOlder } = useChat(itemId)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [newBelow, setNewBelow] = useState(false)
  const [olderBusy, setOlderBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const atBottom = useRef(true)
  const lastTop = useRef(0)
  const prevEdges = useRef<{ first?: string; last?: string }>({})
  const olderAnchor = useRef<{ height: number; top: number } | null>(null)
  const { urls, ensure, onError } = useSignedUrls()

  const trimmedLen = charCount(text.trim())
  const tooLong = trimmedLen > MAX_CHARS
  const canSend = !sending && !tooLong && (trimmedLen > 0 || file !== null)

  useEffect(() => {
    for (const m of messages) if (m.imagePath && !m.deleted) ensure(m.imagePath)
  }, [messages, ensure])

  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      lastTop.current = el.scrollTop
    }
    atBottom.current = true
    setNewBelow(false)
  }, [])

  // 이전 글을 붙이면 보던 자리를 지키고, 새 글은 맨 아래에 있을 때만 따라간다.
  useLayoutEffect(() => {
    const el = listRef.current
    const first = messages[0]?.id
    const last = messages.at(-1)
    const prev = prevEdges.current
    prevEdges.current = { first, last: last?.id }
    if (!el) return
    if (olderAnchor.current && first !== prev.first) {
      el.scrollTop = olderAnchor.current.top + (el.scrollHeight - olderAnchor.current.height)
      lastTop.current = el.scrollTop
      olderAnchor.current = null
    }
    if (last && last.id !== prev.last) {
      if (atBottom.current || last.mine || prev.last === undefined) scrollToBottom()
      else setNewBelow(true)
    }
  }, [messages, scrollToBottom])

  // 사진이 늦게 들어와 내용이 길어진 것은 "위로 올림"으로 보지 않는다. 사용자가 위로 굴렸을 때만 따라가기를 끈다.
  function onScroll() {
    const el = listRef.current
    if (!el) return
    const top = el.scrollTop
    if (el.scrollHeight - top - el.clientHeight < 48) {
      atBottom.current = true
      setNewBelow(false)
    } else if (top < lastTop.current - 2) {
      atBottom.current = false
    }
    lastTop.current = top
  }

  function onImageLoad() {
    if (atBottom.current) scrollToBottom()
  }

  async function onLoadOlder() {
    const el = listRef.current
    if (el) olderAnchor.current = { height: el.scrollHeight, top: el.scrollTop }
    setOlderBusy(true)
    await loadOlder()
    setOlderBusy(false)
  }

  // 미리보기 주소는 바뀌거나 사라질 때 놓아 준다
  useEffect(() => () => { if (preview) URL.revokeObjectURL?.(preview) }, [preview])

  function chooseFile(f: File | null) {
    setFile(f)
    setPreview(f && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null)
    setFailed(false)
  }

  async function submit() {
    if (!canSend) return
    setSending(true)
    setFailed(false)
    const ok = await send(text, file)
    setSending(false)
    if (ok) {
      setText('')
      chooseFile(null)
    } else {
      setFailed(true)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중 Enter는 글자 확정이다
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    void submit()
  }

  const viewUrl = viewing ? urls[viewing] : undefined
  const closeView = useCallback(() => setViewing(null), [])

  return (
    <section className="card chat" aria-labelledby="daily-chat-title">
      <h3 id="daily-chat-title" className="card-title">오늘의 대화</h3>
      <div className="chat-frame">
        <ol className="chat-list" ref={listRef} onScroll={onScroll} aria-label="대화 목록">
          {hasOlder && (
            <li className="chat-older" role="none">
              <button className="btn btn-ghost btn-sm" disabled={olderBusy} onClick={() => void onLoadOlder()}>
                이전 대화 더 보기
              </button>
            </li>
          )}
          {messages.length === 0 && !error && (
            <li className="chat-empty muted" role="none">아직 대화가 없어요. 첫 마디를 남겨 보세요</li>
          )}
          {messages.map((m) => (
            <Message
              key={m.id}
              m={m}
              canDelete={!m.deleted && (m.mine || isAdmin)}
              confirming={confirmId === m.id}
              url={m.imagePath ? urls[m.imagePath] : undefined}
              onDelete={() => {
                if (confirmId === m.id) {
                  setConfirmId(null)
                  void remove(m.id)
                } else {
                  setConfirmId(m.id)
                }
              }}
              onCancelDelete={() => setConfirmId((c) => (c === m.id ? null : c))}
              onOpen={() => setViewing(m.imagePath)}
              onImageError={() => m.imagePath && onError(m.imagePath)}
              onImageLoad={onImageLoad}
            />
          ))}
        </ol>
        {newBelow && (
          <button className="btn btn-primary btn-sm chat-new" onClick={scrollToBottom}>새 메시지</button>
        )}
      </div>

      <div className="chat-compose">
        {preview && (
          <div className="chat-preview">
            <img src={preview} alt="보낼 사진 미리보기" />
            <button className="btn btn-ghost btn-sm" disabled={sending} onClick={() => chooseFile(null)}>사진 빼기</button>
          </div>
        )}
        {file && !preview && (
          <div className="chat-preview">
            <span className="muted">{file.name}</span>
            <button className="btn btn-ghost btn-sm" disabled={sending} onClick={() => chooseFile(null)}>사진 빼기</button>
          </div>
        )}
        <textarea
          className="input chat-input"
          aria-label="메시지"
          placeholder="오늘 문제 어땠나요?"
          rows={2}
          value={text}
          onChange={(e) => { setText(e.target.value); setFailed(false) }}
          onKeyDown={onKeyDown}
        />
        <div className="chat-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-label="사진 고르기"
            hidden
            onChange={(e) => {
              chooseFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
          <button className="btn btn-ghost btn-sm" disabled={sending} onClick={() => fileRef.current?.click()}>사진</button>
          <span className={`chat-count${tooLong ? ' chat-count-over' : ''}`} aria-live="polite">
            {charCount(text)}/{MAX_CHARS}
          </span>
          <button className="btn btn-primary btn-sm chat-send" disabled={!canSend} aria-busy={sending} onClick={() => void submit()}>
            보내기
          </button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {failed && error && (
          <button className="btn btn-ghost btn-sm chat-retry" disabled={!canSend} onClick={() => void submit()}>다시 보내기</button>
        )}
      </div>

      {viewing && viewUrl && viewUrl !== 'failed' && (
        <Lightbox url={viewUrl} onClose={closeView} />
      )}
    </section>
  )
}

function Message(props: {
  m: ChatMessage
  canDelete: boolean
  confirming: boolean
  url: string | 'failed' | undefined
  onDelete: () => void
  onCancelDelete: () => void
  onOpen: () => void
  onImageError: () => void
  onImageLoad: () => void
}) {
  const { m, canDelete, confirming, url } = props
  const name = m.handle ?? (m.userId ? '…' : '알 수 없음')
  return (
    <li className={`chat-msg${m.mine ? ' chat-mine' : ''}`} data-mine={m.mine ? 'true' : undefined}>
      <div className="chat-meta">
        <span className="chat-handle">{name}</span>
        <time className="chat-time" dateTime={m.createdAt}>{hhmm(m.createdAt)}</time>
      </div>
      {m.deleted ? (
        <p className="chat-deleted">삭제된 메시지</p>
      ) : (
        <>
          {m.imagePath && (
            url === 'failed' ? (
              <p className="chat-deleted">사진을 불러오지 못했어요</p>
            ) : url ? (
              <button className="chat-thumb" aria-label="사진 크게 보기" onClick={props.onOpen}>
                <img src={url} alt={`${name}의 사진`} onError={props.onImageError} onLoad={props.onImageLoad} />
              </button>
            ) : (
              <div className="chat-thumb-wait muted">사진 불러오는 중…</div>
            )
          )}
          {m.body && <p className="chat-body">{m.body}</p>}
        </>
      )}
      {canDelete && (
        <button
          className={`chat-delete${confirming ? ' chat-delete-confirm' : ''}`}
          onClick={props.onDelete}
          onBlur={props.onCancelDelete}
        >
          {confirming ? '한 번 더 누르면 지우기' : '지우기'}
        </button>
      )}
    </li>
  )
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose])
  return (
    <div className="chat-lightbox" role="dialog" aria-modal="true" aria-label="사진 크게 보기" onClick={onClose}>
      <img src={url} alt="크게 본 사진" onClick={(e) => e.stopPropagation()} />
      <button ref={closeRef} className="btn btn-primary btn-sm chat-lightbox-close" onClick={onClose}>닫기</button>
    </div>
  )
}
