// Edge Function `play` 진입점: 실제 연결(SUPABASE_DB_URL), JWT 확인(supabase-js), PLAY_SECRET, CORS.
import { createClient } from '@supabase/supabase-js'
import { createSql } from './db.ts'
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

const sql = createSql(env('SUPABASE_DB_URL'))
const secret = env('PLAY_SECRET')
const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const res = await handle(req, { sql, now: () => Date.now(), getUserId, secret })
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
})
