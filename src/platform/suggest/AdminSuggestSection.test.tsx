import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
const listMock = vi.fn()
const decideMock = vi.fn()
const shippedMock = vi.fn()
vi.mock('./adminApi.ts', () => ({
  listAdminSuggestions: (...a: unknown[]) => listMock(...a),
  decideSuggestion: (...a: unknown[]) => decideMock(...a),
  markSuggestionShipped: (...a: unknown[]) => shippedMock(...a),
}))
vi.mock('../../games/index.ts', () => ({
  games: [
    { manifest: { id: 'players', name: '선수 맞추기', hidden: false } },
    { manifest: { id: 'clubs', name: '클럽 맞추기', hidden: false } },
  ],
  duels: [],
  worlds: [],
}))

import { ApiError } from '../../lib/api.ts'
import type { AdminSuggestion } from './adminApi.ts'
import { AdminSuggestSection } from './AdminSuggestSection.tsx'

const sg = (over: Partial<AdminSuggestion> = {}): AdminSuggestion => ({
  id: 's1', target: 'players', handle: 'kane', body: '힌트를 늘려줘', status: 'open', publicReason: null,
  duplicateOf: null, prUrl: null, createdAt: '2026-11-01T00:00:00Z', votes: 2, verdict: 'recommend',
  summary: '힌트 추가', note: null, triagedAt: '2026-11-02T00:00:00Z',
  ...over,
})

const renderSection = () => render(<AdminSuggestSection />)

beforeEach(() => {
  vi.clearAllMocks()
  listMock.mockResolvedValue([sg()])
  decideMock.mockResolvedValue('planned')
  shippedMock.mockResolvedValue(undefined)
})

test('두 게임의 항목이 게임 소제목 아래 맞는 묶음에 들어간다', async () => {
  listMock.mockResolvedValue([
    sg({ id: 'a', body: 'AAAAA 추천', summary: 'A 요약' }),
    sg({ id: 'b', body: 'BBBBB 보류', verdict: 'hold', summary: 'B 요약' }),
    sg({ id: 'c', body: 'CCCCC 기각', status: 'rejected', verdict: 'reject', summary: 'C 요약' }),
    sg({ id: 'd', target: 'clubs', body: 'DDDDD 추천', summary: 'D 요약' }),
  ])
  renderSection()
  const players = await screen.findByRole('region', { name: '선수 맞추기' })
  expect(within(within(players).getByRole('group', { name: '추천' })).getByText('AAAAA 추천')).toBeTruthy()
  expect(within(within(players).getByRole('group', { name: '보류 · 설계 필요' })).getByText('BBBBB 보류')).toBeTruthy()
  expect(within(within(players).getByRole('group', { name: '기각됨' })).getByText('CCCCC 기각')).toBeTruthy()
  const clubs = screen.getByRole('region', { name: '클럽 맞추기' })
  expect(within(within(clubs).getByRole('group', { name: '추천' })).getByText('DDDDD 추천')).toBeTruthy()
  expect(within(clubs).queryByRole('group', { name: '보류 · 설계 필요' })).toBeNull()
  expect(within(clubs).queryByRole('group', { name: '기각됨' })).toBeNull()
})

test('항목에 요약, 원문, 작성자, 공감 수, 공개 이유가 보인다', async () => {
  listMock.mockResolvedValue([sg({ publicReason: '좋은 생각이에요' })])
  renderSection()
  const li = (await screen.findByText('힌트를 늘려줘')).closest('li') as HTMLElement
  expect(within(li).getByText('힌트 추가').tagName).toBe('STRONG')
  expect(within(li).getByText(/kane/)).toBeTruthy()
  expect(within(li).getByText(/2/)).toBeTruthy()
  expect(within(li).getByText(/좋은 생각이에요/)).toBeTruthy()
})

test('분류 전 항목은 건수 한 줄로만 보이고 본문은 숨는다', async () => {
  listMock.mockResolvedValue([
    sg({ id: 'a', body: '분류전 하나', verdict: null }),
    sg({ id: 'b', body: '분류전 둘', verdict: null }),
  ])
  renderSection()
  expect(await screen.findByText('분류 대기 2건')).toBeTruthy()
  expect(screen.queryByText('분류전 하나')).toBeNull()
  expect(screen.queryByText('분류전 둘')).toBeNull()
  expect(screen.queryByText('검토할 제안이 없어요')).toBeNull()
})

test('추천 항목의 승인은 바로 실행하고 목록을 다시 읽는다', async () => {
  renderSection()
  fireEvent.click(await screen.findByRole('button', { name: '승인' }))
  await waitFor(() => expect(decideMock).toHaveBeenCalledWith('s1', true))
  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
})

test('보류 항목에는 설계 예정으로 버튼이 있고 승인으로 처리된다', async () => {
  listMock.mockResolvedValue([sg({ verdict: 'hold' })])
  renderSection()
  expect(screen.queryByRole('button', { name: '승인' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: '설계 예정으로' }))
  await waitFor(() => expect(decideMock).toHaveBeenCalledWith('s1', true))
})

test('거절은 이유 입력칸을 펼치고 거절 확정으로 이유와 함께 보낸다', async () => {
  renderSection()
  fireEvent.click(await screen.findByRole('button', { name: '거절' }))
  const input = screen.getByLabelText('거절 이유') as HTMLInputElement
  expect(input.maxLength).toBe(200)
  expect(decideMock).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '이유 X' } })
  fireEvent.click(screen.getByRole('button', { name: '거절 확정' }))
  await waitFor(() => expect(decideMock).toHaveBeenCalledWith('s1', false, '이유 X'))
  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
})

test('거절 취소는 호출 없이 닫는다', async () => {
  renderSection()
  fireEvent.click(await screen.findByRole('button', { name: '거절' }))
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(screen.queryByLabelText('거절 이유')).toBeNull()
  expect(decideMock).not.toHaveBeenCalled()
})

test('기각됨은 details 안에 있고 승인으로 뒤집을 수 있다', async () => {
  listMock.mockResolvedValue([sg({ status: 'rejected', verdict: 'reject' })])
  renderSection()
  const btn = await screen.findByRole('button', { name: '승인으로 뒤집기' })
  const details = btn.closest('details') as HTMLDetailsElement
  expect(details).toBeTruthy()
  expect(details.open).toBe(false)
  expect(within(details).getByText('기각됨 1건')).toBeTruthy()
  fireEvent.click(btn)
  await waitFor(() => expect(decideMock).toHaveBeenCalledWith('s1', true))
})

test('note가 있으면 주의: 로 보인다', async () => {
  listMock.mockResolvedValue([sg({ note: '중복 가능성' })])
  renderSection()
  expect(await screen.findByText('주의: 중복 가능성')).toBeTruthy()
})

test('진행 중 묶음은 상태와 PR 링크를 보이고 design은 반영됨으로 표시할 수 있다', async () => {
  listMock.mockResolvedValue([
    sg({ id: 'p', body: '계획된 제안', status: 'planned', prUrl: 'https://x/pr/9' }),
    sg({ id: 'd', body: '설계할 제안', status: 'design' }),
  ])
  renderSection()
  const prog = await screen.findByRole('group', { name: '진행 중' })
  const planned = within(prog).getByText('계획된 제안').closest('li') as HTMLElement
  expect(within(planned).getByText(/반영 예정/)).toBeTruthy()
  expect((within(planned).getByRole('link', { name: 'PR' }) as HTMLAnchorElement).href).toBe('https://x/pr/9')
  expect(within(planned).queryByRole('button', { name: '반영됨으로 표시' })).toBeNull()
  const design = within(prog).getByText('설계할 제안').closest('li') as HTMLElement
  expect(within(design).getByText(/설계 예정/)).toBeTruthy()
  fireEvent.click(within(design).getByRole('button', { name: '반영됨으로 표시' }))
  await waitFor(() => expect(shippedMock).toHaveBeenCalledWith('d'))
  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
})

test('진행 중의 planned(PR 있음·없음)와 design 항목은 거절 이유와 함께 거절할 수 있다', async () => {
  listMock.mockResolvedValue([
    sg({ id: 'p1', body: '닫힌 PR 제안', status: 'planned', prUrl: 'https://github.com/x/y/pull/9' }),
    sg({ id: 'p2', body: 'PR 없는 제안', status: 'planned' }),
    sg({ id: 'd1', body: '설계할 제안', status: 'design' }),
  ])
  renderSection()
  const prog = await screen.findByRole('group', { name: '진행 중' })
  for (const text of ['닫힌 PR 제안', 'PR 없는 제안', '설계할 제안']) {
    const li = within(prog).getByText(text).closest('li') as HTMLElement
    expect(within(li).getByRole('button', { name: '거절' })).toBeTruthy()
  }
  const li = within(prog).getByText('닫힌 PR 제안').closest('li') as HTMLElement
  fireEvent.click(within(li).getByRole('button', { name: '거절' }))
  fireEvent.change(within(li).getByLabelText('거절 이유'), { target: { value: 'PR이 닫혔어요' } })
  fireEvent.click(within(li).getByRole('button', { name: '거절 확정' }))
  await waitFor(() => expect(decideMock).toHaveBeenCalledWith('p1', false, 'PR이 닫혔어요'))
  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
})

test('진행 중 항목의 거절 취소는 호출 없이 닫는다', async () => {
  listMock.mockResolvedValue([sg({ id: 'd1', body: '설계할 제안', status: 'design' })])
  renderSection()
  const prog = await screen.findByRole('group', { name: '진행 중' })
  fireEvent.click(within(prog).getByRole('button', { name: '거절' }))
  expect(within(prog).getByLabelText('거절 이유')).toBeTruthy()
  fireEvent.click(within(prog).getByRole('button', { name: '취소' }))
  expect(within(prog).queryByLabelText('거절 이유')).toBeNull()
  expect(decideMock).not.toHaveBeenCalled()
})

test('결정이 not_editable로 실패하면 alert를 보인다', async () => {
  decideMock.mockRejectedValue(new ApiError('not_editable', 400))
  renderSection()
  fireEvent.click(await screen.findByRole('button', { name: '승인' }))
  expect((await screen.findByRole('alert')).textContent).toContain('지금은 바꿀 수 없어요')
})

test('빈 배열이면 검토할 제안이 없어요', async () => {
  listMock.mockResolvedValue([])
  renderSection()
  expect(await screen.findByText('검토할 제안이 없어요')).toBeTruthy()
  expect(screen.queryByRole('group', { name: '진행 중' })).toBeNull()
})
