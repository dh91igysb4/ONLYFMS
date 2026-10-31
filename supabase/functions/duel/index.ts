// Edge Function `duel` 진입점: 실제 연결(SUPABASE_DB_URL), JWT 확인(supabase-js), PLAY_SECRET, CORS,
// Realtime REST 브로드캐스트(대전 설계 §7.2). 구조는 play/index.ts와 같다.
import { createClient } from '@supabase/supabase-js'
import { createSql } from '../_shared/db.ts'
import { handle } from './handler.ts'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`${name} is not set`)
  return v
}

/** JSON 사전 형태의 키 환경 변수(SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS)에서 default 또는 첫 값 */
function firstKey(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const keys = JSON.parse(raw) as Record<string, string>
    return keys.default ?? Object.values(keys)[0] ?? null
  } catch {
    return null
  }
}

const SUPABASE_URL = env('SUPABASE_URL')
const sql = createSql(env('SUPABASE_DB_URL'))
const secret = env('PLAY_SECRET')

// 예전 anon 키가 꺼진 프로젝트에서는 SUPABASE_PUBLISHABLE_KEYS(JSON 사전)의 첫 키를 쓴다.
function clientKey(): string {
  const k = Deno.env.get('SUPABASE_ANON_KEY') ?? firstKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'))
  if (!k) throw new Error('SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEYS is not set')
  return k
}

// 브로드캐스트용 서버 키. 어느 키가 받아들여지는지는 배포 체크리스트에서 원격 확인한다.
const BROADCAST_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? firstKey(Deno.env.get('SUPABASE_SECRET_KEYS'))
if (!BROADCAST_KEY) console.error('duel: SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS not set; broadcast disabled')

const supabase = createClient(SUPABASE_URL, clientKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function getUserId(req: Request): Promise<string | null> {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m) return null
  const { data, error } = await supabase.auth.getUser(m[1])
  if (error || !data.user) return null
  return data.user.id
}

/** "바뀜" 신호만 보낸다(게임 상태 없음). 실패는 handler가 로그로 남기고 무시한다 */
async function broadcast(id: string, payload: { action_no: number; status: string }): Promise<void> {
  if (!BROADCAST_KEY) throw new Error('no broadcast key')
  const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      apikey: BROADCAST_KEY,
      authorization: `Bearer ${BROADCAST_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ messages: [{ topic: `duel:${id}`, event: 'update', payload }] }),
  })
  if (!res.ok) throw new Error(`broadcast ${res.status}: ${await res.text()}`)
  await res.body?.cancel()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const res = await handle(req, { sql, now: () => Date.now(), getUserId, secret, broadcast })
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
})
