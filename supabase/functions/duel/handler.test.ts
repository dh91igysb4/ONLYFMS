// duel handler 통합 테스트 (Deno + 로컬 Postgres). `npm run fn:test`로 돌린다.
// TEST_DB_URL은 소유자(슈퍼유저) 연결 — Supabase의 서비스/소유자 연결처럼 RLS를 우회한다.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { handle, type DuelDeps } from './handler.ts'
import type { DuelLogic, DuelModule, Manifest, Seat } from '../../../src/games/types.ts'
import { getDuel } from '../../../src/games/index.ts'
import { allowed, total } from '../../../src/games/yacht/scoring.ts'
import type { Sheet } from '../../../src/games/yacht/scoring.ts'

const url = Deno.env.get('TEST_DB_URL')
if (!url) throw new Error('TEST_DB_URL is required (npm run fn:test)')
const sql = postgres(url, { max: 20, onnotice: () => {} })

// ---------------------------------------------------------------- fake games
// coin: 2턴짜리 결정적 게임. 각자 한 번 숫자 n(0~9)을 고르고 큰 쪽이 이긴다. 같으면 무승부.
type CoinState = { seat: Seat; picks: (number | null)[] }
type CoinAction = { type: 'pick'; n: number } | { type: 'boom' }
function coinLogic(version: number): DuelLogic<CoinState, CoinAction, CoinState> {
  return {
    version,
    init: () => ({ seat: 0, picks: [null, null] }),
    toMove: (s) => s.seat,
    apply(s, seat, a) {
      if (seat !== s.seat) return { error: 'not_your_turn' }
      if (s.picks[0] !== null && s.picks[1] !== null) return { error: 'game_over' }
      if (a.type === 'boom') throw new Error('boom')
      if (a.type !== 'pick' || !Number.isInteger(a.n) || a.n < 0 || a.n > 9) return { error: 'bad_pick' }
      const picks = [...s.picks]
      picks[seat] = a.n
      return { state: { seat: seat === 0 ? 1 : 0, picks } }
    },
    timeoutAction: () => ({ type: 'pick', n: 0 }),
    turnNo: (s) => s.picks.filter((p) => p !== null).length,
    result(s) {
      const [a, b] = s.picks
      if (a === null || b === null) return { over: false }
      return { over: true, winner: a > b ? 0 : b > a ? 1 : null, scores: [a, b] }
    },
    view: (s) => s,
  }
}
const coinManifest = (id: string, hidden: boolean): Manifest => ({
  id,
  name: '동전',
  description: '테스트용',
  hidden,
  category: 'duel',
  modes: { daily: false, contest: false, free: false },
  puzzleSource: 'generate',
  options: [{ key: 'mode', label: '모드', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' }],
  duel: { turnSeconds: { choices: [30, 60, 90], default: 60 }, sameScreen: true },
})
const extra = new Map<string, DuelModule>([
  ['coin', { manifest: coinManifest('coin', false), logic: coinLogic(1) }],
  ['coin-hidden', { manifest: coinManifest('coin-hidden', true), logic: coinLogic(1) }],
])
// 기본 수 처리가 고장 난 게임들: turnNo가 0을 고른 상태에서 던짐 / 기본 수가 거절됨 / 기본 수가 턴을 넘기지 않음
const base = coinLogic(1)
const brokenLogics: Record<string, DuelLogic<CoinState, CoinAction, CoinState>> = {
  'coin-turn-throws': {
    ...base,
    turnNo: (s) => {
      if (s.picks.includes(0)) throw new Error('turnNo boom')
      return base.turnNo(s)
    },
  },
  'coin-rejected': { ...base, timeoutAction: () => ({ type: 'pick', n: 99 }) },
  'coin-stuck': {
    ...base,
    // 같은 좌석이 계속 두는 것처럼 상태를 바꾸지 않는 기본 수
    apply: (s, seat, a, rng) => (a.type === 'pick' && a.n === 0 ? { state: s } : base.apply(s, seat, a, rng)),
  },
}
for (const [id, logic] of Object.entries(brokenLogics)) extra.set(id, { manifest: coinManifest(id, false), logic })
const registry = { getDuel: (id: string) => extra.get(id) ?? getDuel(id) }

// ---------------------------------------------------------------- helpers
const SEC = 1000
const MIN = 60 * SEC
const T0 = Date.parse('2026-11-10T03:00:00Z')

type Bcast = { matchId: string; payload: { action_no: number; status: string } }
let bcasts: Bcast[] = []
let bcastThrows = false
/** 모든 응답 본문 (state_never_in_response 검사용) */
const allBodies: Record<string, unknown>[] = []

function deps(now: number): DuelDeps {
  return {
    sql,
    now: () => now,
    getUserId: (req) => {
      const h = req.headers.get('authorization') ?? ''
      return Promise.resolve(h.startsWith('Bearer ') ? h.slice(7) : null)
    },
    secret: 'test-secret',
    broadcast: (matchId, payload) => {
      bcasts.push({ matchId, payload })
      return bcastThrows ? Promise.reject(new Error('realtime down')) : Promise.resolve()
    },
    registry,
  }
}

type Res = { status: number; body: Record<string, unknown> }
async function call(uid: string | null, body: unknown, now: number): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (uid) headers.authorization = `Bearer ${uid}`
  const req = new Request('http://localhost/functions/v1/duel', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await handle(req, deps(now))
  const b = await res.json()
  allBodies.push(b)
  return { status: res.status, body: b }
}

let seq = 0
async function user(status: 'approved' | 'pending' = 'approved', admin = false): Promise<string> {
  const [u] = await sql`insert into auth.users (email) values (${`duel${++seq}@duel.test`}) returning id`
  await sql`update public.profiles set status = ${status}, is_admin = ${admin} where id = ${u.id}`
  return u.id as string
}

type View = {
  match_id: string
  game_id: string
  status: string
  players: { id: string; handle: string | null; rating: number }[]
  my_seat: 0 | 1 | null
  to_move: 0 | 1 | null
  action_no: number
  turn_deadline: string | null
  server_now: number
  view: unknown
  winner: 0 | 1 | null
  end_reason: string | null
  final_scores: [number, number] | null
  rating_change?: { before: number; after: number }
}

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })
}

type Opts = { game?: string; rated?: boolean; visibility?: 'public' | 'invite'; turn?: number; options?: unknown }
async function create(uid: string, now: number, o: Opts = {}): Promise<Res> {
  return await call(uid, {
    action: 'create',
    game_id: o.game ?? 'coin',
    options: o.options ?? {},
    rated: o.rated ?? true,
    visibility: o.visibility ?? 'invite',
    turn_seconds: o.turn ?? 60,
  }, now)
}

/** 두 사람이 대국을 시작한다. first = 선공 uid */
async function started(o: Opts = {}, now = T0) {
  const a = await user()
  const b = await user()
  const c = await create(a, now, o)
  assert.equal(c.status, 200, JSON.stringify(c.body))
  const id = c.body.match_id as string
  const j = await call(b, { action: 'join', match_id: id }, now + SEC)
  assert.equal(j.status, 200, JSON.stringify(j.body))
  const v = j.body as unknown as View
  const first = v.players[0].id
  const second = v.players[1].id
  return { a, b, id, first, second, view: v, code: c.body.invite_code as string }
}

async function row(id: string) {
  const [m] = await sql`select * from public.duel_matches where id = ${id}`
  return m
}

const move = (uid: string, id: string, n: number, payload: unknown, now: number) =>
  call(uid, { action: 'move', match_id: id, expected_action_no: n, payload }, now)

// 테스트 DB 준비(모듈 로드 때 한 번, --filter로 일부만 돌려도 적용): 요트는 숨김에서 빼고
// (숨김 검사는 coin-hidden으로), coin-hidden을 숨긴다. teardown에서 되돌린다.
await sql`delete from public.hidden_games where game_id = 'yacht'`
await sql`insert into public.hidden_games (game_id) values ('coin-hidden') on conflict do nothing`

// ---------------------------------------------------------------- auth / errors
t('unapproved_403', async () => {
  const r0 = await call(null, { action: 'view', match_id: crypto.randomUUID() }, T0)
  assert.equal(r0.status, 401)
  assert.equal(r0.body.error, 'unauthorized')
  const u = await user('pending')
  const r = await create(u, T0)
  assert.equal(r.status, 403)
  assert.equal(r.body.error, 'not_approved')
})

t('unknown_game_404', async () => {
  const u = await user()
  const r = await create(u, T0, { game: 'nope' })
  assert.equal(r.status, 404)
  assert.equal(r.body.error, 'unknown_game')
  // 솔로 게임은 대전 등록부에 없다
  const r2 = await create(u, T0, { game: 'number-guess' })
  assert.equal(r2.status, 404)
  assert.equal(r2.body.error, 'unknown_game')
})

t('hidden_game_admin_only', async () => {
  const u = await user()
  const admin = await user('approved', true)
  const r = await create(u, T0, { game: 'coin-hidden' })
  assert.equal(r.status, 404)
  assert.equal(r.body.error, 'unknown_game')
  const r2 = await create(admin, T0, { game: 'coin-hidden' })
  assert.equal(r2.status, 200)
  const j = await call(u, { action: 'join', match_id: r2.body.match_id }, T0)
  assert.equal(j.status, 404)
  assert.equal(j.body.error, 'unknown_game')
})

t('malformed_requests_400', async () => {
  const u = await user()
  for (const body of [
    '{nope',
    { action: 'dance' },
    { action: 'view', match_id: 'x' },
    { action: 'join' },
    { action: 'join', code: 'BAD!' },
    { action: 'create', game_id: 'coin', options: {}, rated: 'yes', visibility: 'invite', turn_seconds: 60 },
    { action: 'create', game_id: 'coin', options: {}, rated: true, visibility: 'secret', turn_seconds: 60 },
    { action: 'create', game_id: 'coin', options: {}, rated: true, visibility: 'invite', turn_seconds: 45 },
    { action: 'create', game_id: 'coin', options: { mode: 'z' }, rated: true, visibility: 'invite', turn_seconds: 60 },
    { action: 'create', game_id: 'coin', options: { other: 'a' }, rated: true, visibility: 'invite', turn_seconds: 60 },
    { action: 'create', game_id: 'coin', options: [], rated: true, visibility: 'invite', turn_seconds: 60 },
    { action: 'move', match_id: crypto.randomUUID(), expected_action_no: -1, payload: {} },
  ]) {
    const r = await call(u, body, T0)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.equal(r.body.error, 'invalid_action')
  }
  const nf = await call(u, { action: 'view', match_id: crypto.randomUUID() }, T0)
  assert.equal(nf.status, 404)
  assert.equal(nf.body.error, 'not_found')
})

// ---------------------------------------------------------------- create / join / cancel
t('create_returns_code_and_defaults', async () => {
  const u = await user()
  const r = await create(u, T0, { visibility: 'public', options: undefined })
  assert.equal(r.status, 200)
  assert.match(r.body.invite_code as string, /^[a-z0-9]{10}$/)
  const m = await row(r.body.match_id as string)
  assert.equal(m.status, 'waiting')
  assert.equal(m.visibility, 'public')
  assert.deepEqual(m.options, { mode: 'a' })
  assert.equal(m.logic_version, 1)
  assert.equal(m.created_by, u)
  assert.equal(m.invite_code, r.body.invite_code)
  assert.equal(m.state, null)
  // 턴 시간 생략 → 기본값
  const r2 = await call(u, { action: 'create', game_id: 'coin', rated: false, visibility: 'invite' }, T0)
  assert.equal(r2.status, 200)
  assert.equal((await row(r2.body.match_id as string)).turn_seconds, 60)
  // 만든 사람은 대기 중 대국을 view로 볼 수 있다
  const v = await call(u, { action: 'view', match_id: r.body.match_id }, T0)
  assert.equal(v.status, 200)
  const vv = v.body as unknown as View
  assert.equal(vv.status, 'waiting')
  assert.equal(vv.my_seat, null)
  assert.equal(vv.view, null)
  assert.equal(vv.players.length, 1)
  assert.equal(vv.players[0].id, u)
  assert.equal(vv.players[0].rating, 1000)
})

t('waiting_limit_3', async () => {
  const u = await user()
  for (let i = 0; i < 3; i++) assert.equal((await create(u, T0)).status, 200)
  const r = await create(u, T0)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'too_many_waiting')
  // 10분이 지난 대기 대국은 세지 않는다(무효 처리)
  const later = await create(u, T0 + 11 * MIN)
  assert.equal(later.status, 200)
  const [{ n }] = await sql`
    select count(*)::int as n from public.duel_matches where created_by = ${u} and status = 'void'`
  assert.equal(n, 3)
})

t('join_rules', async () => {
  const a = await user()
  const b = await user()
  const c3 = await user()
  const cr = await create(a, T0)
  const id = cr.body.match_id as string
  const own = await call(a, { action: 'join', match_id: id }, T0)
  assert.equal(own.status, 409)
  assert.equal(own.body.error, 'own_match')

  bcasts = []
  const j = await call(b, { action: 'join', code: cr.body.invite_code }, T0 + SEC)
  assert.equal(j.status, 200, JSON.stringify(j.body))
  const v = j.body as unknown as View
  assert.equal(v.status, 'active')
  assert.equal(v.action_no, 0)
  assert.deepEqual(new Set(v.players.map((p) => p.id)), new Set([a, b]))
  assert.equal(v.my_seat, v.players[0].id === b ? 0 : 1)
  assert.equal(v.to_move, 0)
  assert.equal(v.turn_deadline, new Date(T0 + SEC + 60 * SEC).toISOString())
  assert.deepEqual(bcasts, [{ matchId: id, payload: { action_no: 0, status: 'active' } }])

  // 같은 사람이 다시 → 그 대국 view (멱등)
  const again = await call(b, { action: 'join', match_id: id }, T0 + 2 * SEC)
  assert.equal(again.status, 200)
  assert.equal((again.body as unknown as View).match_id, id)
  // 만든 사람도 참가자가 되면 view
  const mine = await call(a, { action: 'join', match_id: id }, T0 + 2 * SEC)
  assert.equal(mine.status, 200)
  // 제3자
  const full = await call(c3, { action: 'join', match_id: id }, T0 + 2 * SEC)
  assert.equal(full.status, 409)
  assert.equal(full.body.error, 'full')
  // 제3자는 view를 받지 않는다
  assert.equal(full.body.view, undefined)
  const nv = await call(c3, { action: 'view', match_id: id }, T0 + 2 * SEC)
  assert.equal(nv.status, 403)
  assert.equal(nv.body.error, 'not_player')

  const nf = await call(c3, { action: 'join', code: 'zzzzzzzzzz' }, T0)
  assert.equal(nf.status, 404)
  assert.equal(nf.body.error, 'not_found')
})

t('join_expired_waiting_is_void', async () => {
  const a = await user()
  const b = await user()
  const cr = await create(a, T0)
  const r = await call(b, { action: 'join', match_id: cr.body.match_id }, T0 + 10 * MIN + SEC)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'not_waiting')
  const m = await row(cr.body.match_id as string)
  assert.equal(m.status, 'void')
  assert.equal(m.end_reason, 'void')
  assert.equal(m.players, null)
})

t('cancel_rules', async () => {
  const a = await user()
  const b = await user()
  const cr = await create(a, T0)
  const id = cr.body.match_id as string
  const no = await call(b, { action: 'cancel', match_id: id }, T0)
  assert.equal(no.status, 403)
  assert.equal(no.body.error, 'not_player')
  const ok = await call(a, { action: 'cancel', match_id: id }, T0)
  assert.equal(ok.status, 200)
  assert.equal((ok.body as unknown as View).status, 'void')
  assert.equal((ok.body as unknown as View).end_reason, 'void')
  const j = await call(b, { action: 'join', match_id: id }, T0)
  assert.equal(j.status, 409)
  assert.equal(j.body.error, 'not_waiting')
  const again = await call(a, { action: 'cancel', match_id: id }, T0)
  assert.equal(again.status, 409)
  assert.equal(again.body.error, 'not_waiting')
  // 시작된 대국은 취소 불가
  const s = await started()
  const c2 = await call(s.a, { action: 'cancel', match_id: s.id }, T0 + 2 * SEC)
  assert.equal(c2.status, 409)
  assert.equal(c2.body.error, 'not_waiting')
})

// ---------------------------------------------------------------- play
t('create_join_play_to_end_updates_elo', async () => {
  bcasts = []
  const s = await started({ rated: true })
  assert.equal(bcasts.length, 1)
  const m1 = await move(s.first, s.id, 0, { type: 'pick', n: 7 }, T0 + 5 * SEC)
  assert.equal(m1.status, 200, JSON.stringify(m1.body))
  const v1 = m1.body as unknown as View
  assert.equal(v1.action_no, 1)
  assert.equal(v1.to_move, 1)
  assert.equal(v1.turn_deadline, new Date(T0 + 65 * SEC).toISOString())
  const m2 = await move(s.second, s.id, 1, { type: 'pick', n: 2 }, T0 + 9 * SEC)
  assert.equal(m2.status, 200, JSON.stringify(m2.body))
  const v2 = m2.body as unknown as View
  assert.equal(v2.status, 'finished')
  assert.equal(v2.end_reason, 'normal')
  assert.equal(v2.winner, 0)
  assert.deepEqual(v2.final_scores, [7, 2])
  assert.equal(v2.to_move, null)
  assert.equal(v2.turn_deadline, null)
  assert.deepEqual(v2.rating_change, { before: 1000, after: 980 })
  const w = await call(s.first, { action: 'view', match_id: s.id }, T0 + 10 * SEC)
  assert.deepEqual((w.body as unknown as View).rating_change, { before: 1000, after: 1020 })
  assert.equal((w.body as unknown as View).players[0].rating, 1020)
  assert.deepEqual(bcasts.map((x) => x.payload), [
    { action_no: 0, status: 'active' },
    { action_no: 1, status: 'active' },
    { action_no: 2, status: 'finished' },
  ])
  assert.ok(bcasts.every((x) => x.matchId === s.id))
  const moves = await sql`select action_no, seat, action, auto from public.duel_moves where match_id = ${s.id} order by action_no`
  assert.deepEqual(moves.map((x) => [x.action_no, x.seat, x.auto]), [[0, 0, false], [1, 1, false]])
  assert.deepEqual(moves[0].action, { type: 'pick', n: 7 })
  // 끝난 대국에 행동 → 409 finished + view
  const late = await move(s.first, s.id, 2, { type: 'pick', n: 1 }, T0 + 11 * SEC)
  assert.equal(late.status, 409)
  assert.equal(late.body.error, 'finished')
  assert.equal((late.body.view as View).status, 'finished')
})

t('friendly_match_no_elo', async () => {
  const s = await started({ rated: false })
  await move(s.first, s.id, 0, { type: 'pick', n: 7 }, T0 + 5 * SEC)
  const r = await move(s.second, s.id, 1, { type: 'pick', n: 7 }, T0 + 6 * SEC)
  const v = r.body as unknown as View
  assert.equal(v.status, 'finished')
  assert.equal(v.winner, null)
  assert.equal(v.rating_change, undefined)
  const [{ n }] = await sql`select count(*)::int as n from public.duel_rating_changes where match_id = ${s.id}`
  assert.equal(n, 0)
})

t('yacht_full_game_through_handler', async () => {
  const s = await started({ game: 'yacht', rated: false })
  let now = T0 + 2 * SEC
  let v = s.view
  const uidOf = (seat: number) => (seat === 0 ? s.first : s.second)
  for (let turn = 0; turn < 26; turn++) {
    const seat = v.to_move as number
    const r1 = await move(uidOf(seat), s.id, v.action_no, { type: 'roll', keep: [] }, (now += SEC))
    assert.equal(r1.status, 200, JSON.stringify(r1.body))
    v = r1.body as unknown as View
    const st = v.view as { dice: number[]; sheets: [Sheet, Sheet] }
    const cat = allowed(st.dice, st.sheets[seat])[0]
    const r2 = await move(uidOf(seat), s.id, v.action_no, { type: 'score', category: cat }, (now += SEC))
    assert.equal(r2.status, 200, JSON.stringify(r2.body))
    v = r2.body as unknown as View
  }
  assert.equal(v.status, 'finished')
  assert.equal(v.end_reason, 'normal')
  assert.equal(v.action_no, 52)
  const st = v.view as { sheets: [Sheet, Sheet]; bonus: [number, number] }
  assert.deepEqual(v.final_scores, [total(st.sheets[0], st.bonus[0]), total(st.sheets[1], st.bonus[1])])
  const m = await row(s.id)
  assert.deepEqual(m.final_scores, v.final_scores)
  assert.equal(m.turn_no, 26)
})

t('not_your_turn_409', async () => {
  const s = await started()
  const r = await move(s.second, s.id, 0, { type: 'pick', n: 3 }, T0 + 5 * SEC)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'not_your_turn')
  assert.equal((r.body.view as View).action_no, 0)
  const outsider = await user()
  const r2 = await move(outsider, s.id, 0, { type: 'pick', n: 3 }, T0 + 5 * SEC)
  assert.equal(r2.status, 403)
  assert.equal(r2.body.error, 'not_player')
})

t('stale_expected_action_no_409_with_view', async () => {
  const s = await started({ game: 'yacht' })
  const r1 = await move(s.first, s.id, 0, { type: 'roll', keep: [] }, T0 + 5 * SEC)
  assert.equal(r1.status, 200)
  // 두 번째 탭이 옛 순번으로 같은 행동
  const r2 = await move(s.first, s.id, 0, { type: 'roll', keep: [] }, T0 + 6 * SEC)
  assert.equal(r2.status, 409)
  assert.equal(r2.body.error, 'stale')
  const v = r2.body.view as View
  assert.equal(v.action_no, 1)
  assert.equal(v.my_seat, 0) // 선공은 좌석 0
  assert.deepEqual((v.view as { dice: number[] }).dice, (r1.body.view as { dice: number[] }).dice)
})

t('invalid_payloads_400', async () => {
  const s = await started()
  for (const payload of [null, 'pick', [1], 5, { type: 'pick', n: 99 }, { type: 'boom' }, { type: 'x'.repeat(5000) }]) {
    const r = await move(s.first, s.id, 0, payload, T0 + 5 * SEC)
    assert.equal(r.status, 400, JSON.stringify(payload))
    assert.equal(r.body.error, 'invalid_action')
  }
  const m = await row(s.id)
  assert.equal(m.action_no, 0)
  assert.deepEqual(m.moved, [false, false])
})

// ---------------------------------------------------------------- timeouts
t('early_tick_not_due', async () => {
  const s = await started()
  bcasts = []
  const r = await call(s.first, { action: 'tick', match_id: s.id }, T0 + SEC + 60 * SEC - 1)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'not_due')
  assert.equal((r.body.view as View).action_no, 0)
  const m = await row(s.id)
  assert.equal(m.action_no, 0)
  assert.deepEqual(m.timeouts, [0, 0])
  assert.equal(bcasts.length, 0)
})

/** 요트에서 두 사람이 각자 한 턴씩 둔다. 돌려주는 시각에 선공 차례, 마감 = 그 시각 + 60초 */
async function yachtBothMoved() {
  const s = await started({ game: 'yacht', rated: true })
  let v = s.view
  let now = T0 + SEC
  for (const uid of [s.first, s.second]) {
    const seat = v.to_move as number
    v = (await move(uid, s.id, v.action_no, { type: 'roll', keep: [] }, (now += SEC))).body as unknown as View
    const st = v.view as { dice: number[]; sheets: [Sheet, Sheet] }
    const r = await move(uid, s.id, v.action_no, { type: 'score', category: allowed(st.dice, st.sheets[seat])[0] }, now)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    v = r.body as unknown as View
  }
  return { ...s, v, now, deadline: now + 60 * SEC }
}

t('timeout_once_auto_moves_then_twice_forfeits', async () => {
  const s = await yachtBothMoved()
  assert.equal(s.v.action_no, 4)
  assert.equal(s.v.to_move, 0)
  bcasts = []
  const r = await call(s.second, { action: 'tick', match_id: s.id }, s.deadline + SEC)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const v = r.body as unknown as View
  assert.equal(v.status, 'active')
  assert.equal(v.action_no, 6) // 굴리기 + 칸 선택
  assert.equal(v.to_move, 1)
  assert.equal(v.turn_deadline, new Date(s.deadline + 60 * SEC).toISOString())
  assert.deepEqual(bcasts.map((x) => x.payload), [{ action_no: 6, status: 'active' }])
  const m = await row(s.id)
  assert.deepEqual(m.timeouts, [1, 0])
  assert.equal(m.turn_no, 3)
  const auto = await sql`select action_no, seat, action, auto from public.duel_moves where match_id = ${s.id} and action_no >= 4 order by action_no`
  assert.deepEqual(auto.map((x) => [x.action_no, x.seat, x.auto]), [[4, 0, true], [5, 0, true]])
  assert.deepEqual(auto[0].action, { type: 'roll', keep: [] })
  assert.equal(auto[1].action.type, 'score')

  // 후공이 제때 둔다
  let now = s.deadline + 2 * SEC
  let w = (await move(s.second, s.id, 6, { type: 'roll', keep: [] }, now)).body as unknown as View
  const st = w.view as { dice: number[]; sheets: [Sheet, Sheet] }
  w = (await move(s.second, s.id, 7, { type: 'score', category: allowed(st.dice, st.sheets[1])[0] }, now)).body as unknown as View
  assert.equal(w.to_move, 0)
  assert.deepEqual((await row(s.id)).timeouts, [1, 0])
  // 선공이 또 초과 → 기권패
  now += 60 * SEC + 1
  const r2 = await call(s.first, { action: 'tick', match_id: s.id }, now)
  assert.equal(r2.status, 200, JSON.stringify(r2.body))
  const f = r2.body as unknown as View
  assert.equal(f.status, 'finished')
  assert.equal(f.end_reason, 'timeout')
  assert.equal(f.winner, 1)
  assert.deepEqual(f.rating_change, { before: 1000, after: 980 })
  const m2 = await row(s.id)
  assert.deepEqual(m2.timeouts, [2, 0])
  const changes = await sql`select user_id, before, after from public.duel_rating_changes where match_id = ${s.id}`
  assert.equal(changes.length, 2)
  assert.equal(changes.find((c) => c.user_id === s.second)!.after, 1020)
})

t('move_after_deadline_processes_timeout_then_stale', async () => {
  const s = await yachtBothMoved()
  const r = await move(s.first, s.id, 4, { type: 'roll', keep: [] }, s.deadline + SEC)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'stale')
  const v = r.body.view as View
  assert.equal(v.action_no, 6)
  assert.equal(v.to_move, 1)
  assert.deepEqual((await row(s.id)).timeouts, [1, 0])
})

t('concurrent_tick_and_move_at_deadline', async () => {
  const s = await yachtBothMoved()
  const at = s.deadline + 1
  const rs = await Promise.all([
    call(s.second, { action: 'tick', match_id: s.id }, at),
    move(s.first, s.id, 4, { type: 'roll', keep: [] }, at),
  ])
  const statuses = rs.map((r) => r.status)
  assert.ok(statuses.filter((x) => x === 200).length <= 1, JSON.stringify(rs.map((r) => r.body)))
  assert.ok(statuses.includes(409), JSON.stringify(rs.map((r) => r.body)))
  const m = await row(s.id)
  assert.equal(m.action_no, 6) // 한 턴 분량(자동 굴리기 + 칸)만
  assert.deepEqual(m.timeouts, [1, 0])
  const [{ n }] = await sql`select count(*)::int as n from public.duel_moves where match_id = ${s.id} and auto`
  assert.equal(n, 2)
  for (const r of rs) if (r.status === 409) assert.ok(r.body.view, JSON.stringify(r.body))
})

t('chained_timeouts_when_both_absent', async () => {
  const s = await yachtBothMoved()
  bcasts = []
  const r = await call(s.first, { action: 'tick', match_id: s.id }, s.deadline + 3 * 60 * SEC)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const v = r.body as unknown as View
  assert.equal(v.status, 'finished')
  assert.equal(v.end_reason, 'timeout')
  assert.equal(v.winner, 1)
  const m = await row(s.id)
  assert.deepEqual(m.timeouts, [2, 1])
  assert.equal(m.action_no, 10) // 선공·후공·선공 각 2행동
  assert.equal(bcasts.length, 1)
})

t('timeouts_before_anyone_moved_void', async () => {
  const s = await started({ rated: true })
  const r = await call(s.first, { action: 'tick', match_id: s.id }, T0 + SEC + 5 * 60 * SEC)
  assert.equal(r.status, 200)
  const v = r.body as unknown as View
  assert.equal(v.status, 'void')
  assert.equal(v.end_reason, 'void')
  assert.equal(v.winner, null)
  const [{ n }] = await sql`select count(*)::int as n from public.duel_rating_changes where match_id = ${s.id}`
  assert.equal(n, 0)
})

// ---------------------------------------------------------------- resign / void / version
t('resign_before_first_move_is_void', async () => {
  const s = await started({ rated: true })
  const r = await call(s.second, { action: 'resign', match_id: s.id }, T0 + 2 * SEC)
  assert.equal(r.status, 200)
  const v = r.body as unknown as View
  assert.equal(v.status, 'void')
  assert.equal(v.end_reason, 'void')
  assert.equal(v.winner, null)
  assert.equal(v.rating_change, undefined)
  const [{ n }] = await sql`select count(*)::int as n from public.duel_ratings where user_id in (${s.a}, ${s.b})`
  assert.equal(n, 0)
})

t('resign_after_both_moved_finishes', async () => {
  const s = await yachtBothMoved()
  const r = await call(s.first, { action: 'resign', match_id: s.id }, s.now + SEC)
  assert.equal(r.status, 200)
  const v = r.body as unknown as View
  assert.equal(v.status, 'finished')
  assert.equal(v.end_reason, 'resign')
  assert.equal(v.winner, 1)
  assert.deepEqual(v.rating_change, { before: 1000, after: 980 })
  const r2 = await call(s.second, { action: 'resign', match_id: s.id }, s.now + 2 * SEC)
  assert.equal(r2.status, 409)
  assert.equal(r2.body.error, 'finished')
})

t('version_change_voids_active', async () => {
  const s = await started({ rated: true })
  await move(s.first, s.id, 0, { type: 'pick', n: 3 }, T0 + 2 * SEC)
  const prev = extra.get('coin')!
  extra.set('coin', { manifest: prev.manifest, logic: coinLogic(2) })
  try {
    bcasts = []
    const r = await move(s.second, s.id, 1, { type: 'pick', n: 1 }, T0 + 3 * SEC)
    assert.equal(r.status, 409)
    assert.equal(r.body.error, 'version_changed')
    const v = r.body.view as View
    assert.equal(v.status, 'void')
    assert.equal(v.end_reason, 'void')
    const m = await row(s.id)
    assert.equal(m.status, 'void')
    assert.equal(m.winner, null)
    assert.equal(bcasts.length, 1)
    const [{ n }] = await sql`select count(*)::int as n from public.duel_rating_changes where match_id = ${s.id}`
    assert.equal(n, 0)
  } finally {
    extra.set('coin', prev)
  }
})

t('broadcast_failure_does_not_fail_request', async () => {
  const s = await started()
  bcastThrows = true
  try {
    const r = await move(s.first, s.id, 0, { type: 'pick', n: 3 }, T0 + 2 * SEC)
    assert.equal(r.status, 200)
    assert.equal((await row(s.id)).action_no, 1)
  } finally {
    bcastThrows = false
  }
})

// ---------------------------------------------------------------- hardening
for (const id of Object.keys(brokenLogics)) {
  t(`broken_timeout_logic_voids_${id}`, async () => {
    const s = await started({ game: id, rated: true })
    await move(s.first, s.id, 0, { type: 'pick', n: 5 }, T0 + 2 * SEC)
    // 둘 다 둔 것으로 둬서, 고장이 아니라면 정상 종료(finished)가 됐을 상황을 만든다
    await sql`update public.duel_matches set moved = '{true,true}' where id = ${s.id}`
    bcasts = []
    const r = await call(s.first, { action: 'tick', match_id: s.id }, T0 + 2 * SEC + 60 * SEC)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const v = r.body as unknown as View
    assert.equal(v.status, 'void')
    assert.equal(v.end_reason, 'void')
    assert.equal(v.winner, null)
    assert.equal(v.turn_deadline, null)
    const m = await row(s.id)
    assert.equal(m.status, 'void')
    const [{ n }] = await sql`select count(*)::int as n from public.duel_rating_changes where match_id = ${s.id}`
    assert.equal(n, 0)
    assert.equal(bcasts.length, 1)
    const [{ autos }] = await sql`select count(*)::int as autos from public.duel_moves where match_id = ${s.id} and auto`
    assert.equal(autos, 0)
    // 다시 tick해도 더 이상 마감 지난 진행 대국이 아니다
    const again = await call(s.first, { action: 'tick', match_id: s.id }, T0 + 10 * 60 * SEC)
    assert.equal(again.status, 409)
    assert.equal(again.body.error, 'finished')
  })
}

t('late_move_that_ends_match_is_409_finished', async () => {
  const s = await yachtBothMoved()
  // 선공이 이미 한 번 초과한 상태로 만든다
  await sql`update public.duel_matches set timeouts = '{1,0}' where id = ${s.id}`
  const r = await move(s.first, s.id, 4, { type: 'roll', keep: [] }, s.deadline + SEC)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'finished')
  const v = r.body.view as View
  assert.equal(v.status, 'finished')
  assert.equal(v.end_reason, 'timeout')
  assert.equal(v.winner, 1)
})

t('join_hidden_checked_before_full', async () => {
  const admin1 = await user('approved', true)
  const admin2 = await user('approved', true)
  const u = await user()
  const cr = await create(admin1, T0, { game: 'coin-hidden' })
  assert.equal((await call(admin2, { action: 'join', match_id: cr.body.match_id }, T0)).status, 200)
  const r = await call(u, { action: 'join', match_id: cr.body.match_id }, T0)
  assert.equal(r.status, 404)
  assert.equal(r.body.error, 'unknown_game')
})

t('join_code_case_insensitive', async () => {
  const a = await user()
  const b = await user()
  const cr = await create(a, T0)
  const r = await call(b, { action: 'join', code: `  ${(cr.body.invite_code as string).toUpperCase()} ` }, T0)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal((r.body as unknown as View).match_id, cr.body.match_id)
})

t('join_with_options_no_longer_valid_voids', async () => {
  const a = await user()
  const b = await user()
  const cr = await create(a, T0, { options: { mode: 'b' } })
  const prev = extra.get('coin')!
  const opts = prev.manifest.options.map((o) => ({ ...o, choices: o.choices.filter((c) => c.value !== 'b') }))
  extra.set('coin', { manifest: { ...prev.manifest, options: opts }, logic: prev.logic })
  try {
    const r = await call(b, { action: 'join', match_id: cr.body.match_id }, T0 + SEC)
    assert.equal(r.status, 409)
    assert.equal(r.body.error, 'not_waiting')
    const m = await row(cr.body.match_id as string)
    assert.equal(m.status, 'void')
    assert.equal(m.players, null)
  } finally {
    extra.set('coin', prev)
  }
})

t('join_fills_new_default_options', async () => {
  const a = await user()
  const b = await user()
  const cr = await create(a, T0)
  const prev = extra.get('coin')!
  const extraOpt = { key: 'speed', label: '속도', choices: [{ value: 'x', label: 'X' }], default: 'x' }
  extra.set('coin', { manifest: { ...prev.manifest, options: [...prev.manifest.options, extraOpt] }, logic: prev.logic })
  try {
    const r = await call(b, { action: 'join', match_id: cr.body.match_id }, T0 + SEC)
    assert.equal(r.status, 200)
    assert.deepEqual((await row(cr.body.match_id as string)).options, { mode: 'a', speed: 'x' })
  } finally {
    extra.set('coin', prev)
  }
})

// 지금까지의 모든 응답에서 상태는 view 안에만 있다
t('state_never_in_response', async () => {
  // 이 테스트 안에서 모든 행동 종류를 한 번씩 거친다(다른 테스트 순서와 무관)
  allBodies.length = 0
  const s = await yachtBothMoved()
  await call(s.first, { action: 'view', match_id: s.id }, s.now)
  await call(s.first, { action: 'tick', match_id: s.id }, s.now) // not_due + view
  await move(s.second, s.id, s.v.action_no, { type: 'roll', keep: [] }, s.now) // not_your_turn + view
  await move(s.first, s.id, 0, { type: 'roll', keep: [] }, s.now) // stale + view
  await call(s.second, { action: 'tick', match_id: s.id }, s.deadline + SEC)
  await call(s.second, { action: 'resign', match_id: s.id }, s.deadline + 2 * SEC)
  await move(s.first, s.id, 0, { type: 'roll', keep: [] }, s.deadline + 3 * SEC) // finished + view
  assert.ok(allBodies.length > 10)
  const check = (b: Record<string, unknown>) => {
    for (const k of Object.keys(b)) {
      assert.notEqual(k, 'state')
      if (k === 'view') {
        const v = b.view
        if (v && typeof v === 'object' && 'match_id' in (v as object)) check(v as Record<string, unknown>)
        continue
      }
      const s = JSON.stringify(b[k])
      assert.ok(!s?.includes('"sheets"'), k)
      assert.ok(!s?.includes('"picks"'), k)
    }
  }
  for (const b of allBodies) check(b)
})

t('teardown', async () => {
  await sql`delete from public.hidden_games where game_id = 'coin-hidden'`
  await sql`insert into public.hidden_games (game_id) values ('yacht') on conflict do nothing`
  await sql.end()
})
