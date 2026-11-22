import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'http://x', supabaseKey: 'k' }))
const rpcMock = vi.fn()
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))

import { decideSuggestion, listAdminSuggestions, markSuggestionShipped, suggestionPendingCount } from './adminApi.ts'

beforeEach(() => { vi.clearAllMocks() })

test('listAdminSuggestions는 인자 없이 부르고 snake_case 행을 바꾼다', async () => {
  rpcMock.mockResolvedValue([{
    id: 's1', target: 'site', handle: null, body: '본문입니다', status: 'open', public_reason: '이유',
    duplicate_of: 's0', pr_url: 'https://x/pr/1', created_at: '2026-11-01T00:00:00Z', votes: 3,
    verdict: 'recommend', summary: '요약', note: '메모', triaged_at: '2026-11-02T00:00:00Z',
  }])
  const out = await listAdminSuggestions()
  expect(rpcMock).toHaveBeenCalledWith('admin_suggestion_list')
  expect(out).toEqual([{
    id: 's1', target: 'site', handle: null, body: '본문입니다', status: 'open', publicReason: '이유',
    duplicateOf: 's0', prUrl: 'https://x/pr/1', createdAt: '2026-11-01T00:00:00Z', votes: 3,
    verdict: 'recommend', summary: '요약', note: '메모', triagedAt: '2026-11-02T00:00:00Z',
  }])
})

test('decideSuggestion은 이유를 다듬고 비면 null로 보낸다', async () => {
  rpcMock.mockResolvedValue('rejected')
  expect(await decideSuggestion('x', false, '  ')).toBe('rejected')
  expect(rpcMock).toHaveBeenLastCalledWith('admin_suggestion_decide', { p_id: 'x', p_approve: false, p_reason: null })
  await decideSuggestion('x', false, ' 이유 ')
  expect(rpcMock).toHaveBeenLastCalledWith('admin_suggestion_decide', { p_id: 'x', p_approve: false, p_reason: '이유' })
  await decideSuggestion('x', true)
  expect(rpcMock).toHaveBeenLastCalledWith('admin_suggestion_decide', { p_id: 'x', p_approve: true, p_reason: null })
})

test('markSuggestionShipped와 suggestionPendingCount는 RPC 이름과 인자를 맞춘다', async () => {
  rpcMock.mockResolvedValue(null)
  await markSuggestionShipped('x')
  expect(rpcMock).toHaveBeenLastCalledWith('admin_suggestion_shipped', { p_id: 'x' })
  rpcMock.mockResolvedValue(4)
  expect(await suggestionPendingCount()).toBe(4)
  expect(rpcMock).toHaveBeenLastCalledWith('admin_suggestion_pending_count')
})
