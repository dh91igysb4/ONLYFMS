import { ApiError } from '../../lib/api.ts'
import { supabase } from '../../lib/supabase.ts'

// contests는 열 단위로만 읽을 수 있다 (invite_code 제외). select * 금지.
const CONTEST_COLS =
  'id, kind, title, created_by, visibility, starts_at, ends_at, cancelled_at, daily_key, created_at'

export type ContestRow = {
  id: string
  kind: 'daily' | 'official' | 'friendly'
  title: string
  created_by: string | null
  visibility: 'public' | 'invite'
  starts_at: string
  ends_at: string
  cancelled_at: string | null
  daily_key: string | null
  created_at: string
}

export type ItemRow = {
  id: string
  contest_id: string
  position: number
  game_id: string
  options: Record<string, string>
  puzzle: unknown | null
  puzzle_key: string | null
  logic_version: number
  generated_at: string | null
}

function fail(e: { message?: string; code?: string }): never {
  if (e.code === '42501') throw new ApiError('forbidden', 403)
  throw new ApiError('network', 0)
}

async function guard<T>(f: () => PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>): Promise<T | null> {
  let res
  try {
    res = await f()
  } catch {
    throw new ApiError('network', 0)
  }
  if (res.error) fail(res.error)
  return res.data
}

export async function getContest(id: string): Promise<ContestRow | null> {
  const data = await guard<ContestRow[]>(() =>
    supabase.from('contests').select(CONTEST_COLS).eq('id', id).limit(1),
  )
  return data?.[0] ?? null
}

/** 데일리를 뺀 대회. 종료 후 30일 안의 것까지. */
export async function listContests(nowMs: number): Promise<ContestRow[]> {
  const since = new Date(nowMs - 30 * 24 * 3_600_000).toISOString()
  const data = await guard<ContestRow[]>(() =>
    supabase.from('contests').select(CONTEST_COLS).neq('kind', 'daily').gt('ends_at', since)
      .order('starts_at', { ascending: true }),
  )
  return data ?? []
}

export async function getItems(contestId: string): Promise<ItemRow[]> {
  const data = await guard<ItemRow[]>(() =>
    supabase.from('contest_items_public').select('*').eq('contest_id', contestId).order('position', { ascending: true }),
  )
  return data ?? []
}

/** 참가자 user id 목록 */
export async function getEntries(contestId: string): Promise<string[]> {
  const data = await guard<{ user_id: string }[]>(() =>
    supabase.from('contest_entries').select('contest_id, user_id, joined_at').eq('contest_id', contestId),
  )
  return (data ?? []).map((r) => r.user_id)
}

/** 내가 참가한 대회 id들 */
export async function getMyContestIds(userId: string): Promise<Set<string>> {
  const data = await guard<{ contest_id: string }[]>(() =>
    supabase.from('contest_entries').select('contest_id, user_id, joined_at').eq('user_id', userId),
  )
  return new Set((data ?? []).map((r) => r.contest_id))
}
