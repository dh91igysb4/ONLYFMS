import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { BlockFrame } from './BlockFrame.tsx'
import { useBlockData } from './useBlockData.ts'

function Probe({ load }: { load: () => Promise<string> }) {
  const { state, retry } = useBlockData(load, [])
  return (
    <BlockFrame title="테스트 블록" state={state} onRetry={retry}>
      {state.kind === 'done' && <p>{state.data}</p>}
    </BlockFrame>
  )
}

afterEach(() => vi.restoreAllMocks())

test('shows_loading_then_children', async () => {
  render(<Probe load={() => Promise.resolve('안녕')} />)
  expect(screen.getByText('불러오는 중…')).toBeTruthy()
  expect(await screen.findByText('안녕')).toBeTruthy()
  expect(screen.queryByText('불러오는 중…')).toBeNull()
})

test('error_then_retry_calls_load_again', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('성공')
  render(<Probe load={load} />)
  expect(await screen.findByText('불러오지 못했어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('성공')).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(2)
})

function KeyedProbe({ k, load }: { k: string; load: () => Promise<string> }) {
  const { state, retry } = useBlockData(load, [k])
  return (
    <BlockFrame title="경합 블록" state={state} onRetry={retry}>
      {state.kind === 'done' && <p>{state.data}</p>}
    </BlockFrame>
  )
}

test('stale_result_from_previous_deps_is_discarded', async () => {
  const resolvers: Record<string, (v: string) => void> = {}
  const load = (k: string) => () => new Promise<string>((r) => { resolvers[k] = r })
  const { rerender } = render(<KeyedProbe k="a" load={load('a')} />)
  rerender(<KeyedProbe k="b" load={load('b')} />)
  await act(async () => { resolvers.b('second') })
  expect(screen.getByText('second')).toBeTruthy()
  await act(async () => { resolvers.a('first') })
  expect(screen.getByText('second')).toBeTruthy()
  expect(screen.queryByText('first')).toBeNull()
})
