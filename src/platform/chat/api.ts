import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { supabase } from '../../lib/supabase.ts'

const BUCKET = 'daily-chat'

export type ChatMessage = {
  id: string
  userId: string | null
  handle: string | null
  body: string | null
  imagePath: string | null
  createdAt: string
  deleted: boolean
  mine: boolean
}

type ChatRow = {
  id: string
  user_id: string | null
  handle: string | null
  body: string | null
  image_path: string | null
  created_at: string
  deleted: boolean
  mine: boolean
}

/** 오래된 것 → 최신 순으로 돌려준다(서버는 최신순). */
export async function listChat(itemId: string, before?: string): Promise<ChatMessage[]> {
  const rows = await rpc<ChatRow[]>('chat_list', { p_item: itemId, p_before: before ?? null, p_limit: 100 })
  return rows
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      handle: r.handle,
      body: r.body,
      imagePath: r.image_path,
      createdAt: r.created_at,
      deleted: r.deleted,
      mine: r.mine,
    }))
    .reverse()
}

export async function postChat(
  itemId: string,
  body: string | null,
  imagePath: string | null,
): Promise<{ id: string; createdAt: string }> {
  const rows = await rpc<{ id: string; created_at: string }[]>('chat_post', {
    p_item: itemId,
    p_body: body,
    p_image_path: imagePath,
  })
  const r = rows[0]
  return { id: r.id, createdAt: r.created_at }
}

export async function deleteChat(id: string): Promise<void> {
  const path = await rpc<string | null>('chat_delete', { p_id: id })
  if (path) await removeChatImage(path)
}

function storageError(): ApiError {
  return new ApiError('upload_failed', 0)
}

export async function uploadChatImage(itemId: string, userId: string, blob: Blob): Promise<string> {
  const path = `${itemId}/${userId}/${Date.now()}.jpg`
  let error: unknown
  try {
    ;({ error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }))
  } catch {
    throw storageError()
  }
  if (error) throw storageError()
  return path
}

export async function removeChatImage(path: string): Promise<void> {
  let error: unknown
  try {
    ;({ error } = await supabase.storage.from(BUCKET).remove([path]))
  } catch {
    throw storageError()
  }
  if (error) throw storageError()
}

export async function signedChatImageUrl(path: string): Promise<string> {
  let res: { data: { signedUrl: string } | null; error: unknown }
  try {
    res = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  } catch {
    throw storageError()
  }
  if (res.error || !res.data) throw storageError()
  return res.data.signedUrl
}

const CHAT_MESSAGES: Record<string, string> = {
  forbidden: '문제를 끝낸 사람만 쓸 수 있어요',
  invalid_message: '1~300자로 써 주세요',
  too_fast: '조금 천천히 보내 주세요',
  too_many: '잠시 뒤에 다시 보내 주세요',
  image_unsupported: '지원하지 않는 형식이에요',
  image_too_large: '사진이 너무 커요',
  upload_failed: '사진을 올리지 못했어요. 다시 시도해 주세요',
}

export function chatErrorMessage(code: string): string {
  return CHAT_MESSAGES[code] ?? errorMessage(code)
}
