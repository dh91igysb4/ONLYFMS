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
  handle_invalid: '아이디는 한글, 영문 소문자, 숫자, _ 로 2~16자예요',
  handle_already_set: '아이디는 이미 정해졌어요',
  forbidden: '권한이 없어요',
  not_started: '아직 시작 전이에요',
  ended: '이미 끝났어요',
  finished: '이미 끝낸 문제예요',
  stale: '다른 화면에서 진행된 내용으로 갱신했어요',
  version_changed: '규칙이 바뀌어 이 문제는 종료됐어요',
  timeout: '제한 시간이 끝났어요',
  not_joined: '참가한 대회가 아니에요',
  unknown_game: '없는 게임이에요',
  not_opened: '문제를 다시 열어 주세요',
  bank_empty: '출제할 문제가 없어요',
  unauthorized: '로그인이 필요해요',
  not_approved: '승인된 사용자만 할 수 있어요',
  network: '연결이 불안정해요. 다시 시도해 주세요',
  title_invalid: '제목은 1~40자로 적어 주세요',
  start_too_soon: '시작은 지금부터 5분 뒤 이후로 정해 주세요',
  start_too_far: '시작은 30일 안으로 정해 주세요',
  duration_invalid: '제한 시간은 5~180분이에요',
  items_invalid: '문제는 모두 합쳐 1~10개로 구성해 주세요',
  game_not_allowed: '대회에 쓸 수 없는 게임이 들어 있어요',
  official_forbidden: '공식 대회는 관리자만 만들 수 있어요',
  not_editable: '지금은 고치거나 취소할 수 없어요',
  invite_required: '초대 링크로만 참가할 수 있어요',
  user_not_found: '없는 사용자예요',
  invalid_status: '잘못된 상태예요',
  cannot_change_self: '자기 자신은 바꿀 수 없어요',
  contest_closed: '이미 끝났거나 취소된 대회예요',
  invalid_action: '할 수 없는 행동이에요',
}

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? `문제가 생겼어요 (${code})`
}

// ------------------------------------------------------------------ 승인 취소 알림 (설계 §11)
// 승인이 취소된 사용자의 요청은 거부된다. 그때 AuthProvider가 프로필을 다시 읽어 가드가 /welcome으로 보내게 한다.
// play는 403 not_approved를, SQL 함수는 승인 사용자가 아니면 forbidden을 돌려준다.
type DeniedListener = (code: string) => void
const deniedListeners = new Set<DeniedListener>()

export function onAccessDenied(fn: DeniedListener): () => void {
  deniedListeners.add(fn)
  return () => { deniedListeners.delete(fn) }
}

function notifyDenied(e: ApiError): ApiError {
  if (e.code === 'not_approved' || e.code === 'forbidden') {
    for (const fn of deniedListeners) {
      try { fn(e.code) } catch { /* 알림 실패는 원래 오류를 가리지 않는다 */ }
    }
  }
  return e
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
  if (res.error) throw notifyDenied(rpcError(res.error))
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
    throw notifyDenied(new ApiError(code, res.status, json))
  }
  return json as PlayView
}
