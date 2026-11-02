import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ChatMessage } from './api.ts'

const listChat = vi.fn()
const postChat = vi.fn()
const deleteChat = vi.fn()
const uploadChatImage = vi.fn()
const removeChatImage = vi.fn()
const signedChatImageUrl = vi.fn()
const prepareChatImage = vi.fn()
vi.mock('./api.ts', async (orig) => ({
  ...(await orig<typeof import('./api.ts')>()),
  listChat: (...a: unknown[]) => listChat(...a),
  postChat: (...a: unknown[]) => postChat(...a),
  deleteChat: (...a: unknown[]) => deleteChat(...a),
  uploadChatImage: (...a: unknown[]) => uploadChatImage(...a),
  removeChatImage: (...a: unknown[]) => removeChatImage(...a),
  signedChatImageUrl: (...a: unknown[]) => signedChatImageUrl(...a),
}))
vi.mock('./image.ts', () => ({ prepareChatImage: (...a: unknown[]) => prepareChatImage(...a) }))

type RtCallback = (payload: { eventType: string; new: Record<string, unknown> }) => void
let rtCallback: RtCallback | null = null
let channelThrows = false
const channelMock = vi.fn()
const removeChannel = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({
  supabase: {
    channel: (...a: unknown[]) => channelMock(...a),
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
  supabaseUrl: 'x',
  supabaseKey: 'k',
}))
let admin = false
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'u1', handle: 'kane', status: 'approved', is_admin: admin } }),
}))

import { ApiError } from '../../lib/api.ts'
import { DailyChat } from './DailyChat.tsx'

const ITEM = 'it1'

function msg(id: string, o: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id, userId: 'u2', handle: 'son', body: `글 ${id}`, imagePath: null,
    createdAt: '2026-11-02T05:07:00.000Z', deleted: false, mine: false, ...o,
  }
}

function row(id: string, o: Record<string, unknown> = {}) {
  return {
    id, item_id: ITEM, user_id: 'u2', body: `실시간 ${id}`, image_path: null,
    created_at: '2026-11-02T06:00:00.000Z', deleted_at: null, ...o,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  for (const f of [listChat, postChat, deleteChat, uploadChatImage, removeChatImage, signedChatImageUrl, prepareChatImage, removeChannel]) f.mockReset()
  admin = false
  rtCallback = null
  channelThrows = false
  channelMock.mockReset()
  channelMock.mockImplementation(() => {
    if (channelThrows) throw new Error('no realtime')
    const ch = {
      on: vi.fn((_e: string, _f: unknown, cb: RtCallback) => { rtCallback = cb; return ch }),
      subscribe: vi.fn(() => ch),
    }
    return ch
  })
  listChat.mockResolvedValue([])
  removeChatImage.mockResolvedValue(undefined)
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function tick(ms = 5000) {
  await act(async () => { vi.advanceTimersByTime(ms) })
}

function textbox() {
  return screen.getByRole('textbox', { name: '메시지' }) as HTMLTextAreaElement
}

function pickFile() {
  const file = new File(['x'], 'p.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('사진 고르기'), { target: { files: [file] } })
  return file
}

test('renders_messages', async () => {
  signedChatImageUrl.mockResolvedValue('https://signed/1')
  listChat.mockResolvedValue([
    msg('a', { mine: true, userId: 'u1', handle: 'kane', body: '안녕하세요' }),
    msg('b', { deleted: true, body: null }),
    msg('c', { imagePath: 'it1/u2/1700000000000.jpg', body: null }),
  ])
  render(<DailyChat itemId={ITEM} />)
  expect(screen.getByRole('heading', { name: '오늘의 대화' })).toBeInTheDocument()
  const mine = (await screen.findByText('안녕하세요')).closest('li') as HTMLElement
  expect(mine).toHaveAttribute('data-mine', 'true')
  expect(within(mine).getByText('kane')).toBeInTheDocument()
  expect(within(mine).getByText('14:07')).toBeInTheDocument()
  expect(screen.getByText('삭제된 메시지').closest('li')).not.toHaveAttribute('data-mine')
  const img = await screen.findByRole('img', { name: 'son의 사진' })
  expect(img).toHaveAttribute('src', 'https://signed/1')
  expect(signedChatImageUrl).toHaveBeenCalledWith('it1/u2/1700000000000.jpg')
  expect(listChat).toHaveBeenCalledWith(ITEM)
  expect(channelMock).toHaveBeenCalledWith(`daily-chat:${ITEM}`)
})

test('send_text', async () => {
  postChat.mockResolvedValue({ id: 'n1', createdAt: '2026-11-02T06:00:00.000Z' })
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  fireEvent.change(textbox(), { target: { value: '안녕' } })
  fireEvent.keyDown(textbox(), { key: 'Enter', shiftKey: true })
  expect(postChat).not.toHaveBeenCalled()
  fireEvent.keyDown(textbox(), { key: 'Enter' })
  await screen.findByText('안녕')
  expect(postChat).toHaveBeenCalledWith(ITEM, '안녕', null)
  expect(textbox().value).toBe('')
  expect(screen.getByText('안녕').closest('li')).toHaveAttribute('data-mine', 'true')
})

test('send_ignores_enter_while_composing', async () => {
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  fireEvent.change(textbox(), { target: { value: '안녕' } })
  fireEvent.keyDown(textbox(), { key: 'Enter', isComposing: true })
  expect(postChat).not.toHaveBeenCalled()
})

test('send_ignores_enter_keycode_229', async () => {
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  fireEvent.change(textbox(), { target: { value: '안녕' } })
  fireEvent.keyDown(textbox(), { key: 'Enter', keyCode: 229 })
  expect(postChat).not.toHaveBeenCalled()
})

test('coarse_pointer_enter_is_newline', async () => {
  const mm = vi.fn((q: string) => ({ matches: q === '(pointer: coarse)', media: q }))
  vi.stubGlobal('matchMedia', mm)
  try {
    postChat.mockResolvedValue({ id: 'n1', createdAt: '2026-11-02T06:00:00.000Z' })
    render(<DailyChat itemId={ITEM} />)
    await screen.findByText(/아직 대화가 없어요/)
    fireEvent.change(textbox(), { target: { value: '안녕' } })
    const ev = fireEvent.keyDown(textbox(), { key: 'Enter' })
    // 기본 동작(줄바꿈)을 막지 않는다
    expect(ev).toBe(true)
    expect(postChat).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await screen.findByText('안녕')
    expect(postChat).toHaveBeenCalledWith(ITEM, '안녕', null)
  } finally {
    vi.unstubAllGlobals()
  }
})

test('send_button_states', async () => {
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  const send = screen.getByRole('button', { name: '보내기' })
  expect(send).toBeDisabled()
  fireEvent.change(textbox(), { target: { value: '   ' } })
  expect(send).toBeDisabled()
  fireEvent.change(textbox(), { target: { value: '글' } })
  expect(send).toBeEnabled()
  expect(screen.getByText('1/300')).toBeInTheDocument()
  fireEvent.change(textbox(), { target: { value: '' } })
  pickFile()
  expect(send).toBeEnabled()
  expect(screen.getByRole('img', { name: '보낼 사진 미리보기' })).toHaveAttribute('src', 'blob:preview')
  fireEvent.change(textbox(), { target: { value: '둘 다' } })
  expect(send).toBeEnabled()
  fireEvent.change(textbox(), { target: { value: 'a'.repeat(301) } })
  expect(send).toBeDisabled()
  expect(screen.getByText('301/300')).toBeInTheDocument()
  fireEvent.change(textbox(), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '사진 빼기' }))
  expect(screen.queryByRole('img', { name: '보낼 사진 미리보기' })).toBeNull()
  expect(send).toBeDisabled()
})

test('send_image_only', async () => {
  const blob = new Blob(['jpg'], { type: 'image/jpeg' })
  prepareChatImage.mockResolvedValue(blob)
  uploadChatImage.mockResolvedValue('it1/u1/1700000000001.jpg')
  postChat.mockResolvedValue({ id: 'n1', createdAt: '2026-11-02T06:00:00.000Z' })
  signedChatImageUrl.mockResolvedValue('https://signed/mine')
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  const file = pickFile()
  fireEvent.click(screen.getByRole('button', { name: '보내기' }))
  await screen.findByRole('img', { name: 'kane의 사진' })
  expect(prepareChatImage).toHaveBeenCalledWith(file)
  expect(uploadChatImage).toHaveBeenCalledWith(ITEM, 'u1', blob)
  expect(postChat).toHaveBeenCalledWith(ITEM, null, 'it1/u1/1700000000001.jpg')
  const order = [prepareChatImage, uploadChatImage, postChat].map((f) => f.mock.invocationCallOrder[0])
  expect(order).toEqual([...order].sort((x, y) => x - y))
  expect(screen.queryByRole('img', { name: '보낼 사진 미리보기' })).toBeNull()
})

test('image_unsupported_shows_message', async () => {
  prepareChatImage.mockRejectedValue(new ApiError('image_unsupported', 0))
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  pickFile()
  fireEvent.click(screen.getByRole('button', { name: '보내기' }))
  expect(await screen.findByText('지원하지 않는 형식이에요')).toBeInTheDocument()
  expect(uploadChatImage).not.toHaveBeenCalled()
  expect(postChat).not.toHaveBeenCalled()
})

test('upload_then_post_fails_cleans_up', async () => {
  prepareChatImage.mockResolvedValue(new Blob(['jpg']))
  uploadChatImage.mockResolvedValue('it1/u1/1700000000002.jpg')
  postChat.mockRejectedValueOnce(new ApiError('too_fast', 400))
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  pickFile()
  fireEvent.change(textbox(), { target: { value: '사진과 글' } })
  fireEvent.click(screen.getByRole('button', { name: '보내기' }))
  expect(await screen.findByText('조금 천천히 보내 주세요')).toBeInTheDocument()
  expect(removeChatImage).toHaveBeenCalledWith('it1/u1/1700000000002.jpg')
  expect(textbox().value).toBe('사진과 글')
  expect(screen.getByRole('img', { name: '보낼 사진 미리보기' })).toBeInTheDocument()
  // 다시 보내기는 같은 내용으로 다시 올리고 보낸다
  uploadChatImage.mockResolvedValue('it1/u1/1700000000003.jpg')
  postChat.mockResolvedValueOnce({ id: 'n1', createdAt: '2026-11-02T06:00:00.000Z' })
  signedChatImageUrl.mockResolvedValue('https://signed/x')
  fireEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
  await screen.findByText('사진과 글', { selector: 'p' })
  expect(postChat).toHaveBeenLastCalledWith(ITEM, '사진과 글', 'it1/u1/1700000000003.jpg')
  expect(textbox().value).toBe('')
  expect(screen.queryByText('조금 천천히 보내 주세요')).toBeNull()
  expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull()
})

test('realtime_insert_appends', async () => {
  listChat.mockResolvedValue([msg('a')])
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText('글 a')
  expect(channelMock).toHaveBeenCalledWith(`daily-chat:${ITEM}`)
  const ch = channelMock.mock.results[0].value
  expect(ch.on).toHaveBeenCalledWith(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'daily_chat', filter: `item_id=eq.${ITEM}` },
    expect.any(Function),
  )
  act(() => rtCallback!({ eventType: 'INSERT', new: row('n1') }))
  const li = (await screen.findByText('실시간 n1')).closest('li') as HTMLElement
  // 이미 아는 사용자라 아이디를 바로 보여 준다
  expect(within(li).getByText('son')).toBeInTheDocument()
  // 모르는 사용자는 다음 폴링 전까지 "…"
  act(() => rtCallback!({ eventType: 'INSERT', new: row('n2', { user_id: 'u9' }) }))
  const li2 = (await screen.findByText('실시간 n2')).closest('li') as HTMLElement
  expect(within(li2).getByText('…')).toBeInTheDocument()
  // update는 교체(삭제 반영)
  act(() => rtCallback!({ eventType: 'UPDATE', new: row('n1', { body: null, deleted_at: '2026-11-02T06:01:00Z' }) }))
  expect(screen.queryByText('실시간 n1')).toBeNull()
  expect(screen.getByText('삭제된 메시지')).toBeInTheDocument()
  // 다른 문항의 행은 무시
  act(() => rtCallback!({ eventType: 'INSERT', new: row('x1', { item_id: 'other' }) }))
  expect(screen.queryByText('실시간 x1')).toBeNull()
})

test('dedupe_realtime_and_poll', async () => {
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  act(() => rtCallback!({ eventType: 'INSERT', new: row('n1', { user_id: 'u9' }) }))
  await screen.findByText('실시간 n1')
  listChat.mockResolvedValue([msg('n1', { userId: 'u9', handle: 'salah', body: '실시간 n1', createdAt: '2026-11-02T06:00:00.000Z' })])
  await tick()
  expect(listChat).toHaveBeenCalledTimes(2)
  await screen.findByText('salah')
  expect(screen.getAllByText('실시간 n1')).toHaveLength(1)
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  // Realtime이 같은 행을 다시 보내도 1개
  act(() => rtCallback!({ eventType: 'INSERT', new: row('n1', { user_id: 'u9' }) }))
  expect(screen.getAllByText('실시간 n1')).toHaveLength(1)
  expect(screen.getByText('salah')).toBeInTheDocument()
})

test('messages_sorted_by_created_at', async () => {
  listChat.mockResolvedValue([msg('a', { createdAt: '2026-11-02T05:00:00Z' }), msg('c', { createdAt: '2026-11-02T07:00:00Z' })])
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText('글 a')
  act(() => rtCallback!({ eventType: 'INSERT', new: row('b', { body: '글 b', created_at: '2026-11-02T06:00:00Z' }) }))
  await screen.findByText('글 b')
  const texts = screen.getAllByRole('listitem').map((li) => li.querySelector('.chat-body')?.textContent)
  expect(texts).toEqual(['글 a', '글 b', '글 c'])
})

test('poll_when_realtime_fails', async () => {
  channelThrows = true
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  expect(warn).toHaveBeenCalled()
  listChat.mockResolvedValue([msg('p1', { body: '폴링으로 온 글' })])
  await tick()
  expect(await screen.findByText('폴링으로 온 글')).toBeInTheDocument()
  expect(listChat).toHaveBeenCalledTimes(2)
  await tick()
  expect(listChat).toHaveBeenCalledTimes(3)
  warn.mockRestore()
})

test('poll_is_single_flight', async () => {
  let resolve: (v: ChatMessage[]) => void = () => {}
  listChat.mockReturnValue(new Promise<ChatMessage[]>((r) => { resolve = r }))
  render(<DailyChat itemId={ITEM} />)
  await tick(15000)
  expect(listChat).toHaveBeenCalledTimes(1)
  await act(async () => { resolve([]) })
  listChat.mockResolvedValue([])
  await tick()
  expect(listChat).toHaveBeenCalledTimes(2)
})

test('unmount_cleans_up', async () => {
  const r = render(<DailyChat itemId={ITEM} />)
  await screen.findByText(/아직 대화가 없어요/)
  r.unmount()
  expect(removeChannel).toHaveBeenCalledWith(channelMock.mock.results[0].value)
  await tick(20000)
  expect(listChat).toHaveBeenCalledTimes(1)
})

test('delete_two_step', async () => {
  deleteChat.mockResolvedValue(undefined)
  listChat.mockResolvedValue([msg('a', { mine: true, userId: 'u1', handle: 'kane', body: '내 글' }), msg('b', { body: '남의 글' })])
  const r = render(<DailyChat itemId={ITEM} />)
  const other = (await screen.findByText('남의 글')).closest('li') as HTMLElement
  expect(within(other).queryByRole('button', { name: /지우기/ })).toBeNull()
  const mine = screen.getByText('내 글').closest('li') as HTMLElement
  fireEvent.click(within(mine).getByRole('button', { name: '지우기' }))
  expect(deleteChat).not.toHaveBeenCalled()
  fireEvent.click(within(mine).getByRole('button', { name: '한 번 더 누르면 지우기' }))
  expect(deleteChat).toHaveBeenCalledWith('a')
  expect(await screen.findByText('삭제된 메시지')).toBeInTheDocument()
  expect(screen.queryByText('내 글')).toBeNull()
  r.unmount()
  admin = true
  render(<DailyChat itemId={ITEM} />)
  const other2 = (await screen.findByText('남의 글')).closest('li') as HTMLElement
  expect(within(other2).getByRole('button', { name: '지우기' })).toBeInTheDocument()
})

test('signed_url_retry_once', async () => {
  signedChatImageUrl.mockResolvedValueOnce('https://signed/old').mockResolvedValueOnce('https://signed/new')
  listChat.mockResolvedValue([msg('c', { imagePath: 'it1/u2/1.jpg', body: null })])
  render(<DailyChat itemId={ITEM} />)
  const img = await screen.findByRole('img', { name: 'son의 사진' })
  expect(img).toHaveAttribute('src', 'https://signed/old')
  fireEvent.error(img)
  await vi.waitFor(() => expect(screen.getByRole('img', { name: 'son의 사진' })).toHaveAttribute('src', 'https://signed/new'))
  expect(signedChatImageUrl).toHaveBeenCalledTimes(2)
  fireEvent.error(screen.getByRole('img', { name: 'son의 사진' }))
  expect(await screen.findByText('사진을 불러오지 못했어요')).toBeInTheDocument()
  expect(signedChatImageUrl).toHaveBeenCalledTimes(2)
})

test('signed_url_retry_resets_after_load', async () => {
  signedChatImageUrl
    .mockResolvedValueOnce('https://signed/1')
    .mockResolvedValueOnce('https://signed/2')
    .mockResolvedValueOnce('https://signed/3')
  listChat.mockResolvedValue([msg('c', { imagePath: 'it1/u2/1.jpg', body: null })])
  render(<DailyChat itemId={ITEM} />)
  const img = await screen.findByRole('img', { name: 'son의 사진' })
  expect(img).toHaveAttribute('src', 'https://signed/1')
  fireEvent.error(img)
  await vi.waitFor(() => expect(screen.getByRole('img', { name: 'son의 사진' })).toHaveAttribute('src', 'https://signed/2'))
  fireEvent.load(screen.getByRole('img', { name: 'son의 사진' }))
  // 한 시간 뒤 다시 만료돼도 새 주소를 한 번 더 받는다
  fireEvent.error(screen.getByRole('img', { name: 'son의 사진' }))
  await vi.waitFor(() => expect(screen.getByRole('img', { name: 'son의 사진' })).toHaveAttribute('src', 'https://signed/3'))
  expect(signedChatImageUrl).toHaveBeenCalledTimes(3)
  expect(screen.queryByText('사진을 불러오지 못했어요')).toBeNull()
})

test('image_opens_large_view', async () => {
  signedChatImageUrl.mockResolvedValue('https://signed/1')
  listChat.mockResolvedValue([msg('c', { imagePath: 'it1/u2/1.jpg', body: null })])
  render(<DailyChat itemId={ITEM} />)
  fireEvent.click(await screen.findByRole('button', { name: '사진 크게 보기' }))
  const dialog = screen.getByRole('dialog', { name: '사진 크게 보기' })
  expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://signed/1')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '사진 크게 보기' }))
  // 사진 위 클릭은 닫지 않고, 바깥 클릭은 닫는다
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('img'))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('dialog'))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('load_older', async () => {
  const page = Array.from({ length: 100 }, (_, i) =>
    msg(`m${i}`, { createdAt: new Date(Date.parse('2026-11-02T05:00:00Z') + i * 1000).toISOString() }))
  listChat.mockResolvedValueOnce(page)
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText('글 m99')
  listChat.mockResolvedValueOnce([msg('old1', { body: '오래된 글', createdAt: '2026-11-02T04:00:00Z' })])
  fireEvent.click(screen.getByRole('button', { name: '이전 대화 더 보기' }))
  expect(await screen.findByText('오래된 글')).toBeInTheDocument()
  expect(listChat).toHaveBeenLastCalledWith(ITEM, '2026-11-02T05:00:00.000Z')
  expect(screen.queryByRole('button', { name: '이전 대화 더 보기' })).toBeNull()
})

test('realtime_update_for_unknown_id_ignored', async () => {
  const page = Array.from({ length: 100 }, (_, i) =>
    msg(`m${i}`, { createdAt: new Date(Date.parse('2026-11-02T05:00:00Z') + i * 1000).toISOString() }))
  listChat.mockResolvedValueOnce(page)
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText('글 m99')
  // 불러온 범위 밖(더 오래된) 행이 고쳐져도 끼워 넣지 않는다
  act(() => rtCallback!({ eventType: 'UPDATE', new: row('ghost', { body: '유령', created_at: '2026-11-01T00:00:00.000Z' }) }))
  expect(screen.queryByText('유령')).toBeNull()
  listChat.mockResolvedValueOnce([])
  fireEvent.click(screen.getByRole('button', { name: '이전 대화 더 보기' }))
  await vi.waitFor(() => expect(listChat).toHaveBeenLastCalledWith(ITEM, '2026-11-02T05:00:00.000Z'))
  // INSERT는 여전히 붙는다
  act(() => rtCallback!({ eventType: 'INSERT', new: row('n1') }))
  expect(await screen.findByText('실시간 n1')).toBeInTheDocument()
})

test('no_older_button_when_first_page_short', async () => {
  listChat.mockResolvedValue([msg('a')])
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText('글 a')
  expect(screen.queryByRole('button', { name: '이전 대화 더 보기' })).toBeNull()
})

test('forbidden_shows_message', async () => {
  listChat.mockRejectedValue(new ApiError('forbidden', 403))
  render(<DailyChat itemId={ITEM} />)
  expect(await screen.findByText('문제를 끝낸 사람만 쓸 수 있어요')).toBeInTheDocument()
  // 거부되면 폴링을 멈춘다(매번 프로필을 다시 읽게 하지 않도록)
  await tick(15000)
  expect(listChat).toHaveBeenCalledTimes(1)
})

test('new_message_button_when_scrolled_up', async () => {
  listChat.mockResolvedValue([msg('a')])
  render(<DailyChat itemId={ITEM} />)
  await screen.findByText('글 a')
  const list = screen.getByRole('list', { name: '대화 목록' })
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 })
  list.scrollTop = 700
  fireEvent.scroll(list)
  // 내용이 늘기만 한 것(사진 로드)은 위로 올린 것이 아니다
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1200 })
  fireEvent.scroll(list)
  act(() => rtCallback!({ eventType: 'INSERT', new: row('n0', { created_at: '2026-11-02T05:30:00Z' }) }))
  await screen.findByText('실시간 n0')
  expect(screen.queryByRole('button', { name: '새 메시지' })).toBeNull()
  expect(list.scrollTop).toBe(1200)
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
  // 사용자가 위로 굴림
  list.scrollTop = 100
  fireEvent.scroll(list)
  act(() => rtCallback!({ eventType: 'INSERT', new: row('n1') }))
  await screen.findByText('실시간 n1')
  fireEvent.click(screen.getByRole('button', { name: '새 메시지' }))
  expect(screen.queryByRole('button', { name: '새 메시지' })).toBeNull()
  expect(list.scrollTop).toBe(1000)
  // 맨 아래에 있으면 버튼 없이 따라간다
  act(() => rtCallback!({ eventType: 'INSERT', new: row('n2', { created_at: '2026-11-02T06:05:00Z' }) }))
  await screen.findByText('실시간 n2')
  expect(screen.queryByRole('button', { name: '새 메시지' })).toBeNull()
})
