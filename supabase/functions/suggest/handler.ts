// 제안 워커용 핸들러: 새 제안 읽기(pending)와 분류·진행 결과 쓰기(triage·built·shipped).
// 소유자 연결로 직접 SQL을 쓰므로 RLS를 거치지 않는다. 호출자 확인은 x-worker-token 하나뿐이다.
import { timingSafeEqual } from 'node:crypto'
import type { Sql, Tx } from '../_shared/db.ts'
import { txOn } from '../_shared/db.ts'

export type Deps = { sql: Sql; token: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PR_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[0-9]+$/
const VERDICTS = new Set(['recommend', 'hold', 'reject', 'duplicate'])
const MAX_ITEMS = 100

type Skip = { id: string; reason: 'invalid' | 'not_open' }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
const badRequest = () => json(400, { error: 'bad_request' })

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
}

async function tokenOk(req: Request, token: string): Promise<boolean> {
  const given = req.headers.get('x-worker-token')
  if (given === null) return false
  return timingSafeEqual(await sha256(given), await sha256(token))
}

/** Postgres char_length처럼 코드포인트 수를 센다 */
const len = (s: string) => [...s].length

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ------------------------------------------------------------------ pending
async function pending(tx: Tx) {
  const to_triage = await tx`
    select s.id, s.target, s.body, p.handle::text as handle,
           (select count(*)::int from public.suggestion_votes v where v.suggestion_id = s.id) as votes,
           s.created_at
      from public.suggestions s
      left join public.profiles p on p.id = s.user_id
     where s.status = 'open' and s.deleted_at is null
       and not exists (select 1 from public.suggestion_triage t where t.suggestion_id = s.id)
     order by s.created_at asc, s.id asc
     limit ${MAX_ITEMS}`
  const context = await tx`
    select id, target, body, status
      from public.suggestions
     where deleted_at is null
     order by created_at desc, id desc
     limit 300`
  const to_build = await tx`
    select s.id, s.target, t.summary, t.note
      from public.suggestions s
      left join public.suggestion_triage t on t.suggestion_id = s.id
     where s.status = 'planned' and s.pr_url is null and s.deleted_at is null
     order by s.created_at asc, s.id asc`
  const to_check = await tx`
    select id, target, pr_url
      from public.suggestions
     where status = 'planned' and pr_url is not null and deleted_at is null
     order by created_at asc, id asc`
  return { to_triage, context, to_build, to_check }
}

// ------------------------------------------------------------------ triage
type TriageItem = {
  id: string
  verdict: string
  public_reason: string
  summary: string
  note: string | null
  duplicate_of: string | null
}

function parseTriageItem(raw: unknown): TriageItem | null {
  if (!isObj(raw)) return null
  const { id, verdict, public_reason, summary, note, duplicate_of } = raw
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null
  if (typeof verdict !== 'string' || !VERDICTS.has(verdict)) return null
  if (typeof public_reason !== 'string') return null
  const reason = public_reason.trim()
  if (len(reason) < 1 || len(reason) > 200) return null
  if (typeof summary !== 'string' || len(summary) < 1 || len(summary) > 1000) return null
  if (note !== undefined && note !== null && (typeof note !== 'string' || len(note) > 500)) return null
  let dup: string | null = null
  if (verdict === 'duplicate') {
    if (typeof duplicate_of !== 'string' || !UUID_RE.test(duplicate_of) || duplicate_of === id) return null
    dup = duplicate_of
  }
  return { id, verdict, public_reason: reason, summary, note: typeof note === 'string' ? note : null, duplicate_of: dup }
}

async function triage(tx: Tx, items: unknown[]) {
  const applied: string[] = []
  const skipped: Skip[] = []
  for (const raw of items) {
    const item = parseTriageItem(raw)
    if (!item) {
      skipped.push({ id: isObj(raw) && typeof raw.id === 'string' ? raw.id : '', reason: 'invalid' })
      continue
    }
    const [row] = await tx`
      select status, deleted_at,
             exists (select 1 from public.suggestion_triage t where t.suggestion_id = s.id) as triaged
        from public.suggestions s where s.id = ${item.id} for update`
    if (!row || row.deleted_at !== null || row.status !== 'open' || row.triaged) {
      skipped.push({ id: item.id, reason: 'not_open' })
      continue
    }
    if (item.duplicate_of) {
      const [orig] = await tx`select 1 as ok from public.suggestions
         where id = ${item.duplicate_of} and deleted_at is null`
      if (!orig) {
        skipped.push({ id: item.id, reason: 'invalid' })
        continue
      }
    }
    await tx`
      insert into public.suggestion_triage (suggestion_id, verdict, summary, note)
      values (${item.id}, ${item.verdict}::public.suggestion_verdict, ${item.summary}, ${item.note})`
    if (item.verdict === 'reject' || item.verdict === 'duplicate') {
      await tx`
        update public.suggestions
           set status = 'rejected', decided_at = now(), public_reason = ${item.public_reason},
               duplicate_of = ${item.duplicate_of}
         where id = ${item.id}`
    } else {
      await tx`update public.suggestions set public_reason = ${item.public_reason} where id = ${item.id}`
    }
    applied.push(item.id)
  }
  return { applied, skipped }
}

// ------------------------------------------------------------------ built / shipped
async function built(tx: Tx, ids: string[], prUrl: string) {
  const applied: string[] = []
  const skipped: Skip[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      skipped.push({ id: String(id), reason: 'not_open' })
      continue
    }
    const rows = await tx`
      update public.suggestions set pr_url = ${prUrl}
       where id = ${id} and status = 'planned' and pr_url is null and deleted_at is null
      returning id`
    if (rows.length) applied.push(id)
    else skipped.push({ id, reason: 'not_open' })
  }
  return { applied, skipped }
}

async function shipped(tx: Tx, ids: string[]) {
  const applied: string[] = []
  const skipped: Skip[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      skipped.push({ id: String(id), reason: 'not_open' })
      continue
    }
    const rows = await tx`
      update public.suggestions set status = 'shipped', shipped_at = now()
       where id = ${id} and status = 'planned' and pr_url is not null and deleted_at is null
      returning id`
    if (rows.length) applied.push(id)
    else skipped.push({ id, reason: 'not_open' })
  }
  return { applied, skipped }
}

// ------------------------------------------------------------------ handle
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!(await tokenOk(req, deps.token))) return json(401, { error: 'unauthorized' })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequest()
  }
  if (!isObj(body)) return badRequest()

  const run = txOn(deps.sql)
  switch (body.action) {
    case 'pending':
      return json(200, await run(pending))
    case 'triage': {
      const items = body.items
      if (!Array.isArray(items) || items.length > MAX_ITEMS) return badRequest()
      return json(200, await run((tx) => triage(tx, items)))
    }
    case 'built': {
      const { ids, pr_url } = body
      if (!Array.isArray(ids) || ids.length > MAX_ITEMS) return badRequest()
      if (typeof pr_url !== 'string' || !PR_URL_RE.test(pr_url)) return badRequest()
      return json(200, await run((tx) => built(tx, ids, pr_url)))
    }
    case 'shipped': {
      const { ids } = body
      if (!Array.isArray(ids) || ids.length > MAX_ITEMS) return badRequest()
      return json(200, await run((tx) => shipped(tx, ids)))
    }
    default:
      return badRequest()
  }
}
