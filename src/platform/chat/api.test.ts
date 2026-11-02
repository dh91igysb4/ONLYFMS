import { beforeEach, expect, test, vi } from 'vitest'

const upload = vi.fn()
const remove = vi.fn()
const createSignedUrl = vi.fn()
const from = vi.fn((_b: string) => ({ upload, remove, createSignedUrl }))
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { storage: { from: (b: string) => from(b) } }, supabaseUrl: 'http://x', supabaseKey: 'k',
}))
const rpcMock = vi.fn()
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))

import {
  chatErrorMessage, deleteChat, listChat, postChat, removeChatImage, signedChatImageUrl, uploadChatImage,
} from './api.ts'

beforeEach(() => { vi.clearAllMocks() })

test('listChat은 최신순을 오래된순으로 뒤집고 이름을 바꾼다', async () => {
  rpcMock.mockResolvedValue([
    { id: 'b', user_id: 'u2', handle: 'h2', body: 'two', image_path: null, created_at: '2026-01-02', deleted: false, mine: true },
    { id: 'a', user_id: null, handle: null, body: null, image_path: null, created_at: '2026-01-01', deleted: true, mine: false },
  ])
  const out = await listChat('item1', '2026-02-01')
  expect(rpcMock).toHaveBeenCalledWith('chat_list', { p_item: 'item1', p_before: '2026-02-01', p_limit: 100 })
  expect(out.map((m) => m.id)).toEqual(['a', 'b'])
  expect(out[1]).toEqual({
    id: 'b', userId: 'u2', handle: 'h2', body: 'two', imagePath: null, createdAt: '2026-01-02', deleted: false, mine: true,
  })
})

test('listChat before 생략 시 null', async () => {
  rpcMock.mockResolvedValue([])
  await listChat('item1')
  expect(rpcMock).toHaveBeenCalledWith('chat_list', { p_item: 'item1', p_before: null, p_limit: 100 })
})

test('postChat 인자 매핑', async () => {
  rpcMock.mockResolvedValue([{ id: 'm1', created_at: 't1' }])
  expect(await postChat('item1', 'hi', 'p.jpg')).toEqual({ id: 'm1', createdAt: 't1' })
  expect(rpcMock).toHaveBeenCalledWith('chat_post', { p_item: 'item1', p_body: 'hi', p_image_path: 'p.jpg' })
})

test('deleteChat: 경로가 있으면 사진을 지운다', async () => {
  rpcMock.mockResolvedValue('i/u/1.jpg')
  remove.mockResolvedValue({ error: null })
  await deleteChat('m1')
  expect(rpcMock).toHaveBeenCalledWith('chat_delete', { p_id: 'm1' })
  expect(from).toHaveBeenCalledWith('daily-chat')
  expect(remove).toHaveBeenCalledWith(['i/u/1.jpg'])
})

test('deleteChat: RPC가 성공하면 사진 삭제 실패는 경고만 하고 넘어간다', async () => {
  rpcMock.mockResolvedValue('i/u/1.jpg')
  remove.mockResolvedValue({ error: { message: 'boom' } })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(deleteChat('m1')).resolves.toBeUndefined()
  expect(warn).toHaveBeenCalled()
  remove.mockRejectedValue(new Error('net'))
  await expect(deleteChat('m1')).resolves.toBeUndefined()
  warn.mockRestore()
})

test('deleteChat: RPC 실패는 그대로 던지고 사진은 건드리지 않는다', async () => {
  rpcMock.mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'forbidden' }))
  await expect(deleteChat('m1')).rejects.toMatchObject({ code: 'forbidden' })
  expect(remove).not.toHaveBeenCalled()
})

test('deleteChat: null이면 remove 호출 안 함', async () => {
  rpcMock.mockResolvedValue(null)
  await deleteChat('m1')
  expect(remove).not.toHaveBeenCalled()
})

test('uploadChatImage 경로 형식과 옵션', async () => {
  upload.mockResolvedValue({ error: null })
  const blob = new Blob(['x'])
  const path = await uploadChatImage('item', 'user', blob)
  expect(path).toMatch(/^item\/user\/\d{13}\.jpg$/)
  expect(upload).toHaveBeenCalledWith(path, blob, { contentType: 'image/jpeg', upsert: false })
})

test('저장소 오류는 ApiError(upload_failed)', async () => {
  upload.mockResolvedValue({ error: { message: 'boom' } })
  await expect(uploadChatImage('i', 'u', new Blob(['x']))).rejects.toMatchObject({ name: 'ApiError', code: 'upload_failed' })
  remove.mockResolvedValue({ error: { message: 'boom' } })
  await expect(removeChatImage('p')).rejects.toMatchObject({ code: 'upload_failed' })
  createSignedUrl.mockResolvedValue({ data: null, error: { message: 'boom' } })
  await expect(signedChatImageUrl('p')).rejects.toMatchObject({ code: 'upload_failed' })
})

test('signedChatImageUrl 3600초', async () => {
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://s/u' }, error: null })
  expect(await signedChatImageUrl('p.jpg')).toBe('https://s/u')
  expect(createSignedUrl).toHaveBeenCalledWith('p.jpg', 3600)
})

test('chatErrorMessage', () => {
  expect(chatErrorMessage('forbidden')).toBe('문제를 끝낸 사람만 쓸 수 있어요')
  expect(chatErrorMessage('invalid_message')).toBe('1~300자로 써 주세요')
  expect(chatErrorMessage('too_fast')).toBe('조금 천천히 보내 주세요')
  expect(chatErrorMessage('too_many')).toBe('잠시 뒤에 다시 보내 주세요')
  expect(chatErrorMessage('image_unsupported')).toBe('지원하지 않는 형식이에요')
  expect(chatErrorMessage('image_too_large')).toBe('사진이 너무 커요')
  expect(chatErrorMessage('network')).toBe('연결이 불안정해요. 다시 시도해 주세요')
  expect(chatErrorMessage('zzz')).toBe('문제가 생겼어요 (zzz)')
})
