// Edge Function `chat-bot` 진입점: 실제 연결(SUPABASE_DB_URL), JWT 확인(supabase-js), Anthropic 호출, CORS.
// 구조는 duel/index.ts와 같다. 시크릿: ANTHROPIC_API_KEY.
import { createClient } from '@supabase/supabase-js'
import { createSql } from '../_shared/db.ts'
import { type Completion, handle } from './handler.ts'

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

function clientKey(): string {
  const k = Deno.env.get('SUPABASE_ANON_KEY') ?? firstKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'))
  if (!k) throw new Error('SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEYS is not set')
  return k
}

const sql = createSql(env('SUPABASE_DB_URL'))
const anthropicKey = env('ANTHROPIC_API_KEY')
const supabase = createClient(env('SUPABASE_URL'), clientKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function getUserId(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!m) return null
  const { data, error } = await supabase.auth.getUser(m[1])
  if (error || !data.user) return null
  return data.user.id
}

async function complete(c: Completion): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: c.model,
      max_tokens: c.maxTokens,
      system: c.system,
      messages: [{ role: 'user', content: c.user }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json() as { content?: { type: string; text?: string }[] }
  return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const res = await handle(req, { sql, getUserId, complete })
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
})
