import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const listMock = vi.fn()
vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../wallet/enabled.ts', () => ({ walletEnabled: () => false }))
vi.mock('./clock.ts', () => ({ syncServerTime: () => Promise.resolve() }))
vi.mock('./data.ts', () => ({
  listContests: (...a: unknown[]) => listMock(...a),
  getEntryCounts: () => Promise.resolve(new Map()),
}))

import { ContestListPage } from './ContestListPage.tsx'
import { kstShort } from './format.ts'

const H = 3_600_000
const contest = (id: string, title: string, startMs: number, endMs: number, kind = 'official') => ({
  id, title, kind, created_by: null, visibility: 'public', cancelled_at: null, daily_key: null, created_at: '',
  starts_at: new Date(Date.now() + startMs).toISOString(), ends_at: new Date(Date.now() + endMs).toISOString(),
})
const view = () => render(<MemoryRouter><ContestListPage /></MemoryRouter>)

beforeEach(() => { listMock.mockReset() })

test('세 판(진행 중·예정·종료)과 빈 문구', async () => {
  listMock.mockResolvedValue([])
  view()
  const live = await screen.findByRole('region', { name: '진행 중' })
  expect(live.className).toContain('fm-panel')
  expect(live.textContent).toContain('진행 중인 대회가 없어요')
  expect(screen.getByRole('region', { name: '예정' }).textContent).toContain('예정된 대회가 없어요')
  expect(screen.getByRole('region', { name: '종료' }).textContent).toContain('최근 30일 안에 끝난 대회가 없어요')
  expect(screen.getByRole('heading', { name: '대회' }).className).toContain('sr-only')
})

test('종료 판 표에 대회 링크·종류·시작 시각', async () => {
  const c = contest('c1', '주말 컵', -5 * H, -3 * H, 'friendly')
  listMock.mockResolvedValue([c, contest('c2', '지금 컵', -H, H)])
  view()
  const ended = await screen.findByRole('region', { name: '종료' })
  const table = within(ended).getByRole('table')
  expect(table.className).toContain('fm-table')
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['대회', '종류', '시작'])
  const row = within(table).getByRole('link', { name: '주말 컵' }).closest('tr')!
  expect(within(table).getByRole('link', { name: '주말 컵' }).getAttribute('href')).toBe('/contests/c1')
  expect(row.textContent).toContain('친선')
  expect(row.textContent).toContain(kstShort(c.starts_at))
  expect(within(screen.getByRole('region', { name: '진행 중' })).getByRole('link', { name: '지금 컵' })).toBeTruthy()
})

test('대회 만들기 링크는 /contests/new (채움 버튼)', async () => {
  listMock.mockResolvedValue([])
  view()
  const a = screen.getByRole('link', { name: '대회 만들기' })
  expect(a.getAttribute('href')).toBe('/contests/new')
  expect(a.className).toContain('btn-primary')
})

test('kstShort: KST M/D (요일) HH:MM', () => {
  expect(kstShort('2026-11-28T05:00:00Z')).toBe('11/28 (토) 14:00')
  expect(kstShort('2026-12-31T15:30:00Z')).toBe('1/1 (금) 00:30')
})
