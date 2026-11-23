import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
const listMock = vi.fn()
const postMock = vi.fn()
const deleteMock = vi.fn()
const voteMock = vi.fn()
vi.mock('./api.ts', async (orig) => ({
  ...(await orig<typeof import('./api.ts')>()),
  listSuggestions: (...a: unknown[]) => listMock(...a),
  postSuggestion: (...a: unknown[]) => postMock(...a),
  deleteSuggestion: (...a: unknown[]) => deleteMock(...a),
  voteSuggestion: (...a: unknown[]) => voteMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile: { id: 'me', handle: 'boss', status: 'approved', is_admin: false } }),
}))
vi.mock('../../games/index.ts', () => ({
  games: [
    { manifest: { id: 'players', name: '선수 맞추기', hidden: false } },
    { manifest: { id: 'secret', name: '비밀 게임', hidden: true } },
  ],
  duels: [{ manifest: { id: 'yacht', name: '요트', hidden: false } }],
  worlds: [],
}))

import { ApiError } from '../../lib/api.ts'
import type { Suggestion } from './api.ts'
import { SuggestPage } from './SuggestPage.tsx'

const sg = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: 's1', target: 'players', handle: 'kane', body: '힌트를 늘려줘', status: 'open', publicReason: null,
  duplicateOf: null, prUrl: null, createdAt: '2026-11-01T00:00:00Z', votes: 2, voted: false, mine: false, canDelete: false,
  ...over,
})

const renderPage = () => render(<MemoryRouter><SuggestPage /></MemoryRouter>)
const items = () => screen.getAllByRole('listitem')

beforeEach(() => {
  vi.clearAllMocks()
  listMock.mockResolvedValue([sg()])
})

test('목록이 게임 이름, 상태, 본문, 공감 수와 함께 뜬다', async () => {
  renderPage()
  expect(screen.getByText('불러오는 중…')).toBeTruthy()
  const li = (await screen.findByText('힌트를 늘려줘')).closest('li') as HTMLElement
  expect(within(li).getByText(/선수 맞추기/)).toBeTruthy()
  expect(within(li).getByText(/검토 중/)).toBeTruthy()
  expect(within(li).getByRole('button', { name: '공감' }).textContent).toContain('2')
  expect(within(li).getByText('kane')).toBeTruthy()
})

test('본문은 텍스트로만 렌더링된다', async () => {
  listMock.mockResolvedValue([sg({ body: '<script>alert(1)</script>' })])
  renderPage()
  expect(await screen.findByText('<script>alert(1)</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
})

test('handle이 null이면 알 수 없음', async () => {
  listMock.mockResolvedValue([sg({ handle: null })])
  renderPage()
  expect(await screen.findByText('알 수 없음')).toBeTruthy()
})

test('칩을 누르면 그 대상으로 다시 읽는다', async () => {
  renderPage()
  await screen.findByText('힌트를 늘려줘')
  expect(listMock).toHaveBeenLastCalledWith(null)
  expect(screen.queryByRole('button', { name: '비밀 게임' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '사이트' }))
  await waitFor(() => expect(listMock).toHaveBeenLastCalledWith('site'))
})

test('공감순을 누르면 votes가 큰 항목이 먼저 온다', async () => {
  listMock.mockResolvedValue([
    sg({ id: 'a', body: 'AAAAA', votes: 1, createdAt: '2026-11-03T00:00:00Z' }),
    sg({ id: 'b', body: 'BBBBB', votes: 9, createdAt: '2026-11-01T00:00:00Z' }),
    sg({ id: 'c', body: 'CCCCC', votes: 1, createdAt: '2026-11-02T00:00:00Z' }),
  ])
  renderPage()
  await screen.findByText('AAAAA')
  expect(items().map((li) => li.textContent?.match(/[ABC]{5}/)?.[0])).toEqual(['AAAAA', 'CCCCC', 'BBBBB'])
  fireEvent.click(screen.getByRole('button', { name: '공감순' }))
  expect(items().map((li) => li.textContent?.match(/[ABC]{5}/)?.[0])).toEqual(['BBBBB', 'AAAAA', 'CCCCC'])
})

test('4자면 올리기 비활성, 5자면 올리고 비우고 다시 읽는다', async () => {
  postMock.mockResolvedValue('new')
  renderPage()
  await screen.findByText('힌트를 늘려줘')
  const box = screen.getByLabelText('제안 내용') as HTMLTextAreaElement
  const btn = screen.getByRole('button', { name: '올리기' }) as HTMLButtonElement
  expect(box.getAttribute('placeholder')).toBe('어떤 게임에 뭘 바꾸면 좋을지 적어줘')
  expect(box.maxLength).toBe(500)
  fireEvent.change(box, { target: { value: 'abcd' } })
  expect(btn.disabled).toBe(true)
  fireEvent.change(box, { target: { value: 'abcde' } })
  expect(btn.disabled).toBe(false)
  const before = listMock.mock.calls.length
  fireEvent.click(btn)
  await waitFor(() => expect(postMock).toHaveBeenCalledWith('players', 'abcde'))
  await waitFor(() => expect(box.value).toBe(''))
  await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThan(before))
})

test('특정 대상 필터에서 다른 대상으로 올리면 필터가 그 대상으로 바뀐다', async () => {
  postMock.mockResolvedValue('new')
  renderPage()
  await screen.findByText('힌트를 늘려줘')
  fireEvent.click(screen.getByRole('button', { name: '사이트' }))
  await waitFor(() => expect(listMock).toHaveBeenLastCalledWith('site'))
  fireEvent.change(screen.getByLabelText('대상'), { target: { value: 'players' } })
  fireEvent.change(screen.getByLabelText('제안 내용'), { target: { value: 'abcde' } })
  fireEvent.click(screen.getByRole('button', { name: '올리기' }))
  await waitFor(() => expect(postMock).toHaveBeenCalledWith('players', 'abcde'))
  await waitFor(() => expect(listMock).toHaveBeenLastCalledWith('players'))
  expect(screen.getByRole('button', { name: '선수 맞추기' }).getAttribute('aria-pressed')).toBe('true')
})

test('전체 필터에서 올리면 필터는 그대로 전체다', async () => {
  postMock.mockResolvedValue('new')
  renderPage()
  await screen.findByText('힌트를 늘려줘')
  fireEvent.change(screen.getByLabelText('제안 내용'), { target: { value: 'abcde' } })
  fireEvent.click(screen.getByRole('button', { name: '올리기' }))
  await waitFor(() => expect(postMock).toHaveBeenCalled())
  await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThan(1))
  expect(listMock).toHaveBeenLastCalledWith(null)
  expect(screen.getByRole('button', { name: '전체' }).getAttribute('aria-pressed')).toBe('true')
})

test('올리기 실패는 alert로 보인다', async () => {
  postMock.mockRejectedValue(new ApiError('too_many', 400))
  renderPage()
  await screen.findByText('힌트를 늘려줘')
  fireEvent.change(screen.getByLabelText('제안 내용'), { target: { value: 'abcde' } })
  fireEvent.click(screen.getByRole('button', { name: '올리기' }))
  expect((await screen.findByRole('alert')).textContent).toContain('제안은 하루 5개까지 올릴 수 있어요')
})

test('공감을 누르면 수와 pressed가 바뀐다', async () => {
  voteMock.mockResolvedValue(7)
  renderPage()
  const btn = await screen.findByRole('button', { name: '공감' })
  expect(btn.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(btn)
  await waitFor(() => expect(voteMock).toHaveBeenCalledWith('s1', true))
  await waitFor(() => expect(btn.textContent).toContain('7'))
  expect(btn.getAttribute('aria-pressed')).toBe('true')
})

test('삭제는 canDelete 항목에만 있고 두 번 눌러야 지운다', async () => {
  listMock.mockResolvedValue([sg({ id: 'a', body: 'AAAAA', canDelete: true }), sg({ id: 'b', body: 'BBBBB' })])
  deleteMock.mockResolvedValue(undefined)
  renderPage()
  await screen.findByText('AAAAA')
  expect(screen.getAllByRole('button', { name: '삭제' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '삭제' }))
  expect(deleteMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /정말 삭제/ }))
  await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('a'))
  await waitFor(() => expect(screen.queryByText('AAAAA')).toBeNull())
})

test('이유와 PR 링크가 보인다', async () => {
  listMock.mockResolvedValue([sg({ publicReason: '다음 달에 해요', prUrl: 'https://github.com/x/y/pull/1' })])
  renderPage()
  expect(await screen.findByText(/다음 달에 해요/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'PR' }).getAttribute('href')).toBe('https://github.com/x/y/pull/1')
})

test('원 제안 보기는 목록에 있을 때만 나온다', async () => {
  listMock.mockResolvedValue([sg({ id: 'a', body: 'AAAAA' }), sg({ id: 'b', body: 'BBBBB', duplicateOf: 'a' })])
  const { unmount } = renderPage()
  await screen.findByText('AAAAA')
  expect(screen.getAllByText('원 제안 보기')).toHaveLength(1)
  unmount()
  listMock.mockResolvedValue([sg({ id: 'b', body: 'BBBBB', duplicateOf: 'gone' })])
  renderPage()
  await screen.findByText('BBBBB')
  expect(screen.queryByText('원 제안 보기')).toBeNull()
})

test('빈 목록', async () => {
  listMock.mockResolvedValue([])
  renderPage()
  expect(await screen.findByText('아직 제안이 없어요')).toBeTruthy()
})

test('목록 읽기 실패는 오류와 다시 시도', async () => {
  listMock.mockRejectedValueOnce(new ApiError('network', 0))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('힌트를 늘려줘')).toBeTruthy()
})
