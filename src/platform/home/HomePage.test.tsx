import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
const refreshMock = vi.fn()
const mountSpy = vi.fn()
let profile: Record<string, unknown> | null = null

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile, refresh: refreshMock }),
}))
vi.mock('./blocks.ts', async () => {
  const React = await import('react')
  const make = (id: string) => ({
    id,
    title: id.toUpperCase(),
    Component: ({ title }: { title: string }) => {
      React.useEffect(() => { mountSpy(id) }, [])
      return React.createElement('p', null, `${title} 내용`)
    },
  })
  const homeBlocks = [make('a'), make('b'), make('c')]
  return { homeBlocks, homeBlockIds: homeBlocks.map((b) => b.id) }
})

import { ApiError } from '../../lib/api.ts'
import { HomePage } from './HomePage.tsx'

beforeEach(() => {
  rpcMock.mockReset()
  rpcMock.mockResolvedValue(undefined)
  refreshMock.mockReset()
  refreshMock.mockResolvedValue(undefined)
  mountSpy.mockReset()
  profile = { home_layout: null }
})

function viewOrder() {
  return screen.queryAllByText(/ 내용$/).map((el) => el.textContent)
}
const edit = () => fireEvent.click(screen.getByRole('button', { name: '편집' }))
const done = () => fireEvent.click(screen.getByRole('button', { name: '완료' }))

test('기본값이면 a,b,c 순서로 렌더', () => {
  render(<HomePage />)
  expect(viewOrder()).toEqual(['A 내용', 'B 내용', 'C 내용'])
})

test('저장값 순서와 꺼진 블록 반영, 꺼진 블록은 마운트하지 않음', () => {
  profile = { home_layout: [{ id: 'c', on: true }, { id: 'a', on: false }] }
  render(<HomePage />)
  expect(viewOrder()).toEqual(['C 내용', 'B 내용'])
  expect(mountSpy).not.toHaveBeenCalledWith('a')
})

test('위로 이동 후 완료 → 전체 배열 저장, 새 순서 표시', async () => {
  render(<HomePage />)
  edit()
  fireEvent.click(screen.getByRole('button', { name: 'B 위로' }))
  done()
  await waitFor(() => expect(screen.getByRole('button', { name: '편집' })).toBeTruthy())
  expect(rpcMock).toHaveBeenCalledWith('set_home_layout', {
    p_layout: [{ id: 'b', on: true }, { id: 'a', on: true }, { id: 'c', on: true }],
  })
  expect(viewOrder()).toEqual(['B 내용', 'A 내용', 'C 내용'])
  expect(refreshMock).toHaveBeenCalled()
})

test('스위치 끄기 → 배열에 on:false 포함', async () => {
  render(<HomePage />)
  edit()
  const sw = screen.getByRole('switch', { name: 'A 표시' })
  expect(sw.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(sw)
  expect(screen.getByRole('switch', { name: 'A 표시' }).getAttribute('aria-checked')).toBe('false')
  done()
  await waitFor(() => expect(rpcMock).toHaveBeenCalled())
  const arg = rpcMock.mock.calls[0][1] as { p_layout: { id: string; on: boolean }[] }
  expect(arg.p_layout).toContainEqual({ id: 'a', on: false })
  await waitFor(() => expect(screen.getByRole('button', { name: '편집' })).toBeTruthy())
})

test('기본값으로 → 완료 → p_layout null', async () => {
  profile = { home_layout: [{ id: 'c', on: true }, { id: 'a', on: true }, { id: 'b', on: false }] }
  render(<HomePage />)
  edit()
  fireEvent.click(screen.getByRole('button', { name: '기본값으로' }))
  done()
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('set_home_layout', { p_layout: null }))
  await waitFor(() => expect(screen.getByRole('button', { name: '편집' })).toBeTruthy())
  expect(viewOrder()).toEqual(['A 내용', 'B 내용', 'C 내용'])
})

test('기본값으로 후 이동하면 배열 전송', async () => {
  render(<HomePage />)
  edit()
  fireEvent.click(screen.getByRole('button', { name: '기본값으로' }))
  fireEvent.click(screen.getByRole('button', { name: 'C 위로' }))
  done()
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('set_home_layout', {
    p_layout: [{ id: 'a', on: true }, { id: 'c', on: true }, { id: 'b', on: true }],
  }))
  await waitFor(() => expect(screen.getByRole('button', { name: '편집' })).toBeTruthy())
})

test('취소 → 이전 순서, rpc 없음', () => {
  render(<HomePage />)
  edit()
  fireEvent.click(screen.getByRole('button', { name: 'B 위로' }))
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(rpcMock).not.toHaveBeenCalled()
  expect(viewOrder()).toEqual(['A 내용', 'B 내용', 'C 내용'])
})

test('저장 실패 → 편집 모드 유지, alert', async () => {
  rpcMock.mockRejectedValue(new ApiError('home_layout_invalid', 400))
  render(<HomePage />)
  edit()
  fireEvent.click(screen.getByRole('button', { name: 'B 위로' }))
  done()
  expect((await screen.findByRole('alert')).textContent).toBe('홈 설정을 저장하지 못했어요')
  expect(screen.getByRole('button', { name: '완료' })).toBeTruthy()
  expect((screen.getByRole('button', { name: '완료' }) as HTMLButtonElement).disabled).toBe(false)
  expect(refreshMock).not.toHaveBeenCalled()
})

test('저장 성공 후 refresh가 profile을 바꾸지 않아도 새 순서 유지', async () => {
  render(<HomePage />)
  edit()
  fireEvent.click(screen.getByRole('button', { name: 'B 위로' }))
  done()
  await waitFor(() => expect(refreshMock).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByRole('button', { name: '편집' })).toBeTruthy())
  expect(viewOrder()).toEqual(['B 내용', 'A 내용', 'C 내용'])
})

test('완료 두 번 빠르게 클릭 → rpc 1회', async () => {
  render(<HomePage />)
  edit()
  fireEvent.click(screen.getByRole('button', { name: 'B 위로' }))
  const btn = screen.getByRole('button', { name: '완료' })
  fireEvent.click(btn)
  fireEvent.click(btn)
  await waitFor(() => expect(screen.getByRole('button', { name: '편집' })).toBeTruthy())
  expect(rpcMock).toHaveBeenCalledTimes(1)
})

test('모두 꺼짐 → 안내 문구, 마운트 없음', () => {
  profile = { home_layout: [{ id: 'a', on: false }, { id: 'b', on: false }, { id: 'c', on: false }] }
  render(<HomePage />)
  expect(screen.getByText('표시할 블록이 없어요. 편집에서 켜 주세요')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: '편집' }).length).toBeGreaterThan(0)
  expect(mountSpy).not.toHaveBeenCalled()
})

test('편집 모드에서는 블록을 마운트하지 않고 끝 버튼은 disabled', () => {
  render(<HomePage />)
  mountSpy.mockClear()
  edit()
  expect(mountSpy).not.toHaveBeenCalled()
  expect(viewOrder()).toEqual([])
  expect((screen.getByRole('button', { name: 'A 위로' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'C 아래로' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'A 아래로' }) as HTMLButtonElement).disabled).toBe(false)
  const row = screen.getByRole('switch', { name: 'A 표시' }).closest('.home-edit-row')!
  expect(within(row as HTMLElement).getByText('A')).toBeTruthy()
})
