// world handler 통합 테스트 (Deno + 로컬 Postgres). `npm run fn:test`로 돌린다.
// TEST_DB_URL은 소유자(슈퍼유저) 연결 — Supabase의 서비스/소유자 연결처럼 RLS를 우회한다.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { handle, type WorldDeps } from './handler.ts'
import type { Manifest, WorldLogic, WorldModule } from '../../../src/games/types.ts'
import { logic as fishingLogic } from '../../../src/games/fishing/logic.ts'

/** 지금 낚시 로직 버전(v14 지갑 이전 뒤 세이브는 이 버전으로 저장된다) */
const FISHING_V = fishingLogic.version

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
// 지갑을 쓰는 가짜 월드 (설계 §6). 상태 n은 earn 누적(게임은 상한을 모른다)
type GS = { n: number; earned: number }
type GA =
  | { type: 'earn'; n: number }
  | { type: 'spend'; n: number }
  | { type: 'force'; n: number }
  | { type: 'frac' }
  | { type: 'bad' }
  | { type: 'inc' }
const wbase: WorldLogic<GS, GA, GS & { gold: number }> = {
  version: 1,
  wallet: true,
  init: () => ({ n: 0, earned: 0 }),
  migrate: (state) => ({ n: (state as GS).n ?? 0, earned: (state as GS).earned ?? 0 }),
  apply: (state, a, ctx) => {
    if (a.type === 'earn') return { state: { ...state, earned: state.earned + a.n }, gold: a.n }
    if (a.type === 'spend') {
      if ((ctx.gold ?? 0) < a.n) return { error: 'not_enough_gold' }
      return { state: { ...state, n: state.n + 1 }, gold: -a.n }
    }
    if (a.type === 'force') return { state: { ...state, n: state.n + 1 }, gold: a.n }
    if (a.type === 'frac') return { state: { ...state, n: state.n + 1 }, gold: 1.5 }
    if (a.type === 'inc') return { state: { ...state, n: state.n + 1 } }
    return { error: 'nope' }
  },
  view: (state, ctx) => ({ ...state, gold: ctx.gold ?? -1 }),
  records: () => [],
}
// 버전 2: v1 세이브에 들어 있던 gold를 지갑으로 옮긴다
const wv2: WorldLogic<GS, GA, GS & { gold: number }> = {
  ...wbase,
  version: 2,
  migrate: (state) => ({ n: (state as GS).n ?? 0, earned: 0 }),
  legacyGold: (raw, from) => (from <= 1 ? ((raw as { gold?: number }).gold ?? 0) : 0),
}
// 지갑을 쓰지 않는데 gold를 돌려주는 게임(버그) → 500
const nogold: WorldLogic<S, A, S> = {
  ...base,
  apply: (state) => ({ state: { n: state.n + 1 }, gold: 5 }),
}
const worlds = new Map<string, WorldModule>([
  ['test-world', { manifest: manifest('test-world', false), logic: base }],
  ['test-wallet', { manifest: manifest('test-wallet', false), logic: wbase }],
  ['test-wallet-v2', { manifest: manifest('test-wallet-v2', false), logic: wv2 }],
  ['test-nogold', { manifest: manifest('test-nogold', false), logic: nogold }],
  ['test-world-v2', { manifest: manifest('test-world-v2', false), logic: v2 }],
  ['test-world-hidden', { manifest: manifest('test-world-hidden', true), logic: base }],
  ['test-world-avatar', { manifest: { ...manifest('test-world-avatar', false), avatar: { label: '캐릭터' } }, logic: { ...base, avatar: (state: S) => `look-${state.n}` } }],
  ['test-world-bonus', { manifest: manifest('test-world-bonus', false), logic: { ...base, freeBonus: (state: S) => state.n * 10 } }],
  ['test-world-badbonus', { manifest: manifest('test-world-badbonus', false), logic: { ...base, freeBonus: () => -1 } }],
  ['test-world-preview', { manifest: manifest('test-world-preview', false), logic: { ...base, previewData: (state: S) => ({ p1: `t-${state.n}`, p2: 'fixed' }) } }],
  ['test-world-avatar-fixed', { manifest: { ...manifest('test-world-avatar-fixed', false), avatar: { label: '캐릭터' } }, logic: { ...base, version: 2, avatar: () => 'same' } }],
  ['test-world-public', { manifest: manifest('test-world-public', false), logic: { ...v2, publicView: (state: { n: number }) => ({ shown: state.n }) } }],
  ['test-world-public-hidden', { manifest: manifest('test-world-public-hidden', true), logic: { ...base, publicView: (state: S) => ({ shown: state.n }) } }],
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

await sql`insert into public.hidden_games (game_id) values ('test-world-hidden'), ('test-world-public-hidden') on conflict do nothing`

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

t('save newer than the code → 409 version_newer, nothing is migrated down or written', async () => {
  const u = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version)
            values (${u}, 'test-world', ${sql.json({ n: 7, future: true })}, 2)`
  const l = await load(u)
  assert.equal(l.status, 409)
  assert.equal(l.body.error, 'version_newer')
  const a = await act(u, { type: 'inc' })
  assert.equal(a.status, 409)
  assert.equal(a.body.error, 'version_newer')
  const [row] = await save(u)
  assert.equal(row.logic_version, 2)
  assert.deepEqual(row.state, { n: 7, future: true })
  assert.equal((await sql`select 1 from public.game_records where user_id = ${u}`).length, 0)
})

t('real fishing: a save newer than this code is refused, gold and save untouched', async () => {
  const u = await user('approved', true)
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version)
            values (${u}, 'fishing', ${sql.json({ totalEarned: 5, gold: 999 })}, ${FISHING_V + 1})`
  const r = await realCall(u, { game: 'fishing', action: 'load' })
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'version_newer')
  assert.equal((await save(u, 'fishing'))[0].logic_version, FISHING_V + 1)
  assert.equal(await balance(u), 0)
  assert.equal((await ledger(u)).length, 0)
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
  // 낚시는 지갑을 쓴다(logic.version 14): 최상위 gold = view.gold = 지갑 잔액, 장부에 world 줄, 세이브에 gold 없음
  assert.equal(sold.body.gold, gold)
  assert.equal(await balance(admin), gold)
  const earned = (sold.body.result as { earned: number }).earned
  assert.equal(earned, gold) // 첫 판매는 사이트 하루 상한 아래
  const led = await ledger(admin)
  assert.deepEqual(led.map((l) => [l.reason, Number(l.delta), l.game_id]), [['world', gold, 'fishing']])
  const [sv] = await save(admin, game)
  assert.equal(sv.logic_version, FISHING_V)
  assert.equal('gold' in (sv.state as Record<string, unknown>), false)
  assert.ok(gold < 800)
  const bag = await real({ game, action: 'act', payload: { type: 'buyBag', tier: 2, price: 800 } })
  assert.equal(bag.status, 400)
  assert.equal(bag.body.error, 'not_enough_gold')
  // 순간이동: 과제를 깨지 않았으니 꺼져 있다(맵·요금 모듈이 함께 번들되는지도 확인)
  const tp = await real({ game, action: 'act', payload: { type: 'teleport', from: 'village', to: 'river' } })
  assert.equal(tp.status, 400)
  assert.equal(tp.body.error, 'not_open')
  const rows = await sql`select key from public.game_records where user_id = ${admin} and game_id = ${game} order by key`
  assert.deepEqual(rows.map((r) => r.key), ['areas', 'avatar', 'biggest', 'challenges', 'dex', 'free_bonus', 'total_earned'])
})

// ---------------------------------------------------------------- 자유 플레이 골드 보너스 (지갑 설계 §7.5)
async function bonusRow(uid: string, game: string): Promise<number | null> {
  const [r] = await sql`select value::text as v from public.game_records where user_id = ${uid} and game_id = ${game} and key = 'free_bonus'`
  return r ? Number(r.v) : null
}

t('freeBonus: first load writes the row (0), acts update it only when it changes, load heals a wrong value', async () => {
  const u = await user()
  const g = 'test-world-bonus'
  assert.equal((await load(u, g)).status, 200)
  assert.equal(await bonusRow(u, g), 0)
  await act(u, { type: 'inc' }, g)
  assert.equal(await bonusRow(u, g), 10)
  const [before] = await sql`select updated_at from public.game_records where user_id = ${u} and game_id = ${g} and key = 'free_bonus'`
  await act(u, { type: 'echo' }, g) // 상태 그대로 → 쓰지 않는다
  const [after] = await sql`select updated_at from public.game_records where user_id = ${u} and game_id = ${g} and key = 'free_bonus'`
  assert.deepEqual(after.updated_at, before.updated_at)
  await act(u, { type: 'inc' }, g)
  assert.equal(await bonusRow(u, g), 20)
  // 누가 값을 바꿔 놓아도(관리) 다음 요청이 세이브 기준으로 되돌린다
  await sql`update public.game_records set value = 999 where user_id = ${u} and game_id = ${g} and key = 'free_bonus'`
  await load(u, g)
  assert.equal(await bonusRow(u, g), 20)
  // freeBonus가 없는 게임은 행을 쓰지 않는다
  await act(u, { type: 'inc' })
  assert.equal(await bonusRow(u, 'test-world'), null)
})

t('freeBonus: negative value → 500, rolled back', async () => {
  const u = await user()
  const r = await act(u, { type: 'inc' }, 'test-world-badbonus')
  assert.equal(r.status, 500)
  assert.equal(await bonusRow(u, 'test-world-badbonus'), null)
  assert.equal((await save(u, 'test-world-badbonus')).length, 0)
})

// 실제 낚시 등록부로 v13 세이브의 골드 이전(지갑 계획 Task 4, Review Focus 1)
async function fishingV13(uid: string, gold: number | string | null) {
  const state = {
    gold, totalEarned: 50_000, rodTier: 3, bagTier: 2, areas: ['village', 'river', 'forest', 'lake'],
    bag: [{ species: 'anchovy', sizeCm: 12, perfect: false, locked: true }], dex: { anchovy: { count: 4, maxCm: 14 } },
    legends: [], tackles: ['cork'], equipped: ['cork'], challenges: {}, wardrobe: [], buffs: [], pending: null,
    outfit: { hat: 'none', top: 'basic', bottom: 'basic', hairColor: 'black', rodSkin: 'basic' },
  }
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version) values (${uid}, 'fishing', ${sql.json(state as never)}, 13)`
}
const realCall = async (uid: string, body: unknown): Promise<Res> => {
  const req = new Request('http://localhost/functions/v1/world', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${uid}` },
    body: JSON.stringify(body),
  })
  const res = await handle(req, { ...deps(), registry: undefined })
  return { status: res.status, body: await res.json() }
}

t('real fishing: v13 save gold moves to the wallet once on first load (floor), save becomes v14 without gold', async () => {
  const u = await user('approved', true)
  await fishingV13(u, 12345.7)
  const r = await realCall(u, { game: 'fishing', action: 'load' })
  assert.equal(r.status, 200)
  assert.equal(r.body.gold, 12345)
  assert.equal((r.body.view as { gold: number }).gold, 12345)
  assert.equal('gold_capped' in r.body, false)
  const [sv] = await save(u, 'fishing')
  assert.equal(sv.logic_version, FISHING_V)
  const st = sv.state as Record<string, unknown>
  assert.equal('gold' in st, false)
  assert.equal(st.totalEarned, 50_000)
  assert.equal(st.rodTier, 3)
  assert.deepEqual(st.tackles, ['cork'])
  // 다시 열어도 두 번 들어가지 않는다
  const again = await realCall(u, { game: 'fishing', action: 'load' })
  assert.equal(again.body.gold, 12345)
  const led = await ledger(u)
  assert.deepEqual(led.map((l) => [l.reason, Number(l.delta), l.ref, l.game_id]), [['migrate', 12345, 'fishing', 'fishing']])
  assert.equal(await balance(u), 12345)
  // 옮긴 골드로 바로 살 수 있다(카본 8,000 → 명장 40,000은 부족)
  const rod = await realCall(u, { game: 'fishing', action: 'act', payload: { type: 'buyRod', tier: 4, price: 40000 } })
  assert.equal(rod.status, 400)
  assert.equal(rod.body.error, 'not_enough_gold')
  const bag = await realCall(u, { game: 'fishing', action: 'act', payload: { type: 'buyBag', tier: 3, price: 5000 } })
  assert.equal(bag.status, 200)
  assert.equal(bag.body.gold, 12345 - 5000)
  assert.equal(await balance(u), 7345)
})

t('real fishing: completed challenges become the free-play bonus row on first load (cave 60 + pier 20)', async () => {
  const u = await user('approved', true)
  await fishingV13(u, 0)
  await sql`update public.world_saves set state = jsonb_set(state, '{challenges}',
    '{"pier-perfect": {"progress": 3, "done": true}, "cave-deep": {"progress": 5, "done": true}, "river-rain": {"progress": 2, "done": false}}'::jsonb)
    where user_id = ${u} and game_id = 'fishing'`
  assert.equal((await realCall(u, { game: 'fishing', action: 'load' })).status, 200)
  assert.equal(await bonusRow(u, 'fishing'), 80)
  const [p] = await sql`select public._free_bonus_pct(${u}::uuid) as p`
  assert.equal(Number(p.p), 80)
})

t('real fishing: concurrent first loads/acts of a v13 save move the gold exactly once', async () => {
  const u = await user('approved', true)
  await fishingV13(u, 900)
  const rs = await Promise.all([
    realCall(u, { game: 'fishing', action: 'load' }),
    realCall(u, { game: 'fishing', action: 'act', payload: { type: 'buyTackle', id: 'trap' } }),
    realCall(u, { game: 'fishing', action: 'load' }),
  ])
  for (const r of [rs[0], rs[2]]) {
    assert.equal(r.status, 200)
    assert.equal(r.body.gold, 900)
  }
  // 함정 찌(1,500)는 900으로 못 산다
  assert.equal(rs[1].status, 400)
  assert.equal(rs[1].body.error, 'not_enough_gold')
  assert.equal(await balance(u), 900)
  assert.equal((await ledger(u)).filter((l) => l.reason === 'migrate').length, 1)
})

t('real fishing: first request is a failing act → migration (gold + v14 save) still committed', async () => {
  const u = await user('approved', true)
  await fishingV13(u, 300)
  const r = await realCall(u, { game: 'fishing', action: 'act', payload: { type: 'unlockArea', area: 'cave', price: 15000 } })
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'not_enough_gold')
  assert.equal(await balance(u), 300)
  const [sv] = await save(u, 'fishing')
  assert.equal(sv.logic_version, FISHING_V)
  assert.equal('gold' in (sv.state as Record<string, unknown>), false)
  const again = await realCall(u, { game: 'fishing', action: 'load' })
  assert.equal(again.body.gold, 300)
  assert.equal((await ledger(u)).length, 1)
})

t('real fishing: v13 save with bad or zero gold moves nothing (no ledger row), still migrates', async () => {
  for (const g of [0, -5, 'lots', null]) {
    const u = await user('approved', true)
    await fishingV13(u, g)
    const r = await realCall(u, { game: 'fishing', action: 'load' })
    assert.equal(r.status, 200)
    assert.equal(r.body.gold, 0)
    assert.equal((await ledger(u)).length, 0)
    assert.equal((await save(u, 'fishing'))[0].logic_version, FISHING_V)
  }
})

// ---------------------------------------------------------------- wallet (지갑 1단계 Task 3)
const W = 'test-wallet'
const W2 = 'test-wallet-v2'
async function balance(uid: string): Promise<number> {
  const [r] = await sql`select balance::text as b from public.wallets where user_id = ${uid}`
  return r ? Number(r.b) : 0
}
async function ledger(uid: string) {
  return await sql<{ delta: string; raw_delta: string | null; reason: string; ref: string; game_id: string | null }[]>`
    select delta::text, raw_delta::text, reason, ref, game_id from public.gold_ledger where user_id = ${uid} order by id`
}

t('non-wallet game: no wallet row, no top-level gold (behaves as before)', async () => {
  const u = await user()
  const r = await act(u, { type: 'inc' })
  assert.equal(r.status, 200)
  assert.equal('gold' in r.body, false)
  assert.equal('gold' in (await load(u)).body, false)
  assert.equal((await sql`select 1 from public.wallets where user_id = ${u}`).length, 0)
})

t('non-wallet game returning gold → 500, rolled back', async () => {
  const u = await user()
  const r = await act(u, { type: 'inc' }, 'test-nogold')
  assert.equal(r.status, 500)
  assert.equal((await save(u, 'test-nogold')).length, 0)
  assert.equal(await balance(u), 0)
})

t('wallet load (first): gold 0, view gets ctx.gold 0', async () => {
  const u = await user()
  const r = await load(u, W)
  assert.equal(r.status, 200)
  assert.equal(r.body.gold, 0)
  assert.equal((r.body.view as { gold: number }).gold, 0)
  assert.equal('gold_capped' in r.body, false)
})

t('wallet earn: ledger world row with uuid ref, twice both count', async () => {
  const u = await user()
  const r = await act(u, { type: 'earn', n: 30 }, W)
  assert.equal(r.status, 200)
  assert.equal(r.body.gold, 30)
  assert.equal((r.body.view as { gold: number }).gold, 30)
  assert.equal(await balance(u), 30)
  const rows = await ledger(u)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].reason, 'world')
  assert.equal(rows[0].game_id, W)
  assert.match(rows[0].ref, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal((await act(u, { type: 'earn', n: 30 }, W)).body.gold, 60)
  assert.equal(await balance(u), 60)
  assert.equal((await load(u, W)).body.gold, 60)
})

t('wallet spend more than balance: game error 400, nothing changes', async () => {
  const u = await user()
  await act(u, { type: 'earn', n: 60 }, W)
  const r = await act(u, { type: 'spend', n: 100 }, W)
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'not_enough_gold')
  assert.equal(await balance(u), 60)
  assert.deepEqual((await save(u, W))[0].state, { n: 0, earned: 60 })
  const ok = await act(u, { type: 'spend', n: 40 }, W)
  assert.equal(ok.status, 200)
  assert.equal(ok.body.gold, 20)
})

t('wallet force −100 past balance: server guard 400 not_enough_gold, rolled back', async () => {
  const u = await user()
  await act(u, { type: 'earn', n: 60 }, W)
  const r = await act(u, { type: 'force', n: -100 }, W)
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'not_enough_gold')
  assert.equal(await balance(u), 60)
  assert.deepEqual((await save(u, W))[0].state, { n: 0, earned: 60 })
  assert.equal((await ledger(u)).length, 1)
})

t('wallet fractional gold → 500, rolled back', async () => {
  const u = await user()
  await act(u, { type: 'earn', n: 10 }, W)
  const r = await act(u, { type: 'frac' }, W)
  assert.equal(r.status, 500)
  assert.equal(await balance(u), 10)
  assert.deepEqual((await save(u, W))[0].state, { n: 0, earned: 10 })
})

t('wallet migrate: v1 save gold moves once, save drops gold', async () => {
  const u = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version)
            values (${u}, ${W2}, ${sql.json({ n: 3, gold: 50 })}, 1)`
  const r = await load(u, W2)
  assert.equal(r.status, 200)
  assert.equal(r.body.gold, 50)
  assert.equal((r.body.view as { gold: number }).gold, 50)
  const rows = await ledger(u)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].reason, 'migrate')
  assert.equal(rows[0].ref, W2)
  assert.equal(rows[0].game_id, W2)
  const s = await save(u, W2)
  assert.equal(s[0].logic_version, 2)
  assert.deepEqual(s[0].state, { n: 3, earned: 0 })
  assert.equal((await load(u, W2)).body.gold, 50)
  assert.equal((await ledger(u)).length, 1)
})

t('wallet migrate + apply error: migration still committed', async () => {
  const u = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version)
            values (${u}, ${W2}, ${sql.json({ n: 1, gold: 50 })}, 1)`
  const r = await act(u, { type: 'bad' }, W2)
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'nope')
  assert.equal(await balance(u), 50)
  assert.equal((await ledger(u)).filter((l) => l.reason === 'migrate').length, 1)
  const s = await save(u, W2)
  assert.equal(s[0].logic_version, 2)
  assert.deepEqual(s[0].state, { n: 1, earned: 0 })
})

t('wallet migrate: concurrent loads move once', async () => {
  const u = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version)
            values (${u}, ${W2}, ${sql.json({ n: 1, gold: 50 })}, 1)`
  const rs = await Promise.all([load(u, W2), load(u, W2)])
  assert.ok(rs.every((r) => r.status === 200 && r.body.gold === 50))
  assert.equal(await balance(u), 50)
  assert.equal((await ledger(u)).length, 1)
})

t('wallet migrate: legacyGold 0 writes no ledger row', async () => {
  const u = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version)
            values (${u}, ${W2}, ${sql.json({ n: 1 })}, 1)`
  const r = await load(u, W2)
  assert.equal(r.body.gold, 0)
  assert.equal((await ledger(u)).length, 0)
  assert.equal((await save(u, W2))[0].logic_version, 2)
})

t('wallet concurrent earn 10 × 5 → 50', async () => {
  const u = await user()
  const rs = await Promise.all(Array.from({ length: 5 }, () => act(u, { type: 'earn', n: 10 }, W)))
  assert.ok(rs.every((r) => r.status === 200))
  assert.equal(await balance(u), 50)
  assert.deepEqual((await save(u, W))[0].state, { n: 0, earned: 50 })
})

// 2026-11-25부터 사이트 하루 상한은 free에만 걸린다(설계 2026-11-25-fishing-sell-decay-design.md): world 수입은 줄지 않는다
t('wallet world earnings are outside the site daily cap: no gold_capped, no raw_delta', async () => {
  const u = await user()
  const a = await act(u, { type: 'earn', n: 30000 }, W)
  assert.equal('gold_capped' in a.body, false)
  const b = await act(u, { type: 'earn', n: 20000 }, W)
  assert.equal(b.status, 200)
  assert.equal(b.body.gold, 50000)
  assert.equal('gold_capped' in b.body, false)
  const last = (await ledger(u)).at(-1)!
  assert.equal(last.delta, '20000')
  assert.equal(last.raw_delta, null)
  assert.deepEqual((await save(u, W))[0].state, { n: 0, earned: 50000 })
  const sp = await act(u, { type: 'spend', n: 500 }, W)
  assert.equal(sp.body.gold, 49500)
})

t('wallet migrate does not count toward the cap', async () => {
  const u = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version)
            values (${u}, ${W2}, ${sql.json({ n: 1, gold: 50000 })}, 1)`
  const r = await act(u, { type: 'earn', n: 100 }, W2)
  assert.equal(r.body.gold, 50100)
  assert.equal('gold_capped' in r.body, false)
})

t('wallet concurrent earn 20,000 × 2 → 40,000, ledger 2 rows', async () => {
  const u = await user()
  const rs = await Promise.all([act(u, { type: 'earn', n: 20000 }, W), act(u, { type: 'earn', n: 20000 }, W)])
  assert.ok(rs.every((r) => r.status === 200))
  assert.equal(await balance(u), 40000)
  assert.equal((await ledger(u)).length, 2)
})

// 서로 다른 지갑 게임은 세이브 행이 달라 세이브 잠금으로 줄 서지 않는다 → 지갑 잠금이 상한·음수를 지킨다
t('wallet concurrent earn across two wallet games → 40,000', async () => {
  const v = await user()
  await load(v, W2)
  const rs = await Promise.all([act(v, { type: 'earn', n: 20000 }, W), act(v, { type: 'earn', n: 20000 }, W2)])
  assert.ok(rs.every((r) => r.status === 200))
  assert.equal(await balance(v), 40000)
})

t('wallet concurrent force-spend across two wallet games: one 400, balance 20', async () => {
  const v = await user()
  await load(v, W2)
  await act(v, { type: 'earn', n: 100 }, W)
  const rs = await Promise.all([act(v, { type: 'force', n: -80 }, W), act(v, { type: 'force', n: -80 }, W2)])
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400])
  assert.equal(await balance(v), 20)
})



// ---------------------------------------------------------------- previewData (메인 미리보기 설계 §6)
async function previewRows(uid: string, game: string) {
  return await sql<{ key: string; detail: string | null; at: Date }[]>`
    select key, detail, updated_at as at from public.game_records
     where user_id = ${uid} and game_id = ${game} and key in ('p1', 'p2') order by key`
}

t('previewData: rows written on the first load (new save)', async () => {
  const u = await user()
  await load(u, 'test-world-preview')
  const rows = await previewRows(u, 'test-world-preview')
  assert.deepEqual(rows.map((r) => [r.key, r.detail]), [['p1', 't-0'], ['p2', 'fixed']])
})

t('previewData: an act that changes a value updates only that row', async () => {
  const u = await user()
  await load(u, 'test-world-preview')
  await sql`update public.game_records set updated_at = '2000-01-01T00:00:00Z' where user_id = ${u} and game_id = 'test-world-preview'`
  await act(u, { type: 'inc' }, 'test-world-preview')
  const rows = await previewRows(u, 'test-world-preview')
  assert.deepEqual(rows.map((r) => r.detail), ['t-1', 'fixed'])
  assert.ok(rows[0].at.getTime() > Date.parse('2001-01-01'), 'p1 rewritten')
  assert.equal(rows[1].at.getTime(), Date.parse('2000-01-01T00:00:00Z'), 'p2 untouched')
})

t('previewData: a load fills rows for an existing save that has none (after deploy, no migrate)', async () => {
  const u = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version) values (${u}, 'test-world-preview', ${sql.json({ n: 4 })}, 1)`
  await load(u, 'test-world-preview')
  const rows = await previewRows(u, 'test-world-preview')
  assert.deepEqual(rows.map((r) => r.detail), ['t-4', 'fixed'])
})

t('previewData: a failed act leaves rows unchanged', async () => {
  const u = await user()
  await load(u, 'test-world-preview')
  await sql`update public.game_records set detail = 'kept' where user_id = ${u} and game_id = 'test-world-preview' and key = 'p1'`
  const r = await act(u, { type: 'bad' }, 'test-world-preview')
  assert.equal(r.status, 400)
  const rows = await previewRows(u, 'test-world-preview')
  assert.equal(rows[0].detail, 'kept')
})

t('previewData: no rows for a world without previewData()', async () => {
  const u = await user()
  await act(u, { type: 'inc' })
  const rows = await previewRows(u, 'test-world')
  assert.equal(rows.length, 0)
})

// ---------------------------------------------------------------- visit (내 섬 설계 §5.4)
const visit = (uid: string | null, owner: unknown, game = 'test-world-public') => call(uid, { game, action: 'visit', owner })

t('visit: 주인의 publicView만, 세이브는 migrate해도 쓰지 않는다', async () => {
  const me = await user()
  const owner = await user()
  await sql`update public.profiles set handle = ${`own${seq}`} where id = ${owner}`
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version) values (${owner}, 'test-world-public', ${sql.json({ n: 7 })}, 1)`
  const before = (await sql`select updated_at from public.world_saves where user_id = ${owner} and game_id = 'test-world-public'`)[0].updated_at
  const r = await visit(me, owner)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { owner: { id: owner, handle: `own${seq}` }, view: { shown: 7 } })
  const after = await sql`select state, logic_version, updated_at from public.world_saves where user_id = ${owner} and game_id = 'test-world-public'`
  assert.equal(after[0].logic_version, 1)
  assert.deepEqual(after[0].state, { n: 7 })
  assert.equal(String(after[0].updated_at), String(before))
  assert.equal((await save(me, 'test-world-public')).length, 0)
})

t('visit 오류: bad_owner·self·no_owner(없음·대기)·no_save·no_public_view·version_newer·숨김 비관리자 404', async () => {
  const me = await user()
  const pending = await user('pending')
  const nosave = await user()
  assert.equal((await visit(me, 'x')).body.error, 'bad_owner')
  assert.equal((await visit(me, 3)).body.error, 'bad_owner')
  assert.equal((await visit(me, me)).body.error, 'self')
  assert.equal((await visit(me, '00000000-0000-0000-0000-00000000dead')).status, 404)
  assert.equal((await visit(me, pending)).body.error, 'no_owner')
  const r = await visit(me, nosave)
  assert.equal(r.status, 404)
  assert.equal(r.body.error, 'no_save')
  const plain = await user()
  await load(plain)
  assert.equal((await visit(me, plain, 'test-world')).body.error, 'no_public_view')
  const newer = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version) values (${newer}, 'test-world-public', ${sql.json({ n: 1 })}, 9)`
  assert.equal((await visit(me, newer)).status, 409)
  const hiddenOwner = await user()
  await sql`insert into public.world_saves (user_id, game_id, state, logic_version) values (${hiddenOwner}, 'test-world-public-hidden', ${sql.json({ n: 1 })}, 1)`
  assert.equal((await visit(me, hiddenOwner, 'test-world-public-hidden')).status, 404)
  const admin = await user('approved', true)
  assert.equal((await visit(admin, hiddenOwner, 'test-world-public-hidden')).status, 200)
})

t('teardown', async () => {
  await sql`delete from public.hidden_games where game_id in ('test-world-hidden', 'test-world-public-hidden')`
  await sql.end()
})
