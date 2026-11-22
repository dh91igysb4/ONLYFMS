// Edge Function `suggest` 진입점: 예약 워커 전용. JWT·CORS 없이 x-worker-token만 확인한다(handler).
import { createSql } from '../_shared/db.ts'
import { handle } from './handler.ts'

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`${name} is not set`)
  return v
}

const sql = createSql(env('SUPABASE_DB_URL'))
const token = env('SUGGEST_WORKER_TOKEN')

Deno.serve((req) => handle(req, { sql, token }))
