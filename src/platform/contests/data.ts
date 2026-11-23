import { ApiError } from '../../lib/api.ts'
import { supabase } from '../../lib/supabase.ts'

// contests는 열 단위로만 읽을 수 있다 (invite_code 제외). select * 금지.
const BASE_COLS =
  'id, kind, title, created_by, visibility, starts_at, ends_at, cancelled_at, daily_key, created_at'
// 참가비(지갑 5단계). DB보다 Vercel이 먼저 배포돼 열이 없으면(42703) BASE_COLS로 다시 읽는다
const CONTEST_COLS = `${BASE_COLS}, entry_fee`

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
  /** 참가비(0 ~ 41,000). 옛 DB면 없음 = 0 */
  entry_fee?: number
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

type Res<T> = { data: T | null; error: { message?: string; code?: string } | null }

/** CONTEST_COLS로 읽고, 열이 없다는 오류(옛 DB)면 BASE_COLS로 한 번 더 */
async function withFeeCols<T>(f: (cols: string) => PromiseLike<Res<T>>): Promise<T | null> {
  let first: Res<T>
  try {
    first = await f(CONTEST_COLS)
  } catch {
    throw new ApiError('network', 0)
  }
  if (first.error?.code === '42703') return guard<T>(() => f(BASE_COLS))
  if (first.error) fail(first.error)
  return first.data
}

export async function getContest(id: string): Promise<ContestRow | null> {
  const data = await withFeeCols<ContestRow[]>((cols) =>
    supabase.from('contests').select(cols).eq('id', id).limit(1) as unknown as PromiseLike<Res<ContestRow[]>>,
  )
  return data?.[0] ?? null
}

/** 데일리를 뺀 대회. 종료 후 30일 안의 것까지. */
export async function listContests(nowMs: number): Promise<ContestRow[]> {
  const since = new Date(nowMs - 30 * 24 * 3_600_000).toISOString()
  const data = await withFeeCols<ContestRow[]>((cols) =>
    supabase.from('contests').select(cols).neq('kind', 'daily').gt('ends_at', since)
      .order('starts_at', { ascending: true }) as unknown as PromiseLike<Res<ContestRow[]>>,
  )
  return data ?? []
}

/** 대회별 참가자 수(참가비 대회의 "모인 돈" 표시용). 읽지 못하면 빈 Map */
export async function getEntryCounts(contestIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (contestIds.length === 0) return out
  try {
    const res = await supabase.from('contest_entries').select('contest_id, user_id, joined_at').in('contest_id', contestIds)
    if (res.error) return out
    for (const r of (res.data as { contest_id: string }[] | null) ?? []) out.set(r.contest_id, (out.get(r.contest_id) ?? 0) + 1)
  } catch {
    /* 표시는 덤이다 */
  }
  return out
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

/**
 * 대회 정산 시각(지갑 3단계). 정산 안 됐으면 null, 읽지 못하면(3단계 DB 전이라 열이 없음, 네트워크) undefined.
 * CONTEST_COLS에 넣지 않고 따로 읽어, Vercel이 DB보다 먼저 배포돼도 대회 화면이 깨지지 않게 한다.
 */
export async function getSettledAt(id: string): Promise<string | null | undefined> {
  try {
    const res = await supabase.from('contests').select('settled_at').eq('id', id).limit(1)
    if (res.error) return undefined
    const row = (res.data as { settled_at: string | null }[] | null)?.[0]
    return row ? row.settled_at : undefined
  } catch {
    return undefined
  }
}
