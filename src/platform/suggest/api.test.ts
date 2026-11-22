import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'http://x', supabaseKey: 'k' }))
const rpcMock = vi.fn()
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))

import { errorMessage } from '../../lib/api.ts'
import { deleteSuggestion, listSuggestions, postSuggestion, STATUS_LABEL, suggestErrorMessage, voteSuggestion } from './api.ts'

beforeEach(() => { vi.clearAllMocks() })

test('listSuggestions는 target 없이 null로 부르고 snake_case 행을 바꾼다', async () => {
  rpcMock.mockResolvedValue([{
    id: 's1', target: 'site', handle: 'kane', body: '본문입니다', status: 'planned', public_reason: '좋아요',
    duplicate_of: 's0', pr_url: 'https://x/pr/1', created_at: '2026-11-01T00:00:00Z', votes: 3, voted: true, mine: false, can_delete: true,
  }])
  const out = await listSuggestions()
  expect(rpcMock).toHaveBeenCalledWith('suggestion_list', { p_target: null })
  expect(out).toEqual([{
    id: 's1', target: 'site', handle: 'kane', body: '본문입니다', status: 'planned', publicReason: '좋아요',
    duplicateOf: 's0', prUrl: 'https://x/pr/1', createdAt: '2026-11-01T00:00:00Z', votes: 3, voted: true, mine: false, canDelete: true,
  }])
})

test('listSuggestions(target)은 p_target을 넘긴다', async () => {
  rpcMock.mockResolvedValue([])
  await listSuggestions('site')
  expect(rpcMock).toHaveBeenCalledWith('suggestion_list', { p_target: 'site' })
})

test('postSuggestion은 새 id를 돌려준다', async () => {
  rpcMock.mockResolvedValue('new-id')
  expect(await postSuggestion('site', 'abcde')).toBe('new-id')
  expect(rpcMock).toHaveBeenCalledWith('suggestion_post', { p_target: 'site', p_body: 'abcde' })
})

test('deleteSuggestion은 suggestion_delete를 부른다', async () => {
  rpcMock.mockResolvedValue(null)
  await deleteSuggestion('x')
  expect(rpcMock).toHaveBeenCalledWith('suggestion_delete', { p_id: 'x' })
})

test('voteSuggestion은 숫자를 돌려준다', async () => {
  rpcMock.mockResolvedValue(4)
  expect(await voteSuggestion('x', true)).toBe(4)
  expect(rpcMock).toHaveBeenCalledWith('suggestion_vote', { p_id: 'x', p_on: true })
})

test('STATUS_LABEL', () => {
  expect(STATUS_LABEL).toEqual({ open: '검토 중', planned: '반영 예정', design: '설계 예정', shipped: '반영됨', rejected: '기각' })
})

test('suggestErrorMessage는 제안 코드를 풀고 나머지는 errorMessage로 넘긴다', () => {
  expect(suggestErrorMessage('too_many')).toBe('제안은 하루 5개까지 올릴 수 있어요')
  expect(suggestErrorMessage('not_deletable')).toBe('검토가 시작된 제안은 지울 수 없어요')
  expect(suggestErrorMessage('zzz_unknown')).toBe(errorMessage('zzz_unknown'))
})
