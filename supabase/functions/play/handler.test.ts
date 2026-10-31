// handler 통합 테스트 (Deno + 로컬 Postgres, Ruling R4). `npm run fn:test`로 돌린다.
// TEST_DB_URL은 소유자(슈퍼유저) 연결 — Supabase의 서비스/소유자 연결처럼 RLS를 우회한다.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { handle, type Deps } from './handler.ts'
import type { GameLogic, GameModule } from '../../../src/games/types.ts'
import { getGame } from '../../../src/games/index.ts'
import { logic as ng } from '../../../src/games/number-guess/logic.ts'
import { manifest as ngManifest } from '../../../src/games/number-guess/manifest.ts'
import { PLAYERS } from '../../../src/games/who-are-ya/data.ts'

const url = Deno.env.get('TEST_DB_URL')
if (!url) throw new Error('TEST_DB_URL is required (npm run fn:test)')
const sql = postgres(url, { max: 20, onnotice: () => {} })

// ---------------------------------------------------------------- fake games
// fake-gen: number-guess와 같은 규칙, pickPuzzle 호출 수를 센다(키는 호출마다 달라 재시도가 없다)
let genCalls = 0
const fakeGen: GameModule = {
  manifest: { ...ngManifest, id: 'fake-gen', name: '가짜 생성', hidden: false },
  logic: {
    ...ng,
    pickPuzzle(rng, options) {
      genCalls++
      return { ...ng.pickPuzzle(rng, options), nonce: genCalls }
    },
    puzzleKey: (p: { nonce: number; answer: number }) => `${p.nonce}:${p.answer}`,
  } as GameLogic<unknown, unknown, unknown, unknown>,
}
// fake-bank: 은행 출제. 문제 { range, answer }
const fakeBank: GameModule = {
  manifest: { ...ngManifest, id: 'fake-bank', name: '가짜 은행', hidden: false, puzzleSource: 'bank' },
  logic: ng,
}
// fake-hidden: 숨김 게임
const fakeHidden: GameModule = {
  manifest: { ...ngManifest, id: 'fake-hidden', name: '가짜 숨김', hidden: true },
  logic: ng,
}
// fake-ver: 버전마다 score가 다른 게임. v1은 미완료 점수 3, v2는 7이고 v2는 옛 상태를 읽으면 던진다
const verManifest = { ...ngManifest, id: 'fake-ver', name: '가짜 버전', hidden: false }
const fakeVerV1: GameModule = {
  manifest: verManifest,
  logic: { ...ng, version: 1, score: () => 3 } as GameLogic<unknown, unknown, unknown, unknown>,
}
const boom = () => { throw new Error('v2 logic must not touch v1 state') }
const fakeVerV2: GameModule = {
  manifest: verManifest,
  logic: {
    ...ng, version: 2, score: () => 7, apply: boom, publicState: boom, isFinished: boom, actionCount: boom,
  } as GameLogic<unknown, unknown, unknown, unknown>,
}
// fake-timed: 데일리 제한 시간 10분인 숫자 맞히기
const fakeTimed: GameModule = {
  manifest: { ...ngManifest, id: 'fake-timed', name: '가짜 시간제한', hidden: false, dailyTimeLimitSec: 600 },
  logic: ng,
}
const extra = new Map([fakeGen, fakeBank, fakeHidden, fakeVerV1, fakeTimed].map((g) => [g.manifest.id, g]))
const registry = { getGame: (id: string) => extra.get(id) ?? getGame(id) }

// ---------------------------------------------------------------- helpers
const MIN = 60_000
const HOUR = 60 * MIN
const T0 = Date.parse('2026-11-10T03:00:00Z') // 2026-11-10 12:00 KST

function deps(now: number): Deps {
  return {
    sql,
    now: () => now,
    getUserId: (req) => {
      const h = req.headers.get('authorization') ?? ''
      return Promise.resolve(h.startsWith('Bearer ') ? h.slice(7) : null)
    },
    secret: 'test-secret',
    registry,
  }
}

type Res = { status: number; body: Record<string, unknown> }
async function call(uid: string | null, body: unknown, now: number): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (uid) headers.authorization = `Bearer ${uid}`
  const req = new Request('http://localhost/functions/v1/play', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await handle(req, deps(now))
  return { status: res.status, body: await res.json() }
}

let seq = 0
async function user(status: 'approved' | 'pending' = 'approved', admin = false): Promise<string> {
  const [u] = await sql`insert into auth.users (email) values (${`u${++seq}@t.test`}) returning id`
  await sql`update public.profiles set status = ${status}, is_admin = ${admin} where id = ${u.id}`
  return u.id as string
}

async function contest(opts: {
  starts: number
  ends: number
  games: string[]
  join?: string[]
}): Promise<{ id: string; items: string[] }> {
  const [c] = await sql`
    insert into public.contests (kind, title, visibility, starts_at, ends_at)
    values ('friendly', 'test', 'public', ${new Date(opts.starts)}, ${new Date(opts.ends)}) returning id`
  const items: string[] = []
  for (const [i, g] of opts.games.entries()) {
    const [it] = await sql`
      insert into public.contest_items (contest_id, position, game_id, options)
      values (${c.id}, ${i + 1}, ${g}, ${sql.json({ range: '100' })}) returning id`
    items.push(it.id as string)
  }
  for (const u of opts.join ?? []) {
    await sql`insert into public.contest_entries (contest_id, user_id) values (${c.id}, ${u})`
  }
  return { id: c.id as string, items }
}

async function answerOf(itemId: string): Promise<number> {
  const [r] = await sql`select puzzle from public.contest_items where id = ${itemId}`
  return (r.puzzle as { answer: number }).answer
}

/** 정답이 아닌 1~100 숫자 */
function miss(answer: number, k = 0): number {
  const c = ((answer + k) % 100) + 1
  return c === answer ? ((c % 100) + 1) : c
}

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })
}

// 테스트 DB 준비: 가짜 게임 모드, 숫자 맞히기는 숨김에서 뺀다(숨김 검사는 fake-hidden으로)
t('setup', async () => {
  await sql`insert into public.game_modes (game_id, daily, contest, free) values
    ('fake-gen', true, true, true), ('fake-bank', false, true, true), ('fake-hidden', true, true, true),
    ('fake-ver', true, true, true), ('fake-timed', true, true, true)
    on conflict do nothing`
  await sql`delete from public.hidden_games where game_id = 'number-guess'`
  await sql`insert into public.hidden_games (game_id) values ('fake-hidden') on conflict do nothing`
})

// ---------------------------------------------------------------- auth / errors
t('unauthenticated_401', async () => {
  const r = await call(null, { action: 'daily', game_id: 'number-guess' }, T0)
  assert.equal(r.status, 401)
  assert.equal(r.body.error, 'unauthorized')
})

t('pending_user_403', async () => {
  const u = await user('pending')
  const r = await call(u, { action: 'daily', game_id: 'number-guess' }, T0)
  assert.equal(r.status, 403)
  assert.equal(r.body.error, 'not_approved')
})

t('malformed_json_400', async () => {
  const u = await user()
  const r = await call(u, '{not json', T0)
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'invalid_action')
  const r2 = await call(u, { action: 'dance' }, T0)
  assert.equal(r2.status, 400)
  assert.equal(r2.body.error, 'invalid_action')
  const r3 = await call(u, { action: 'open', item_id: 'not-a-uuid' }, T0)
  assert.equal(r3.status, 400)
})

t('unknown_game_404', async () => {
  const u = await user()
  const r = await call(u, { action: 'daily', game_id: 'nope' }, T0)
  assert.equal(r.status, 404)
  assert.equal(r.body.error, 'unknown_game')
  // 데일리를 지원하지 않는 게임
  const r2 = await call(u, { action: 'daily', game_id: 'fake-bank' }, T0)
  assert.equal(r2.status, 404)
  // 등록부에 없는 게임의 문제
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['ghost-game'], join: [u] })
  const r3 = await call(u, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(r3.status, 404)
  assert.equal(r3.body.error, 'unknown_game')
})

t('hidden_game_forbidden_for_non_admin', async () => {
  const u = await user()
  const admin = await user('approved', true)
  const r = await call(u, { action: 'daily', game_id: 'fake-hidden' }, T0)
  assert.equal(r.status, 403)
  assert.equal(r.body.error, 'forbidden')
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['fake-hidden'], join: [u, admin] })
  const r2 = await call(u, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(r2.status, 403)
  assert.equal(r2.body.error, 'forbidden')
  const r3 = await call(admin, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(r3.status, 200)
})

t('not_joined_403', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'] })
  const r = await call(u, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(r.status, 403)
  assert.equal(r.body.error, 'not_joined')
  const [it] = await sql`select puzzle from public.contest_items where id = ${c.items[0]}`
  assert.equal(it.puzzle, null)
})

// ---------------------------------------------------------------- daily
t('daily_creates_once_concurrently', async () => {
  const users = await Promise.all([1, 2, 3, 4, 5].map(() => user()))
  const now = Date.parse('2026-11-01T20:00:00Z') // 2026-11-02 05:00 KST
  const rs = await Promise.all(users.map((u) => call(u, { action: 'daily', game_id: 'number-guess' }, now)))
  for (const r of rs) assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(new Set(rs.map((r) => r.body.contest_id)).size, 1)
  assert.equal(new Set(rs.map((r) => r.body.item_id)).size, 1)
  const [c] = await sql`select * from public.contests where daily_key = 'number-guess:2026-11-02'`
  assert.equal(c.id, rs[0].body.contest_id)
  assert.equal(c.kind, 'daily')
  assert.equal(c.visibility, 'public')
  assert.equal(c.title, '숫자 맞히기 · 2026-11-02')
  assert.equal((c.starts_at as Date).toISOString(), '2026-11-01T15:00:00.000Z')
  assert.equal((c.ends_at as Date).toISOString(), '2026-11-02T15:00:00.000Z')
  const items = await sql`select * from public.contest_items where contest_id = ${c.id as string}`
  assert.equal(items.length, 1)
  assert.equal(items[0].position, 1)
  assert.deepEqual(items[0].options, { range: '100' })
  assert.equal(items[0].puzzle, null) // 출제는 open 때
  const [{ n }] = await sql`select count(*)::int as n from public.contest_entries where contest_id = ${c.id as string}`
  assert.equal(n, 5)
})

// ---------------------------------------------------------------- open
t('open_generates_puzzle_once_concurrently', async () => {
  const users = await Promise.all([1, 2, 3, 4, 5].map(() => user()))
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['fake-gen'], join: users })
  const before = genCalls
  const rs = await Promise.all(users.map((u, i) => call(u, { action: 'open', item_id: c.items[0] }, T0 + i)))
  for (const r of rs) assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(genCalls - before, 1)
  const [it] = await sql`select * from public.contest_items where id = ${c.items[0]}`
  assert.ok(it.puzzle)
  assert.equal(it.logic_version, ng.version)
  assert.ok([0, 1, 2, 3, 4].some((i) => (it.generated_at as Date).getTime() === T0 + i))
  const [{ n }] = await sql`select count(*)::int as n from public.attempts where item_id = ${c.items[0]}`
  assert.equal(n, 5)
  // 정답·문제는 진행 중 응답에 없다
  for (const r of rs) {
    assert.equal(r.body.reveal, undefined)
    assert.ok(!JSON.stringify(r.body).includes('answer'))
    assert.ok(!JSON.stringify(r.body).includes('nonce'))
  }
  // 같은 사용자가 동시에 여러 번 열어도 기록은 하나
  const u = await user()
  await sql`insert into public.contest_entries (contest_id, user_id) values (${c.id}, ${u})`
  const rs2 = await Promise.all([0, 1, 2, 3, 4].map(() => call(u, { action: 'open', item_id: c.items[0] }, T0)))
  for (const r of rs2) assert.equal(r.status, 200)
  const [{ m }] = await sql`select count(*)::int as m from public.attempts where item_id = ${c.items[0]} and user_id = ${u}`
  assert.equal(m, 1)
})

t('open_seed_is_deterministic_from_secret', async () => {
  // 같은 대회id·위치·재시도 → 같은 문제 (HMAC 시드)
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  await call(u, { action: 'open', item_id: c.items[0] }, T0)
  const [it] = await sql`select puzzle, puzzle_key from public.contest_items where id = ${c.items[0]}`
  const { hmacSeed, rngFromSeed } = await import('../../../src/shared/rng.ts')
  let found = false
  for (let retry = 0; retry <= 20 && !found; retry++) {
    const p = ng.pickPuzzle(rngFromSeed(await hmacSeed('test-secret', `${c.id}:1:${retry}`)), { range: '100' })
    if (ng.puzzleKey(p) === it.puzzle_key) found = true
  }
  assert.ok(found)
})

t('open_before_start_is_409_not_started', async () => {
  const u = await user()
  const c = await contest({ starts: T0 + 10 * MIN, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  const r = await call(u, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'not_started')
  const [it] = await sql`select puzzle from public.contest_items where id = ${c.items[0]}`
  assert.equal(it.puzzle, null)
  const [{ n }] = await sql`select count(*)::int as n from public.attempts where item_id = ${c.items[0]}`
  assert.equal(n, 0)
})

t('open_cancelled_is_409_ended', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  await sql`update public.contests set cancelled_at = ${new Date(T0 - MIN)} where id = ${c.id}`
  const r = await call(u, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'ended')
})

// ---------------------------------------------------------------- act
t('act_flow_to_finish_then_409_finished', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  const o = await call(u, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(o.status, 200)
  assert.equal(o.body.action_count, 0)
  assert.equal(o.body.finished, false)
  assert.equal(o.body.score, 0)
  assert.equal(o.body.server_now, T0)
  assert.equal(o.body.ends_at, new Date(T0 + HOUR).toISOString())
  assert.equal(o.body.game_id, 'number-guess')
  assert.equal(o.body.contest_id, c.id)
  assert.deepEqual(o.body.options, { range: '100' })
  const ans = await answerOf(c.items[0])

  const a1 = await call(u, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'guess', value: miss(ans) } }, T0 + 1000)
  assert.equal(a1.status, 200, JSON.stringify(a1.body))
  assert.equal(a1.body.action_count, 1)
  assert.equal(a1.body.finished, false)
  assert.equal(a1.body.reveal, undefined)

  const bad = await call(u, { action: 'act', item_id: c.items[0], expected_count: 1, payload: { type: 'guess', value: 500 } }, T0 + 1500)
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error, 'invalid_action')
  assert.equal(bad.body.message, '1~100 사이로 입력해 주세요')

  const a2 = await call(u, { action: 'act', item_id: c.items[0], expected_count: 1, payload: { type: 'guess', value: ans } }, T0 + 2000)
  assert.equal(a2.status, 200)
  assert.equal(a2.body.finished, true)
  assert.equal(a2.body.score, 9)
  assert.equal(a2.body.action_count, 2)
  assert.deepEqual(a2.body.reveal, { answer: ans })

  const [at] = await sql`select * from public.attempts where item_id = ${c.items[0]} and user_id = ${u}`
  assert.equal(at.finished, true)
  assert.equal(Number(at.score), 9)
  assert.equal(at.action_count, 2)
  assert.equal((at.finished_at as Date).getTime(), T0 + 2000)
  assert.equal((at.last_action_at as Date).getTime(), T0 + 2000)

  const a3 = await call(u, { action: 'act', item_id: c.items[0], expected_count: 2, payload: { type: 'guess', value: miss(ans, 3) } }, T0 + 3000)
  assert.equal(a3.status, 409)
  assert.equal(a3.body.error, 'finished')
})

t('act_without_open_is_409_not_opened', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  const r = await call(u, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'give_up' } }, T0)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'not_opened')
})

t('duplicate_act_is_rejected_as_stale', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  await call(u, { action: 'open', item_id: c.items[0] }, T0)
  const ans = await answerOf(c.items[0])
  const body = { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'guess', value: miss(ans) } }
  const r1 = await call(u, body, T0 + 1000)
  assert.equal(r1.status, 200)
  const r2 = await call(u, body, T0 + 1100)
  assert.equal(r2.status, 409)
  assert.equal(r2.body.error, 'stale')
  const view = r2.body.view as Record<string, unknown>
  assert.equal(view.action_count, 1)
  assert.ok(!JSON.stringify(r2.body).includes('answer'))
  const [at] = await sql`select action_count from public.attempts where item_id = ${c.items[0]} and user_id = ${u}`
  assert.equal(at.action_count, 1)

  // 동시에 5번(더블 클릭·재시도) → 한 번만 반영
  const body2 = { ...body, expected_count: 1, payload: { type: 'guess', value: miss(ans, 7) } }
  const rs = await Promise.all([0, 1, 2, 3, 4].map((i) => call(u, body2, T0 + 2000 + i)))
  assert.equal(rs.filter((r) => r.status === 200).length, 1)
  assert.equal(rs.filter((r) => r.status === 409 && r.body.error === 'stale').length, 4)
  const [at2] = await sql`select action_count, state from public.attempts where item_id = ${c.items[0]} and user_id = ${u}`
  assert.equal(at2.action_count, 2)
  assert.equal((at2.state as { guesses: number[] }).guesses.length, 2)
})

t('act_after_daily_end_is_409', async () => {
  const u = await user()
  const noon = Date.parse('2026-11-05T03:00:00Z') // 2026-11-05 12:00 KST
  const d = await call(u, { action: 'daily', game_id: 'number-guess' }, noon)
  assert.equal(d.status, 200)
  const item = d.body.item_id as string
  const o = await call(u, { action: 'open', item_id: item }, noon)
  assert.equal(o.status, 200)
  const ans = await answerOf(item)
  const beforeMidnight = Date.parse('2026-11-05T14:59:59Z') // 23:59:59 KST
  const afterMidnight = Date.parse('2026-11-05T15:00:01Z') // 다음 날 00:00:01 KST
  const a1 = await call(u, { action: 'act', item_id: item, expected_count: 0, payload: { type: 'guess', value: miss(ans) } }, beforeMidnight)
  assert.equal(a1.status, 200, JSON.stringify(a1.body))
  const a2 = await call(u, { action: 'act', item_id: item, expected_count: 1, payload: { type: 'guess', value: ans } }, afterMidnight)
  assert.equal(a2.status, 409)
  assert.equal(a2.body.error, 'ended')
  const [at] = await sql`select action_count, finished from public.attempts where item_id = ${item} and user_id = ${u}`
  assert.equal(at.action_count, 1)
  assert.equal(at.finished, false)
  // 자정을 넘긴 daily는 새 날짜의 대회
  const d2 = await call(u, { action: 'daily', game_id: 'number-guess' }, afterMidnight)
  assert.notEqual(d2.body.contest_id, d.body.contest_id)
})

t('act_after_contest_end_is_409_ended', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  await call(u, { action: 'open', item_id: c.items[0] }, T0)
  const r = await call(u, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'give_up' } }, T0 + HOUR)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'ended')
  const r2 = await call(u, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'give_up' } }, T0 + 2 * HOUR)
  assert.equal(r2.status, 409)
  assert.equal(r2.body.error, 'ended')
  // 취소된 대회도 ended
  const c2 = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  await call(u, { action: 'open', item_id: c2.items[0] }, T0)
  await sql`update public.contests set cancelled_at = ${new Date(T0)} where id = ${c2.id}`
  const r3 = await call(u, { action: 'act', item_id: c2.items[0], expected_count: 0, payload: { type: 'give_up' } }, T0 + 1)
  assert.equal(r3.status, 409)
  assert.equal(r3.body.error, 'ended')
})

t('version_mismatch_finalizes_and_409', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  await call(u, { action: 'open', item_id: c.items[0] }, T0)
  const ans = await answerOf(c.items[0])
  await call(u, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'guess', value: miss(ans) } }, T0 + 1000)
  await sql`update public.attempts set logic_version = 0 where item_id = ${c.items[0]} and user_id = ${u}`
  const r = await call(u, { action: 'act', item_id: c.items[0], expected_count: 1, payload: { type: 'guess', value: ans } }, T0 + 2000)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'version_changed')
  const view = r.body.view as Record<string, unknown>
  assert.equal(view.finished, true)
  assert.equal(view.score, 0)
  const [at] = await sql`select * from public.attempts where item_id = ${c.items[0]} and user_id = ${u}`
  assert.equal(at.finished, true)
  assert.equal(Number(at.score), 0)
  assert.equal(at.action_count, 1)
  assert.equal((at.finished_at as Date).getTime(), T0 + 2000)
  const again = await call(u, { action: 'act', item_id: c.items[0], expected_count: 1, payload: { type: 'give_up' } }, T0 + 3000)
  assert.equal(again.status, 409)
  assert.equal(again.body.error, 'finished')
})

t('version_change_keeps_stored_score_and_hides_old_state', async () => {
  const u = await user()
  extra.set('fake-ver', fakeVerV1)
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['fake-ver'], join: [u] })
  const o = await call(u, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(o.status, 200)
  const ans = await answerOf(c.items[0])
  const a1 = await call(u, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'guess', value: miss(ans) } }, T0 + 1000)
  assert.equal(a1.status, 200)
  assert.equal(a1.body.score, 3)
  const [before] = await sql`select state from public.attempts where item_id = ${c.items[0]} and user_id = ${u}`
  try {
    extra.set('fake-ver', fakeVerV2) // 규칙 변경 배포
    const r = await call(u, { action: 'act', item_id: c.items[0], expected_count: 1, payload: { type: 'guess', value: ans } }, T0 + 2000)
    assert.equal(r.status, 409, JSON.stringify(r.body))
    assert.equal(r.body.error, 'version_changed')
    const view = r.body.view as Record<string, unknown>
    assert.equal(view.public_state, null)
    assert.equal(view.finished, true)
    assert.equal(view.score, 3)
    assert.deepEqual(view.reveal, { answer: ans })
    const [at] = await sql`select * from public.attempts where item_id = ${c.items[0]} and user_id = ${u}`
    assert.equal(Number(at.score), 3)
    assert.equal(at.finished, true)
    assert.equal((at.finished_at as Date).getTime(), T0 + 2000)
    assert.deepEqual(at.state, before.state)
    // 이후 open도 옛 상태를 새 로직에 넘기지 않는다
    const o2 = await call(u, { action: 'open', item_id: c.items[0] }, T0 + 3000)
    assert.equal(o2.status, 200, JSON.stringify(o2.body))
    assert.equal(o2.body.public_state, null)
    assert.equal(o2.body.score, 3)
  } finally {
    extra.set('fake-ver', fakeVerV1)
  }
})

t('reveal_only_when_finished_or_ended', async () => {
  const [a, b, never] = await Promise.all([user(), user(), user()])
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [a, b, never] })
  const oa = await call(a, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal('reveal' in oa.body, false)
  const ob = await call(b, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal('reveal' in ob.body, false)
  const ans = await answerOf(c.items[0])
  const g = await call(a, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'give_up' } }, T0 + 1000)
  assert.equal(g.status, 200)
  assert.equal(g.body.finished, true)
  assert.deepEqual(g.body.reveal, { answer: ans })
  // b는 아직 진행 중 → reveal 없음
  const ob2 = await call(b, { action: 'open', item_id: c.items[0] }, T0 + 2000)
  assert.equal('reveal' in ob2.body, false)
  assert.ok(!JSON.stringify(ob2.body).includes(`"answer"`))
  // 종료 후에는 모두에게 공개
  const ob3 = await call(b, { action: 'open', item_id: c.items[0] }, T0 + HOUR)
  assert.equal(ob3.status, 200)
  assert.deepEqual(ob3.body.reveal, { answer: ans })
  assert.equal(ob3.body.finished, true)
  // 한 번도 열지 않은 사람: 기록 없이 결과만
  const on = await call(never, { action: 'open', item_id: c.items[0] }, T0 + HOUR + 1)
  assert.equal(on.status, 200)
  assert.equal(on.body.public_state, null)
  assert.equal(on.body.finished, true)
  assert.equal(on.body.score, null)
  assert.deepEqual(on.body.reveal, { answer: ans })
  const [{ n }] = await sql`select count(*)::int as n from public.attempts where item_id = ${c.items[0]} and user_id = ${never}`
  assert.equal(n, 0)
})

t('open_after_end_on_unfinished_attempt_is_finished_with_reveal', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['number-guess'], join: [u] })
  await call(u, { action: 'open', item_id: c.items[0] }, T0)
  const ans = await answerOf(c.items[0])
  const a1 = await call(u, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'guess', value: miss(ans) } }, T0 + 1000)
  assert.equal(a1.status, 200)
  assert.equal(a1.body.finished, false)
  // 종료 뒤 행동: 409 ended + 끝난 화면
  const late = await call(u, { action: 'act', item_id: c.items[0], expected_count: 1, payload: { type: 'give_up' } }, T0 + HOUR)
  assert.equal(late.status, 409)
  assert.equal(late.body.error, 'ended')
  const lv = late.body.view as Record<string, unknown>
  assert.equal(lv.finished, true)
  assert.deepEqual(lv.reveal, { answer: ans })
  // 종료 뒤 open: 기록은 미완료로 남아 있지만 화면은 끝난 상태와 정답
  const o = await call(u, { action: 'open', item_id: c.items[0] }, T0 + HOUR + 1)
  assert.equal(o.status, 200)
  assert.equal(o.body.finished, true)
  assert.deepEqual(o.body.reveal, { answer: ans })
  assert.equal(o.body.action_count, 1)
  assert.equal(o.body.score, Number(a1.body.score))
  const [at] = await sql`select finished from public.attempts where item_id = ${c.items[0]} and user_id = ${u}`
  assert.equal(at.finished, false)
})

t('logic_exception_is_400_without_detail', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['fake-ver'], join: [u] })
  const o = await call(u, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(o.status, 200)
  const origError = console.error
  console.error = () => {}
  try {
    extra.set('fake-ver', {
      ...fakeVerV1,
      logic: { ...fakeVerV1.logic, apply: () => { throw new Error('internal detail 42') } },
    } as GameModule)
    const r = await call(u, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'guess', value: 1 } }, T0 + 1000)
    assert.equal(r.status, 400)
    assert.deepEqual(r.body, { error: 'invalid_action' })
  } finally {
    console.error = origError
    extra.set('fake-ver', fakeVerV1)
  }
})

// ---------------------------------------------------------------- bank
t('bank_source_takes_unused_and_marks_used', async () => {
  const u = await user()
  await sql`insert into public.puzzle_bank (game_id, puzzle_key, puzzle) values
    ('fake-bank', 'b1', ${sql.json({ range: 100, answer: 11 })}),
    ('fake-bank', 'b2', ${sql.json({ range: 100, answer: 22 })})`
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['fake-bank', 'fake-bank', 'fake-bank'], join: [u] })
  const [r1, r2] = await Promise.all([
    call(u, { action: 'open', item_id: c.items[0] }, T0),
    call(u, { action: 'open', item_id: c.items[1] }, T0),
  ])
  assert.equal(r1.status, 200, JSON.stringify(r1.body))
  assert.equal(r2.status, 200, JSON.stringify(r2.body))
  const items = await sql`select id, puzzle, puzzle_key from public.contest_items where contest_id = ${c.id} order by position`
  assert.ok(items[0].puzzle_key && items[1].puzzle_key)
  assert.notEqual(items[0].puzzle_key, items[1].puzzle_key)
  const bank = await sql`select puzzle_key, used_item_id from public.puzzle_bank where game_id = 'fake-bank' order by puzzle_key`
  for (const row of bank) {
    const it = items.find((i) => i.puzzle_key === row.puzzle_key)
    assert.ok(it)
    assert.equal(row.used_item_id, it.id)
    assert.deepEqual(it.puzzle, { range: 100, answer: row.puzzle_key === 'b1' ? 11 : 22 })
  }
  const r3 = await call(u, { action: 'open', item_id: c.items[2] }, T0)
  assert.equal(r3.status, 409)
  assert.equal(r3.body.error, 'bank_empty')
  // 이미 출제된 문제는 다시 열어도 그대로
  const again = await call(u, { action: 'open', item_id: c.items[0] }, T0 + 1)
  assert.equal(again.status, 200)
  const [same] = await sql`select puzzle_key from public.contest_items where id = ${c.items[0]}`
  assert.equal(same.puzzle_key, items[0].puzzle_key)
})

// ---------------------------------------------------------------- who-are-ya (실제 게임, 숨김 → 관리자)
t('who_are_ya_daily_plays_through_handler', async () => {
  const u = await user('approved', true)
  const now = Date.parse('2026-11-20T03:00:00Z')
  const d = await call(u, { action: 'daily', game_id: 'who-are-ya' }, now)
  assert.equal(d.status, 200, JSON.stringify(d.body))
  const itemId = d.body.item_id as string
  const o = await call(u, { action: 'open', item_id: itemId }, now)
  assert.equal(o.status, 200, JSON.stringify(o.body))
  assert.equal(o.body.game_id, 'who-are-ya')
  assert.deepEqual(o.body.options, { tier: 'easy', league: 'all' })
  assert.deepEqual(o.body.public_state, { guesses: [], won: false, gaveUp: false, initials: null })

  const [it] = await sql`select puzzle, puzzle_key, logic_version from public.contest_items where id = ${itemId}`
  const answer = (it.puzzle as { answer: { id: number; name: string } }).answer
  assert.equal(it.puzzle_key, String(answer.id))
  assert.equal(it.logic_version, 1)
  // 기본 옵션(쉬움)이므로 티어 1 선수
  assert.equal(PLAYERS.find((p) => p[0] === answer.id)?.[9], 1)

  const wrong = PLAYERS.filter((p) => p[0] !== answer.id).slice(0, 3).map((p) => p[0])
  let count = 0
  for (const id of wrong) {
    const r = await call(u, { action: 'act', item_id: itemId, expected_count: count, payload: { type: 'guess', id } }, now + 1000 * ++count)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.finished, false)
    assert.equal(r.body.reveal, undefined)
    const ps = JSON.stringify(r.body.public_state)
    assert.ok(!ps.includes(answer.name), 'public_state must not contain the answer name')
    assert.ok(!ps.includes(`"id":${answer.id},`), 'public_state must not contain the answer id')
  }
  const dup = await call(u, { action: 'act', item_id: itemId, expected_count: 3, payload: { type: 'guess', id: wrong[0] } }, now + 5000)
  assert.equal(dup.status, 400)
  assert.equal(dup.body.message, '이미 고른 선수예요')

  const h = await call(u, { action: 'act', item_id: itemId, expected_count: 3, payload: { type: 'hint' } }, now + 6000)
  assert.equal(h.status, 200, JSON.stringify(h.body))
  assert.equal(typeof (h.body.public_state as { initials: string }).initials, 'string')
  // 힌트는 추측 수에 들어가지 않는다
  assert.equal(h.body.action_count, 3)

  const win = await call(u, { action: 'act', item_id: itemId, expected_count: 3, payload: { type: 'guess', id: answer.id } }, now + 7000)
  assert.equal(win.status, 200, JSON.stringify(win.body))
  assert.equal(win.body.finished, true)
  assert.equal(win.body.score, 7) // 4번째에 정답(10) - 힌트(3)
  assert.equal(win.body.action_count, 4)
  assert.deepEqual(win.body.reveal, answer)

  // 공개 게임이라 다른 승인 사용자도 같은 데일리를 연다 (0007)
  const other = await user()
  const f = await call(other, { action: 'open', item_id: itemId }, now + 8000)
  assert.equal(f.status, 200, JSON.stringify(f.body))
  assert.equal(f.body.finished, false)
})

// ---------------------------------------------------------------- daily time limit
t('daily_time_limit_counts_from_first_open', async () => {
  const u = await user()
  const t0 = Date.parse('2026-11-12T03:00:00Z') // 12:00 KST
  const d = await call(u, { action: 'daily', game_id: 'fake-timed' }, t0)
  assert.equal(d.status, 200, JSON.stringify(d.body))
  const item = d.body.item_id as string
  const o = await call(u, { action: 'open', item_id: item }, t0)
  assert.equal(o.status, 200)
  assert.equal(o.body.ends_at, new Date(t0 + 10 * MIN).toISOString())
  // 다시 열어도 처음 연 시각 기준이다
  const o2 = await call(u, { action: 'open', item_id: item }, t0 + 5 * MIN)
  assert.equal(o2.body.ends_at, new Date(t0 + 10 * MIN).toISOString())
  const ans = await answerOf(item)
  const a1 = await call(u, { action: 'act', item_id: item, expected_count: 0, payload: { type: 'guess', value: miss(ans) } }, t0 + 10 * MIN - 1)
  assert.equal(a1.status, 200, JSON.stringify(a1.body))
  const stored = Number(a1.body.score)
  const a2 = await call(u, { action: 'act', item_id: item, expected_count: 1, payload: { type: 'guess', value: ans } }, t0 + 10 * MIN)
  assert.equal(a2.status, 409)
  assert.equal(a2.body.error, 'timeout')
  const view = a2.body.view as Record<string, unknown>
  assert.equal(view.finished, true)
  assert.equal(view.score, stored)
  assert.deepEqual(view.reveal, { answer: ans })
  const [at] = await sql`select * from public.attempts where item_id = ${item} and user_id = ${u}`
  assert.equal(at.finished, true)
  assert.equal(at.action_count, 1)
  assert.equal(Number(at.score), stored)
  // 확정 시각은 마감 시각
  assert.equal((at.finished_at as Date).getTime(), t0 + 10 * MIN)
  const again = await call(u, { action: 'act', item_id: item, expected_count: 1, payload: { type: 'give_up' } }, t0 + 11 * MIN)
  assert.equal(again.body.error, 'finished')
})

t('daily_time_limit_open_after_deadline_finalizes', async () => {
  const u = await user()
  const t0 = Date.parse('2026-11-13T03:00:00Z')
  const d = await call(u, { action: 'daily', game_id: 'fake-timed' }, t0)
  const item = d.body.item_id as string
  await call(u, { action: 'open', item_id: item }, t0)
  const o = await call(u, { action: 'open', item_id: item }, t0 + 30 * MIN)
  assert.equal(o.status, 200, JSON.stringify(o.body))
  assert.equal(o.body.finished, true)
  assert.ok(o.body.reveal !== undefined)
  const [at] = await sql`select finished, finished_at from public.attempts where item_id = ${item} and user_id = ${u}`
  assert.equal(at.finished, true)
  assert.equal((at.finished_at as Date).getTime(), t0 + 10 * MIN)
  // 다른 사람은 자기 10분을 새로 받는다
  const other = await user()
  const f = await call(other, { action: 'open', item_id: item }, t0 + 30 * MIN)
  assert.equal(f.body.finished, false)
  assert.equal(f.body.ends_at, new Date(t0 + 40 * MIN).toISOString())
})

t('daily_time_limit_capped_at_midnight', async () => {
  const u = await user()
  const late = Date.parse('2026-11-14T14:55:00Z') // 23:55 KST
  const d = await call(u, { action: 'daily', game_id: 'fake-timed' }, late)
  const o = await call(u, { action: 'open', item_id: d.body.item_id }, late)
  assert.equal(o.body.ends_at, '2026-11-14T15:00:00.000Z')
})

t('time_limit_does_not_apply_to_contests', async () => {
  const u = await user()
  const c = await contest({ starts: T0 - HOUR, ends: T0 + HOUR, games: ['fake-timed'], join: [u] })
  const o = await call(u, { action: 'open', item_id: c.items[0] }, T0)
  assert.equal(o.body.ends_at, new Date(T0 + HOUR).toISOString())
  const r = await call(u, { action: 'act', item_id: c.items[0], expected_count: 0, payload: { type: 'give_up' } }, T0 + 30 * MIN)
  assert.equal(r.status, 200, JSON.stringify(r.body))
})

t('teardown', async () => {
  await sql.end()
})
