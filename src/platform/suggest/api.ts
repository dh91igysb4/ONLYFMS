import { errorMessage, rpc } from '../../lib/api.ts'

export type SuggestionStatus = 'open' | 'planned' | 'design' | 'shipped' | 'rejected'

export type Suggestion = {
  id: string
  target: string
  handle: string | null
  body: string
  status: SuggestionStatus
  publicReason: string | null
  duplicateOf: string | null
  prUrl: string | null
  createdAt: string
  votes: number
  voted: boolean
  mine: boolean
  canDelete: boolean
}

type SuggestionRow = {
  id: string
  target: string
  handle: string | null
  body: string
  status: SuggestionStatus
  public_reason: string | null
  duplicate_of: string | null
  pr_url: string | null
  created_at: string
  votes: number
  voted: boolean
  mine: boolean
  can_delete: boolean
}

export const STATUS_LABEL: Record<SuggestionStatus, string> = {
  open: '검토 중',
  planned: '반영 예정',
  design: '설계 예정',
  shipped: '반영됨',
  rejected: '기각',
}

export async function listSuggestions(target?: string | null): Promise<Suggestion[]> {
  const rows = await rpc<SuggestionRow[]>('suggestion_list', { p_target: target ?? null })
  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    handle: r.handle,
    body: r.body,
    status: r.status,
    publicReason: r.public_reason,
    duplicateOf: r.duplicate_of,
    prUrl: r.pr_url,
    createdAt: r.created_at,
    votes: r.votes,
    voted: r.voted,
    mine: r.mine,
    canDelete: r.can_delete,
  }))
}

export async function postSuggestion(target: string, body: string): Promise<string> {
  return rpc<string>('suggestion_post', { p_target: target, p_body: body })
}

export async function deleteSuggestion(id: string): Promise<void> {
  await rpc<null>('suggestion_delete', { p_id: id })
}

export async function voteSuggestion(id: string, on: boolean): Promise<number> {
  return rpc<number>('suggestion_vote', { p_id: id, p_on: on })
}

const SUGGEST_MESSAGES: Record<string, string> = {
  forbidden: '권한이 없어요',
  invalid_target: '없는 게임이에요',
  invalid_body: '제안은 5~500자로 적어 주세요',
  too_many: '제안은 하루 5개까지 올릴 수 있어요',
  not_found: '없는 제안이에요',
  not_deletable: '검토가 시작된 제안은 지울 수 없어요',
  not_triaged: '아직 분류되지 않은 제안이에요',
  not_editable: '지금은 바꿀 수 없어요',
  invalid_reason: '이유는 200자까지 적을 수 있어요',
}

export function suggestErrorMessage(code: string): string {
  return SUGGEST_MESSAGES[code] ?? errorMessage(code)
}
