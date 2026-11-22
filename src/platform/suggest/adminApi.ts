import { rpc } from '../../lib/api.ts'
import type { SuggestionStatus } from './api.ts'

export type Verdict = 'recommend' | 'hold' | 'reject' | 'duplicate'

export type AdminSuggestion = {
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
  verdict: Verdict | null
  summary: string | null
  note: string | null
  triagedAt: string | null
}

type AdminSuggestionRow = {
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
  verdict: Verdict | null
  summary: string | null
  note: string | null
  triaged_at: string | null
}

export async function listAdminSuggestions(): Promise<AdminSuggestion[]> {
  const rows = await rpc<AdminSuggestionRow[]>('admin_suggestion_list')
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
    verdict: r.verdict,
    summary: r.summary,
    note: r.note,
    triagedAt: r.triaged_at,
  }))
}

export async function decideSuggestion(id: string, approve: boolean, reason?: string): Promise<SuggestionStatus> {
  return rpc<SuggestionStatus>('admin_suggestion_decide', { p_id: id, p_approve: approve, p_reason: reason?.trim() || null })
}

export async function markSuggestionShipped(id: string): Promise<void> {
  await rpc<null>('admin_suggestion_shipped', { p_id: id })
}

export async function suggestionPendingCount(): Promise<number> {
  return rpc<number>('admin_suggestion_pending_count')
}
