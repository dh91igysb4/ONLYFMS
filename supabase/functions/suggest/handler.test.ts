// suggest 핸들러 통합 테스트 (Deno + 로컬 Postgres). `npm run fn:test`로 돌린다.
// TEST_DB_URL은 소유자(슈퍼유저) 연결 — Edge Function의 소유자 연결처럼 RLS를 우회한다.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { handle, type Deps } from './handler.ts'

const url = Deno.env.get('TEST_DB_URL')
if (!url) throw new Error('TEST_DB_URL is required (npm run fn:test)')
const sql = postgres(url, { max: 10, onnotice: () => {} })
const deps: Deps = { sql, token: 't0ken' }

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })
}

async function raw(init: RequestInit & { token?: string | null }): Promise<Response> {
  const { token = 't0ken', ...rest } = init
  const headers = new Headers(rest.headers)
  if (token !== null) headers.set('x-worker-token', token)
  return handle(new Request('http://x/suggest', { method: 'POST', ...rest, headers }), deps)
}
async function call(body: unknown) {
  const res = await raw({ body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

let seq = 0
async function user(handleName: string): Promise<string> {
  const [u] = await sql`insert into auth.users (email) values (${`sg-${++seq}-${handleName}@example.com`}) returning id`
  await sql`update public.profiles set status = 'approved', handle = ${handleName} where id = ${u.id}`
  return u.id as string
}

async function sug(
  uid: string,
  o: { target?: string; status?: string; pr_url?: string | null; deleted?: boolean; body?: string } = {},
): Promise<string> {
  const body = o.deleted ? null : (o.body ?? `제안 본문 ${++seq}`)
  const [r] = await sql`
    insert into public.suggestions (target, user_id, body, status, pr_url, deleted_at)
    values (${o.target ?? 'site'}, ${uid}, ${body}, ${o.status ?? 'open'}::public.suggestion_status,
            ${o.pr_url ?? null}, ${o.deleted ? sql`now()` : null})
    returning id`
  return r.id as string
}
const row = async (id: string) => (await sql`select * from public.suggestions where id = ${id}`)[0]
const triageRow = async (id: string) =>
  (await sql`select * from public.suggestion_triage where suggestion_id = ${id}`)[0]
const ok = (id: string, over: Record<string, unknown> = {}) => ({
  id, verdict: 'recommend', public_reason: '좋은 제안이에요', summary: '요약', ...over,
})
const PR = 'https://github.com/owner/repo/pull/12'

t('setup', async () => {
  await sql`insert into public.game_modes (game_id, daily, contest, free) values ('sg-game', true, true, true)
    on conflict do nothing`
})

// ---------------------------------------------------------------- http
t('no_token_401', async () => {
  const res = await raw({ token: null, body: JSON.stringify({ action: 'pending' }) })
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'unauthorized' })
})
t('wrong_token_401', async () => {
  const res = await raw({ token: 't0keN', body: JSON.stringify({ action: 'pending' }) })
  assert.equal(res.status, 401)
})
t('get_405', async () => {
  const res = await handle(new Request('http://x/suggest', { method: 'GET', headers: { 'x-worker-token': 't0ken' } }), deps)
  assert.equal(res.status, 405)
  assert.deepEqual(await res.json(), { error: 'method_not_allowed' })
})
t('bad_json_400', async () => {
  const res = await raw({ body: '{nope' })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'bad_request' })
  const arr = await call([1])
  assert.equal(arr.status, 400)
})
t('unknown_action_400', async () => {
  const r = await call({ action: 'nuke' })
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, { error: 'bad_request' })
})

// ---------------------------------------------------------------- pending
t('pending_lists_untriaged_open', async () => {
  await sql`delete from public.suggestions`
  const u = await user('sgpend')
  const voter = await user('sgvoter')
  const a = await sug(u, { target: 'sg-game' })
  const b = await sug(u)
  const gone = await sug(u, { deleted: true })
  await sql`insert into public.suggestion_votes (suggestion_id, user_id) values (${a}, ${voter})`
  const r = await call({ action: 'pending' })
  assert.equal(r.status, 200)
  const ids = r.body.to_triage.map((x: { id: string }) => x.id)
  assert.deepEqual(ids.sort(), [a, b].sort())
  assert.ok(!ids.includes(gone))
  const ra = r.body.to_triage.find((x: { id: string }) => x.id === a)
  assert.equal(ra.handle, 'sgpend')
  assert.equal(ra.votes, 1)
  assert.equal(ra.target, 'sg-game')
  assert.equal(r.body.to_triage.find((x: { id: string }) => x.id === b).votes, 0)
  assert.equal(r.body.context.length, 2)
})

t('pending_build_and_check', async () => {
  await sql`delete from public.suggestions`
  const u = await user('sgbuild')
  const build = await sug(u, { status: 'planned' })
  await sql`insert into public.suggestion_triage (suggestion_id, verdict, summary, note)
            values (${build}, 'recommend', '빌드 요약', '메모')`
  const check = await sug(u, { status: 'planned', pr_url: PR })
  const r = await call({ action: 'pending' })
  assert.equal(r.body.to_build.length, 1)
  assert.equal(r.body.to_build[0].id, build)
  assert.equal(r.body.to_build[0].summary, '빌드 요약')
  assert.equal(r.body.to_build[0].note, '메모')
  assert.deepEqual(r.body.to_check, [{ id: check, target: 'site', pr_url: PR }])
})

// ---------------------------------------------------------------- triage
t('triage_applies_and_rejects', async () => {
  await sql`delete from public.suggestions`
  const u = await user('sgtri')
  const rec = await sug(u)
  const rej = await sug(u)
  const r = await call({ action: 'triage', items: [
    ok(rec, { note: '메모' }),
    ok(rej, { verdict: 'reject', public_reason: '범위 밖이에요' }),
  ] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.applied.length, 2)
  assert.deepEqual(r.body.skipped, [])
  const a = await row(rec)
  assert.equal(a.status, 'open')
  assert.equal(a.public_reason, '좋은 제안이에요')
  assert.equal((await triageRow(rec)).note, '메모')
  const b = await row(rej)
  assert.equal(b.status, 'rejected')
  assert.ok(b.decided_at)
  const p = await call({ action: 'pending' })
  assert.deepEqual(p.body.to_triage, [])
})

t('triage_twice_skips_and_keeps_first', async () => {
  const u = await user('sgtwice')
  const id = await sug(u)
  await call({ action: 'triage', items: [ok(id, { summary: '처음' })] })
  const r = await call({ action: 'triage', items: [ok(id, { summary: '두번째' })] })
  assert.equal(r.body.skipped[0].reason, 'not_open')
  assert.deepEqual(r.body.applied, [])
  assert.equal((await triageRow(id)).summary, '처음')
})

t('triage_deleted_skips', async () => {
  const u = await user('sgdel')
  const id = await sug(u)
  await sql`update public.suggestions set deleted_at = now(), body = null where id = ${id}`
  const r = await call({ action: 'triage', items: [ok(id)] })
  assert.equal(r.body.skipped[0].reason, 'not_open')
  assert.equal(await triageRow(id), undefined)
})

t('triage_invalid_items', async () => {
  const u = await user('sginv')
  const good = await sug(u)
  const bad = await sug(u)
  const r = await call({ action: 'triage', items: [
    ok(bad, { verdict: 'maybe' }),
    ok(bad, { public_reason: '   ' }),
    ok(bad, { summary: 'x'.repeat(1001) }),
    ok(bad, { verdict: 'duplicate' }),
    ok(bad, { verdict: 'duplicate', duplicate_of: bad }),
    ok(good),
  ] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.skipped.length, 5)
  assert.ok(r.body.skipped.every((s: { reason: string }) => s.reason === 'invalid'))
  assert.deepEqual(r.body.applied, [good])
  assert.equal(await triageRow(bad), undefined)
})

t('triage_duplicate_sets_link', async () => {
  const u = await user('sgdup')
  const orig = await sug(u)
  const dup = await sug(u)
  const r = await call({ action: 'triage', items: [ok(dup, { verdict: 'duplicate', duplicate_of: orig })] })
  assert.deepEqual(r.body.applied, [dup])
  const d = await row(dup)
  assert.equal(d.duplicate_of, orig)
  assert.equal(d.status, 'rejected')
  assert.ok(d.decided_at)
})

t('triage_over_100_400', async () => {
  const items = Array.from({ length: 101 }, () => ok('00000000-0000-0000-0000-000000000000'))
  const r = await call({ action: 'triage', items })
  assert.equal(r.status, 400)
  const r2 = await call({ action: 'triage', items: 'x' })
  assert.equal(r2.status, 400)
})

// ---------------------------------------------------------------- built / shipped
t('built_only_planned', async () => {
  const u = await user('sgbuilt')
  const planned = await sug(u, { status: 'planned' })
  const open = await sug(u)
  const r = await call({ action: 'built', ids: [planned, open], pr_url: PR })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body.applied, [planned])
  assert.deepEqual(r.body.skipped, [{ id: open, reason: 'not_open' }])
  assert.equal((await row(planned)).pr_url, PR)
  assert.equal((await row(open)).pr_url, null)
})

t('built_bad_url_400', async () => {
  const u = await user('sgbad')
  const id = await sug(u, { status: 'planned' })
  for (const pr_url of ['javascript:alert(1)', 'https://evil.example/pull/1']) {
    const r = await call({ action: 'built', ids: [id], pr_url })
    assert.equal(r.status, 400)
  }
  assert.equal((await row(id)).pr_url, null)
})

t('shipped_only_built', async () => {
  const u = await user('sgship')
  const withPr = await sug(u, { status: 'planned', pr_url: PR })
  const noPr = await sug(u, { status: 'planned' })
  const r = await call({ action: 'shipped', ids: [withPr, noPr] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body.applied, [withPr])
  assert.deepEqual(r.body.skipped, [{ id: noPr, reason: 'not_open' }])
  const s = await row(withPr)
  assert.equal(s.status, 'shipped')
  assert.ok(s.shipped_at)
  assert.equal((await row(noPr)).status, 'planned')
})

t('teardown', async () => {
  await sql.end()
})
