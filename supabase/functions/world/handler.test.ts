// world handler 통합 테스트 (Deno + 로컬 Postgres). `npm run fn:test`로 돌린다.
// TEST_DB_URL은 소유자(슈퍼유저) 연결 — Supabase의 서비스/소유자 연결처럼 RLS를 우회한다.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { handle, type WorldDeps } from './handler.ts'
import type { Manifest, WorldLogic, WorldModule } from '../../../src/games/types.ts'

const url = Deno.env.get('TEST_DB_URL')
if (!url) throw new Error('TEST_DB_URL is required (npm run fn:test)')
const sql = postgres(url, { max: 20, onnotice: () => {} })

// ---------------------------------------------------------------- fake worlds
type S = { n: number }
type A = { type: 'inc' } | { type: 'bad' } | { type: 'boom' } | { type: 'echo' }
const base: WorldLogic<S, A, S> = {
  version: 1,
  init: () => ({ n: 0 }),
  migrate: (state) => ({ n: (state as S).n }),
  apply: (state, a, ctx) => {
    if (a.type === 'inc') return { state: { n: state.n + 1 } }
    if (a.type === 'echo') return { state, result: { now: ctx.now, r: ctx.rng() } }
    if (a.type === 'boom') throw new Error('boom')
    return { error: 'nope' }
  },
  view: (state) => state,
  records: (state) => [{ key: 'n', value: state.n }],
}
const manifest = (id: string, hidden: boolean): Manifest => ({
  id,
  name: '테스트 월드',
  description: '테스트용',
  hidden,
  modes: { daily: false, contest: false, free: false },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  category: 'world',
  records: [{ key: 'n', label: '횟수' }],
})
// 버전 2: state가 { n, bonus }
// deno-lint-ignore no-explicit-any
const v2: WorldLogic<any, A, any> = {
  ...base,
  version: 2,
  init: () => ({ n: 0, bonus: 0 }),
  migrate: (state) => ({ n: (state as S).n, bonus: 0 }),
  apply: (state, a) => (a.type === 'inc' ? { state: { ...state, n: state.n + 1 } } : { error: 'nope' }),
}
const worlds = new Map<string, WorldModule>([
  ['test-world', { manifest: manifest('test-world', false), logic: base }],
  ['test-world-v2', { manifest: manifest('test-world-v2', false), logic: v2 }],
  ['test-world-hidden', { manifest: manifest('test-world-hidden', true), logic: base }],
  ['test-world-avatar', { manifest: { ...manifest('test-world-avatar', false), avatar: { label: '캐릭터' } }, logic: { ...base, avatar: (state: S) => `look-${state.n}` } }],
  ['test-world-avatar-fixed', { manifest: { ...manifest('test-world-avatar-fixed', false), avatar: { label: '캐릭터' } }, logic: { ...base, version: 2, avatar: () => 'same' } }],
])
const registry = { getWorld: (id: string) => worlds.get(id) }

// ---------------------------------------------------------------- helpers
const NOW = Date.parse('2026-11-23T03:00:00Z')

function deps(): WorldDeps {
  return {
    sql,
    now: () => NOW,
    getUserId: (req) => {
      const h = req.headers.get('authorization') ?? ''
      return Promise.resolve(h.startsWith('Bearer ') ? h.slice(7) : null)
    },
    rng: () => 0.25,
    registry,
  }
}

type Res = { status: number; body: Record<string, unknown> }
async function call(uid: string | null, body: unknown): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (uid) headers.authorization = `Bearer ${uid}`
  const req = new Request('http://localhost/functions/v1/world', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await handle(req, deps())
  return { status: res.status, body: await res.json() }
}
const load = (uid: string | null, game = 'test-world') => call(uid, { game, action: 'load' })
const act = (uid: string | null, payload: unknown, game = 'test-world') =>
  call(uid, { game, action: 'act', payload })

let seq = 0
async function user(status: 'approved' | 'pending' = 'approved', admin = false): Promise<string> {
  const [u] = await sql`insert into auth.users (email) values (${`world${++seq}@world.test`}) returning id`
  await sql`update public.profiles set status = ${status}, is_admin = ${admin} where id = ${u.id}`
  return u.id as string
}

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })
}

async function save(uid: string, game = 'test-world') {
  const rows = await sql`select state, logic_version from public.world_saves where user_id = ${uid} and game_id = ${game}`
  return rows
}

await sql`insert into public.hidden_games (game_id) values ('test-world-hidden') on conflict do nothing`

// ---------------------------------------------------------------- tests
t('load creates a save with init state', async () => {
  const u = await user()
  const r = await load(u)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.view, { n: 0 })
  assert.equal(r.body.result, null)
  assert.equal(r.body.server_now, NOW)
  const rows = await save(u)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].logic_version, 1)
  assert.deepEqual(rows[0].state, { n: 0 })
})

t('act applies and persists', async () => {
  const u = await user()
  assert.equal((await act(u, { type: 'inc' })).status, 200)
  const r2 = await act(u, { type: 'inc' })
  assert.deepEqual(r2.body.view, { n: 2 })
  assert.deepEqual((await load(u)).body.view, { n: 2 })
})

t('act passes now and rng and returns result', async () => {
  const u = await user()
  const r = await act(u, { type: 'echo' })
  assert.deepEqual(r.body.result, { now: NOW, r: 0.25 })
})

t('act upserts records', async () => {
  const u = await user()
  await act(u, { type: 'inc' })
  await act(u, { type: 'inc' })
  const rows = await sql`select key, value from public.game_records where user_id = ${u} and game_id = 'test-world'`
  assert.equal(rows.length, 1)
  assert.equal(rows[0].key, 'n')
  assert.equal(Number(rows[0].value), 2)
})

t('avatar row: written when the save is created (first load) and when an act changes it', async () => {
  const u = await user()
  const detail = async (game: string) =>
    (await sql`select detail from public.game_records where user_id = ${u} and game_id = ${game} and key = 'avatar'`)[0]?.detail ?? null
  await load(u, 'test-world-avatar')
  assert.equal(await detail('test-world-avatar'), 'look-0')
  // 기록(records)은 여전히 행동 뒤에만
  const recs = await sql`select key from public.game_records where user_id = ${u} and game_id = 'test-world-avatar' and key <> 'avatar'`
  assert.equal(recs.length, 0)
  await act(u, { type: 'inc' }, 'test-world-avatar')
  await act(u, { type: 'inc' }, 'test-world-avatar')
  const rows = await sql`select key, value, detail from public.game_records where user_id = ${u} and game_id = 'test-world-avatar' order by key`
  assert.deepEqual(rows.map((r) => [r.key, Number(r.value), r.detail]), [['avatar', 0, 'look-2'], ['n', 2, null]])
})

t('avatar row: not rewritten when an act leaves the avatar string unchanged', async () => {
  const u = await user()
  await load(u, 'test-world-avatar-fixed')
  await sql`update public.game_records set detail = 'tampered' where user_id = ${u} and game_id = 'test-world-avatar-fixed' and key = 'avatar'`
  await act(u, { type: 'inc' }, 'test-world-avatar-fixed')
  const [r] = await sql`select detail from public.game_records where user_id = ${u} and game_id = 'test-world-avatar-fixed' and key = 'avatar'`
  assert.equal(r.detail, 'tampered')
})

t('avatar row: written on the first load after a migrate (profiles fill right after deploy)', async () => {
  const u = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version) values (${u}, 'test-world-avatar-fixed', ${sql.json({ n: 5 })}, 1)`
  await load(u, 'test-world-avatar-fixed')
  const [r] = await sql`select detail from public.game_records where user_id = ${u} and game_id = 'test-world-avatar-fixed' and key = 'avatar'`
  assert.equal(r.detail, 'same')
  // 그다음 load(migrate 없음)는 다시 쓰지 않는다
  await sql`update public.game_records set detail = 'kept' where user_id = ${u} and game_id = 'test-world-avatar-fixed' and key = 'avatar'`
  await load(u, 'test-world-avatar-fixed')
  const [r2] = await sql`select detail from public.game_records where user_id = ${u} and game_id = 'test-world-avatar-fixed' and key = 'avatar'`
  assert.equal(r2.detail, 'kept')
})

t('no avatar record for a world without avatar()', async () => {
  const u = await user()
  await act(u, { type: 'inc' })
  const rows = await sql`select key from public.game_records where user_id = ${u} and game_id = 'test-world' and key = 'avatar'`
  assert.equal(rows.length, 0)
})

t('logic error changes nothing', async () => {
  const u = await user()
  await act(u, { type: 'inc' })
  const r = await act(u, { type: 'bad' })
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'nope')
  assert.deepEqual((await save(u))[0].state, { n: 1 })
})

t('throwing logic returns 500 and rolls back', async () => {
  const u = await user()
  await act(u, { type: 'inc' })
  const r = await act(u, { type: 'boom' })
  assert.equal(r.status, 500)
  assert.equal(r.body.error, 'internal')
  assert.deepEqual((await save(u))[0].state, { n: 1 })
})

t('throwing logic on first request leaves no save', async () => {
  const u = await user()
  assert.equal((await act(u, { type: 'boom' })).status, 500)
  assert.equal((await save(u)).length, 0)
})

t('version bump migrates on load', async () => {
  const u = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version)
            values (${u}, 'test-world-v2', ${sql.json({ n: 3 })}, 1)`
  const r = await load(u, 'test-world-v2')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.view, { n: 3, bonus: 0 })
  const rows = await save(u, 'test-world-v2')
  assert.equal(rows[0].logic_version, 2)
  assert.deepEqual(rows[0].state, { n: 3, bonus: 0 })
})

t('concurrent acts do not lose updates', async () => {
  const u = await user()
  const rs = await Promise.all(Array.from({ length: 10 }, () => act(u, { type: 'inc' })))
  assert.ok(rs.every((r) => r.status === 200))
  assert.deepEqual((await load(u)).body.view, { n: 10 })
  assert.equal((await save(u)).length, 1)
})

t('saves are per user', async () => {
  const a = await user()
  const b = await user()
  await act(a, { type: 'inc' })
  assert.deepEqual((await load(b)).body.view, { n: 0 })
})

t('unauthorized 401', async () => {
  const r = await load(null)
  assert.equal(r.status, 401)
  assert.equal(r.body.error, 'unauthorized')
})

t('not_approved 403', async () => {
  const u = await user('pending')
  const r = await load(u)
  assert.equal(r.status, 403)
  assert.equal(r.body.error, 'not_approved')
})

t('unknown_game 404', async () => {
  const u = await user()
  const r = await load(u, 'nope-game')
  assert.equal(r.status, 404)
  assert.equal(r.body.error, 'unknown_game')
})

t('hidden game: 404 for non-admin, ok for admin', async () => {
  const u = await user()
  const r = await load(u, 'test-world-hidden')
  assert.equal(r.status, 404)
  assert.equal(r.body.error, 'unknown_game')
  const admin = await user('approved', true)
  assert.equal((await load(admin, 'test-world-hidden')).status, 200)
})

t('oversized payload 400 invalid_action', async () => {
  const u = await user()
  const r = await act(u, { type: 'inc', pad: 'x'.repeat(3000) })
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'invalid_action')
  assert.equal(typeof r.body.message, 'string')
})

t('missing or unknown action 400 invalid_action', async () => {
  const u = await user()
  for (const body of [{ game: 'test-world' }, { game: 'test-world', action: 'zap' }, { action: 'load' }, 'not json', []]) {
    const r = await call(u, body)
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'invalid_action')
  }
})

t('real fishing registry: load, cast, resolve, sell writes game_records', async () => {
  const admin = await user('approved', true) // 숨김 게임이라 관리자만
  let now = NOW
  const real = async (body: unknown): Promise<Res> => {
    const d: WorldDeps = { ...deps(), now: () => now, registry: undefined }
    const req = new Request('http://localhost/functions/v1/world', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
      body: JSON.stringify(body),
    })
    const res = await handle(req, d)
    return { status: res.status, body: await res.json() }
  }
  const game = 'fishing'
  assert.equal((await real({ game, action: 'load' })).status, 200)
  const cast = await real({ game, action: 'act', payload: { type: 'cast', area: 'village', power: 0.5, spot: 'pier' } })
  assert.equal(cast.status, 200)
  const pending = cast.body.result as { biteDelayMs: number }
  now += pending.biteDelayMs
  const hook = await real({ game, action: 'act', payload: { type: 'hook' } })
  assert.equal(hook.status, 200)
  now += 2000
  const res = await real({ game, action: 'act', payload: { type: 'resolve', success: true, perfect: false } })
  assert.equal(res.status, 200)
  const sold = await real({ game, action: 'act', payload: { type: 'sell' } })
  assert.equal(sold.status, 200)
  const gold = (sold.body.view as { gold: number }).gold
  assert.ok(gold > 0)
  assert.ok(gold < 800)
  const bag = await real({ game, action: 'act', payload: { type: 'buyBag', tier: 2 } })
  assert.equal(bag.status, 400)
  assert.equal(bag.body.error, 'not_enough_gold')
  // 순간이동: 과제를 깨지 않았으니 꺼져 있다(맵·요금 모듈이 함께 번들되는지도 확인)
  const tp = await real({ game, action: 'act', payload: { type: 'teleport', from: 'village', to: 'river' } })
  assert.equal(tp.status, 400)
  assert.equal(tp.body.error, 'not_open')
  const rows = await sql`select key from public.game_records where user_id = ${admin} and game_id = ${game} order by key`
  assert.deepEqual(rows.map((r) => r.key), ['avatar', 'biggest', 'challenges', 'dex', 'total_earned'])
})

t('teardown', async () => {
  await sql`delete from public.hidden_games where game_id = 'test-world-hidden'`
  await sql.end()
})
