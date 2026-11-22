// Edge Function `world` 진입점: 실제 연결(SUPABASE_DB_URL), JWT 확인(supabase-js), CORS. 구조는 duel/index.ts와 같다.
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

/** JSON 사전 형태의 키 환경 변수(SUPABASE_PUBLISHABLE_KEYS)에서 default 또는 첫 값 */
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

function clientKey(): string {
  const k = Deno.env.get('SUPABASE_ANON_KEY') ?? firstKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'))
  if (!k) throw new Error('SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEYS is not set')
  return k
}

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

/** [0, 1) 난수. 서버 쪽 무작위라 crypto 기반으로 만든다 */
function rng(): number {
  const a = new Uint32Array(2)
  crypto.getRandomValues(a)
  return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const res = await handle(req, { sql, now: () => Date.now(), getUserId, rng })
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
})
