import { supabase, supabaseUrl, supabaseKey } from './supabase.ts'

export type PlayView = {
  item_id: string
  contest_id: string
  game_id: string
  options: Record<string, string>
  public_state: unknown
  finished: boolean
  score: number | null
  action_count: number
  ends_at: string
  server_now: number
  reveal?: unknown
}

export class ApiError extends Error {
  code: string
  status: number
  body?: unknown
  constructor(code: string, status: number, body?: unknown) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.body = body
  }
}

const MESSAGES: Record<string, string> = {
  handle_taken: '이미 쓰는 아이디예요',
  handle_invalid: '아이디는 영문 소문자, 숫자, _ 로 3~16자예요',
  handle_already_set: '아이디는 이미 정해졌어요',
  forbidden: '권한이 없어요',
  network: '연결이 불안정해요. 다시 시도해 주세요',
}

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? `문제가 생겼어요 (${code})`
}

const NETWORK_RE = /Failed to fetch|NetworkError|Load failed|fetch failed/i

function rpcError(e: { message: string; code?: string; status?: number }): ApiError {
  // supabase.rpc는 fetch 실패를 throw하지 않고 code 없는 error로 돌려준다.
  if (!e.code || e.status === 0 || NETWORK_RE.test(e.message)) return new ApiError('network', 0)
  if (e.code === 'P0001') return new ApiError(e.message, 400)
  if (e.code === '42501') return new ApiError('forbidden', 403)
  return new ApiError('unknown', 400)
}

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  let res: { data: unknown; error: { message: string; code?: string } | null }
  try {
    res = (await supabase.rpc(name, args)) as typeof res
  } catch {
    throw new ApiError('network', 0)
  }
  if (res.error) throw rpcError(res.error)
  return res.data as T
}

export async function play(body: Record<string, unknown>): Promise<PlayView> {
  let res: Response
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    res = await fetch(`${supabaseUrl}/functions/v1/play`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: supabaseKey,
        authorization: `Bearer ${token ?? supabaseKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError('network', 0)
  }
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) {
    const code = (json as { error?: string } | null)?.error ?? 'unknown'
    throw new ApiError(code, res.status, json)
  }
  return json as PlayView
}
