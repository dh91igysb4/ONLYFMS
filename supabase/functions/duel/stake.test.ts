// 대전 판돈 통합 테스트 (지갑 4단계 Task 20, 설계 §9). `npm run fn:test`로 돌린다.
// 맡기기는 duel 함수(create·join), 지급·환불은 DB 트리거 _duel_settle_stakes(마이그레이션 duel_stake).
// handler.test.ts와 같은 DB를 쓰므로 게임 id(stk-*)·이메일(stake*@stake.test)을 겹치지 않게 둔다.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { handle, type DuelDeps } from './handler.ts'
import type { DuelLogic, DuelModule, Manifest, Seat } from '../../../src/games/types.ts'
import { STAKE_MAX } from '../../../src/games/economy.ts'

const url = Deno.env.get('TEST_DB_URL')
if (!url) throw new Error('TEST_DB_URL is required (npm run fn:test)')
const sql = postgres(url, { max: 20, onnotice: () => {} })

// ---------------------------------------------------------------- fake game
// 차례로 숫자(0~9)를 고르고, 모두 LEN번 고르면 합이 큰 쪽이 이긴다. 같으면 무승부.
type S = { seat: Seat; picks: number[][] }
type A = { n: number }
function pickLogic(version: number, len = 2): DuelLogic<S, A, S> {
  return {
    version,
    init: () => ({ seat: 0, picks: [[], []] }),
    toMove: (s) => s.seat,
    apply(s, seat, a) {
      if (seat !== s.seat) return { error: 'not_your_turn' }
      if (!Number.isInteger(a?.n) || a.n < 0 || a.n > 9) return { error: 'bad_pick' }
      const picks = s.picks.map((p) => [...p])
      picks[seat].push(a.n)
      return { state: { seat: seat === 0 ? 1 : 0, picks } }
    },
    timeoutAction: () => ({ n: 0 }),
    turnNo: (s) => s.picks[0].length + s.picks[1].length,
    result(s) {
      if (s.picks[0].length + s.picks[1].length < len) return { over: false }
      const a = s.picks[0].reduce((x, y) => x + y, 0)
      const b = s.picks[1].reduce((x, y) => x + y, 0)
      return { over: true, winner: a > b ? 0 : b > a ? 1 : null, scores: [a, b] }
    },
    view: (s) => s,
  }
}
const man = (id: string, hidden: boolean): Manifest => ({
  id,
  name: '판돈 테스트',
  description: '테스트용',
  hidden,
  category: 'duel',
  modes: { daily: false, contest: false, free: false },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  duel: { turnSeconds: { choices: [60], default: 60 }, sameScreen: false },
})
const games = new Map<string, DuelModule>([
  ['stk', { manifest: man('stk', false), logic: pickLogic(1) }],
  ['stk-long', { manifest: man('stk-long', false), logic: pickLogic(1, 40) }],
  ['stk-hidden', { manifest: man('stk-hidden', true), logic: pickLogic(1) }],
])
let walletOn = true
const registry = { getDuel: (id: string) => games.get(id), walletEnabled: () => walletOn }

// ---------------------------------------------------------------- helpers
const SEC = 1000
const MIN = 60 * SEC
const T0 = Date.parse('2026-11-12T03:00:00Z')

function deps(now: number): DuelDeps {
  return {
    sql,
    now: () => now,
    getUserId: (req) => {
      const h = req.headers.get('authorization') ?? ''
      return Promise.resolve(h.startsWith('Bearer ') ? h.slice(7) : null)
    },
    secret: 'test-secret',
    broadcast: () => Promise.resolve(),
    registry,
  }
}

type Res = { status: number; body: Record<string, unknown> }
async function call(uid: string, body: unknown, now: number): Promise<Res> {
  const req = new Request('http://localhost/functions/v1/duel', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${uid}` },
    body: JSON.stringify(body),
  })
  const res = await handle(req, deps(now))
  return { status: res.status, body: await res.json() }
}

let seq = 0
async function user(gold = 0, admin = false): Promise<string> {
  const [u] = await sql`insert into auth.users (email) values (${`stake${++seq}@stake.test`}) returning id`
  await sql`update public.profiles set status = 'approved', is_admin = ${admin} where id = ${u.id}`
  if (gold > 0) await sql`select public._gold_move(${u.id}, ${gold}, 'admin', ${crypto.randomUUID()})`
  return u.id as string
}

async function bal(uid: string): Promise<number> {
  const [w] = await sql<{ balance: string }[]>`select balance from public.wallets where user_id = ${uid}`
  return w ? Number(w.balance) : 0
}

async function ledger(ref: string) {
  return await sql<{ user_id: string; reason: string; delta: string }[]>`
    select user_id, reason, delta from public.gold_ledger where ref = ${ref} order by id`
}

async function net(ref: string): Promise<number> {
  const [r] = await sql<{ s: string }[]>`
    select coalesce(sum(delta), 0) as s from public.gold_ledger where ref = ${ref} and reason like 'duel\\_%'`
  return Number(r.s)
}

async function status(id: string): Promise<string> {
  const [m] = await sql<{ status: string }[]>`select status::text from public.duel_matches where id = ${id}`
  return m.status
}

const made: string[] = []
function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })
}

async function create(uid: string, stake: unknown, now = T0, game = 'stk'): Promise<Res> {
  const body: Record<string, unknown> = { action: 'create', game_id: game, options: {}, rated: true, visibility: 'invite' }
  if (stake !== undefined) body.stake = stake
  const r = await call(uid, body, now)
  if (r.status === 200) made.push(r.body.match_id as string)
  return r
}

const join = (uid: string, id: string, stake: unknown, now = T0 + SEC) =>
  call(uid, stake === undefined ? { action: 'join', match_id: id } : { action: 'join', match_id: id, stake }, now)

type View = { players: { id: string }[]; stake: number; status: string; action_no: number; winner: 0 | 1 | null }

/** 판돈 대국을 시작한다(두 사람 각 1,000 G) */
async function started(stake: number, game = 'stk') {
  const a = await user(1000)
  const b = await user(1000)
  const c = await create(a, stake, T0, game)
  assert.equal(c.status, 200, JSON.stringify(c.body))
  const id = c.body.match_id as string
  const j = await join(b, id, stake)
  assert.equal(j.status, 200, JSON.stringify(j.body))
  const v = j.body as unknown as View
  return { a, b, id, first: v.players[0].id, second: v.players[1].id, view: v }
}

const pick = (uid: string, id: string, n: number, k: number, now: number) =>
  call(uid, { action: 'move', match_id: id, expected_action_no: k, payload: { n } }, now)

await sql`insert into public.hidden_games (game_id) values ('stk-hidden') on conflict do nothing`

// ---------------------------------------------------------------- create
t('stake_create_debits_creator', async () => {
  const u = await user(1000)
  const r0 = await create(u, 0)
  assert.equal(r0.status, 200)
  assert.equal(r0.body.stake, 0)
  assert.equal((await ledger(r0.body.match_id as string)).length, 0, '판돈 0 → 장부 없음')
  const old = await create(u, undefined)
  assert.equal(old.status, 200, '옛 화면(stake 없음) → 0')
  assert.equal(old.body.stake, 0)

  const r = await create(u, 500)
  assert.equal(r.status, 200)
  assert.equal(r.body.stake, 500)
  assert.equal(await bal(u), 500)
  const l = await ledger(r.body.match_id as string)
  assert.deepEqual(l.map((x) => [x.reason, Number(x.delta)]), [['duel_stake', -500]])
  const [m] = await sql`select stake from public.duel_matches where id = ${r.body.match_id as string}`
  assert.equal(m.stake, 500)
})

t('stake_create_not_enough_gold_rolls_back', async () => {
  const u = await user(500)
  const r = await create(u, 2000)
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'not_enough_gold')
  const [{ n }] = await sql`select count(*)::int as n from public.duel_matches where created_by = ${u}`
  assert.equal(n, 0, '대국 행이 남지 않는다')
  assert.equal(await bal(u), 500)
  const nobody = await user(0)
  const r2 = await create(nobody, 1)
  assert.equal(r2.status, 409, '지갑 없는 사람')
  assert.equal(r2.body.error, 'not_enough_gold')
})

t('stake_invalid_values_400', async () => {
  const u = await user(100000)
  for (const s of [-1, 1.5, '500', STAKE_MAX + 1, null, true]) {
    const r = await create(u, s)
    assert.equal(r.status, 400, JSON.stringify(s))
    assert.equal(r.body.error, 'invalid_stake')
  }
  const max = await create(u, STAKE_MAX)
  assert.equal(max.status, 200, 'STAKE_MAX 가능')
  assert.equal(await bal(u), 100000 - STAKE_MAX)
})

t('stake_hidden_game_zero_only', async () => {
  const admin = await user(1000, true)
  const r = await create(admin, 1, T0, 'stk-hidden')
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'invalid_stake')
  const r0 = await create(admin, 0, T0, 'stk-hidden')
  assert.equal(r0.status, 200)
  assert.equal(await bal(admin), 1000)
})

t('stake_zero_only_while_wallet_disabled', async () => {
  walletOn = false
  try {
    const u = await user(1000)
    const r = await create(u, 100)
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'invalid_stake')
    const r0 = await create(u, 0)
    assert.equal(r0.status, 200, '판돈 0은 언제나 가능')
    // 지갑이 꺼진 뒤에도 이미 판돈이 걸린 대국에는 참가할 수 있다(맡긴 돈이 묶이지 않게)
    walletOn = true
    const s = await create(u, 300)
    walletOn = false
    const b = await user(1000)
    const j = await join(b, s.body.match_id as string, 300)
    assert.equal(j.status, 200, JSON.stringify(j.body))
    assert.equal(await bal(b), 700)
  } finally {
    walletOn = true
  }
})

// ---------------------------------------------------------------- join
t('stake_join_debits_joiner_and_view_has_stake', async () => {
  const s = await started(500)
  assert.equal(s.view.stake, 500)
  assert.equal(await bal(s.a), 500)
  assert.equal(await bal(s.b), 500)
  const v = await call(s.a, { action: 'view', match_id: s.id }, T0 + 2 * SEC)
  assert.equal(v.body.stake, 500)
  // 이미 참가자의 재요청은 멱등(판돈 검사·차감 없음)
  const again = await join(s.b, s.id, undefined, T0 + 3 * SEC)
  assert.equal(again.status, 200)
  assert.equal(await bal(s.b), 500)
})

t('stake_join_mismatch_409', async () => {
  const a = await user(1000)
  const b = await user(1000)
  const c = await create(a, 500)
  const id = c.body.match_id as string
  for (const s of [undefined, 0, 400, '500']) {
    const j = await join(b, id, s)
    assert.equal(j.status, 409, JSON.stringify(s))
    assert.equal(j.body.error, 'stake_mismatch')
    assert.equal(j.body.stake, 500)
  }
  assert.equal(await status(id), 'waiting')
  assert.equal(await bal(b), 1000)
  assert.equal((await ledger(id)).length, 1)
  // 초대 코드로도 같은 검사
  const [{ invite_code }] = await sql`select invite_code from public.duel_matches where id = ${id}`
  const jc = await call(b, { action: 'join', code: invite_code, stake: 0 }, T0 + SEC)
  assert.equal(jc.body.error, 'stake_mismatch')
  const ok = await call(b, { action: 'join', code: invite_code, stake: 500 }, T0 + SEC)
  assert.equal(ok.status, 200)
})

t('stake_join_not_enough_gold_keeps_waiting', async () => {
  const a = await user(1000)
  const b = await user(200)
  const c = await create(a, 500)
  const id = c.body.match_id as string
  const j = await join(b, id, 500)
  assert.equal(j.status, 409)
  assert.equal(j.body.error, 'not_enough_gold')
  assert.equal(await status(id), 'waiting')
  assert.equal(await bal(a), 500, '만든 사람이 맡긴 돈 그대로')
  assert.equal(await bal(b), 200)
  const [m] = await sql`select players from public.duel_matches where id = ${id}`
  assert.equal(m.players, null)
})

t('stake_concurrent_joins_one_pays', async () => {
  const a = await user(1000)
  const c = await create(a, 400)
  const id = c.body.match_id as string
  const js = await Promise.all([1, 2, 3, 4].map(async () => {
    const u = await user(1000)
    return { u, r: await join(u, id, 400) }
  }))
  const okd = js.filter((x) => x.r.status === 200)
  assert.equal(okd.length, 1)
  for (const x of js.filter((x) => x.r.status !== 200)) {
    assert.equal(x.r.status, 409)
    assert.equal(x.r.body.error, 'full')
    assert.equal(await bal(x.u), 1000)
  }
  assert.equal(await bal(okd[0].u), 600)
  assert.equal((await ledger(id)).filter((l) => l.reason === 'duel_stake').length, 2)
})

// ---------------------------------------------------------------- endings
t('stake_win_pays_winner_all', async () => {
  const s = await started(500)
  await pick(s.first, s.id, 9, 0, T0 + 2 * SEC)
  const r = await pick(s.second, s.id, 1, 1, T0 + 3 * SEC)
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'finished')
  assert.equal(r.body.winner, 0)
  assert.equal(await bal(s.first), 1500, '맡긴 500 포함 1,000을 받는다')
  assert.equal(await bal(s.second), 500)
  assert.equal(await net(s.id), 0)
})

t('stake_draw_refunds_both', async () => {
  const s = await started(500)
  await pick(s.first, s.id, 4, 0, T0 + 2 * SEC)
  const r = await pick(s.second, s.id, 4, 1, T0 + 3 * SEC)
  assert.equal(r.body.status, 'finished')
  assert.equal(r.body.winner, null)
  assert.equal(await bal(s.first), 1000)
  assert.equal(await bal(s.second), 1000)
  assert.equal(await net(s.id), 0)
})

t('stake_resign_after_both_moved_is_loss', async () => {
  const s = await started(500, 'stk-long')
  await pick(s.first, s.id, 1, 0, T0 + 2 * SEC)
  await pick(s.second, s.id, 1, 1, T0 + 3 * SEC)
  const r = await call(s.first, { action: 'resign', match_id: s.id }, T0 + 4 * SEC)
  assert.equal(r.body.status, 'finished')
  assert.equal(r.body.end_reason, 'resign')
  assert.equal(await bal(s.second), 1500)
  assert.equal(await bal(s.first), 500)
  assert.equal(await net(s.id), 0)
})

t('stake_timeout_after_both_moved_is_loss', async () => {
  const s = await started(500, 'stk-long')
  await pick(s.first, s.id, 1, 0, T0 + 2 * SEC)
  await pick(s.second, s.id, 1, 1, T0 + 3 * SEC)
  // 선공이 두 번 연속 시간 초과(사이에 후공이 둔다)
  const tk = await call(s.second, { action: 'tick', match_id: s.id }, T0 + 3 * SEC + 61 * SEC)
  assert.equal(tk.status, 200, JSON.stringify(tk.body))
  const k = (tk.body as unknown as View).action_no
  await pick(s.second, s.id, 1, k, T0 + 3 * SEC + 62 * SEC)
  const tk2 = await call(s.second, { action: 'tick', match_id: s.id }, T0 + 3 * SEC + 62 * SEC + 61 * SEC)
  assert.equal(tk2.body.status, 'finished', JSON.stringify(tk2.body))
  assert.equal(tk2.body.end_reason, 'timeout')
  assert.equal(await bal(s.second), 1500)
  assert.equal(await bal(s.first), 500)
  assert.equal(await net(s.id), 0)
})

t('stake_resign_before_first_move_is_void_refund', async () => {
  const s = await started(500)
  const r = await call(s.second, { action: 'resign', match_id: s.id }, T0 + 2 * SEC)
  assert.equal(r.body.status, 'void')
  assert.equal(await bal(s.a), 1000)
  assert.equal(await bal(s.b), 1000)
  assert.equal(await net(s.id), 0)
})

t('stake_cancel_waiting_refunds_creator', async () => {
  const a = await user(1000)
  const c = await create(a, 700)
  assert.equal(await bal(a), 300)
  const r = await call(a, { action: 'cancel', match_id: c.body.match_id }, T0 + SEC)
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'void')
  assert.equal(await bal(a), 1000)
  assert.equal(await net(c.body.match_id as string), 0)
})

t('stake_stale_waiting_bulk_void_on_create_refunds', async () => {
  const a = await user(1000)
  const c = await create(a, 600)
  assert.equal(await bal(a), 400)
  const c2 = await create(a, 100, T0 + 11 * MIN)
  assert.equal(c2.status, 200)
  assert.equal(await status(c.body.match_id as string), 'void')
  assert.equal(await bal(a), 900, '600 환불 뒤 100 맡김')
})

t('stake_stale_waiting_view_expire_refunds', async () => {
  const a = await user(1000)
  const c = await create(a, 600)
  const v = await call(a, { action: 'view', match_id: c.body.match_id }, T0 + 11 * MIN)
  assert.equal(v.body.status, 'void')
  assert.equal(await bal(a), 1000)
  // 만료 대국에 참가 시도 → not_waiting, 참가자 돈 그대로
  const c2 = await create(a, 300, T0 + 20 * MIN)
  const b = await user(1000)
  const j = await join(b, c2.body.match_id as string, 300, T0 + 31 * MIN)
  assert.equal(j.body.error, 'not_waiting')
  assert.equal(await bal(b), 1000)
  assert.equal(await bal(a), 1000)
})

t('stake_version_change_void_refunds', async () => {
  const prev = games.get('stk')!
  const s = await started(500)
  games.set('stk', { manifest: prev.manifest, logic: pickLogic(2) })
  try {
    const r = await call(s.a, { action: 'view', match_id: s.id }, T0 + 2 * SEC)
    assert.equal(r.status, 409)
    assert.equal(r.body.error, 'version_changed')
    assert.equal(await bal(s.a), 1000)
    assert.equal(await bal(s.b), 1000)
  } finally {
    games.set('stk', prev)
  }
})

// ---------------------------------------------------------------- 리뷰 반영 (I1·Minor 1·2)
/** 다른 연결이 잠금을 기다리기 시작할 때까지 기다린다 */
async function waitForLockWait(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`
    if (n > 0) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('no lock wait observed')
}

t('stake_create_concurrent_with_wallet_move_no_deadlock', async () => {
  // B가 X의 지갑을 잡은 채로 → X의 create(판돈)가 지갑을 기다림 → B가 X 장부를 쓴다(FK KEY SHARE on profiles).
  // create가 profiles를 for update로 잡으면 교착이다. for no key update면 둘 다 커밋된다.
  const x = await user(1000)
  const b = await sql.reserve()
  try {
    await b`begin`
    await b`select public._wallet_lock(${x})`
    const pending = create(x, 300)
    await waitForLockWait()
    await b`select public._gold_move(${x}, 50, 'admin', ${crypto.randomUUID()})`
    await b`commit`
    const r = await pending
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(await bal(x), 750)
  } finally {
    b.release()
  }
})

t('stake_create_concurrent_with_stale_void_refund_no_deadlock', async () => {
  // X의 오래된 판돈 대기 대국 M을 B(duel_list·expireIfStale 흉내)가 잡고 → X의 create가 일괄 무효에서 M을 기다림 →
  // B가 M을 무효로 해 환불 트리거가 X 장부를 쓴다. 둘 다 커밋되고 환불은 한 번.
  const x = await user(1000)
  const c = await create(x, 400)
  const mid = c.body.match_id as string
  const b = await sql.reserve()
  try {
    await b`begin`
    await b`select id from public.duel_matches where id = ${mid} for update`
    const pending = create(x, 100, T0 + 11 * MIN)
    await waitForLockWait()
    await b`update public.duel_matches set status = 'void', end_reason = 'void', ended_at = now() where id = ${mid}`
    await b`commit`
    const r = await pending
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(await status(mid), 'void')
    const refunds = (await ledger(mid)).filter((l) => l.reason === 'duel_refund')
    assert.equal(refunds.length, 1)
    assert.equal(await bal(x), 900, '400 환불 뒤 100 맡김')
  } finally {
    b.release()
  }
})

t('stake_join_options_mismatch_void_refunds_creator', async () => {
  const a = await user(1000)
  const b = await user(1000)
  const c = await create(a, 500)
  const id = c.body.match_id as string
  // 지금 manifest에 없는 설정(배포 사이 manifest가 바뀐 경우)
  await sql`update public.duel_matches set options = '{"gone":"x"}'::jsonb where id = ${id}`
  const j = await join(b, id, 500)
  assert.equal(j.status, 409)
  assert.equal(j.body.error, 'not_waiting')
  assert.equal(await status(id), 'void')
  assert.equal(await bal(a), 1000, '만든 사람 환불')
  assert.equal(await bal(b), 1000, '참가자 돈은 빠지지 않음')
  assert.equal(await net(id), 0)
})

t('stake_view_reports_settled_amounts_from_ledger', async () => {
  const s = await started(500)
  await pick(s.first, s.id, 9, 0, T0 + 2 * SEC)
  await pick(s.second, s.id, 1, 1, T0 + 3 * SEC)
  const w = await call(s.first, { action: 'view', match_id: s.id }, T0 + 4 * SEC)
  assert.deepEqual(w.body.stake_settled, { staked: 500, payout: 1000, refund: 0 })
  const l = await call(s.second, { action: 'view', match_id: s.id }, T0 + 4 * SEC)
  assert.deepEqual(l.body.stake_settled, { staked: 500, payout: 0, refund: 0 })
  // 진행 중·판돈 0이면 없음
  const z = await started(0)
  const v0 = await call(z.a, { action: 'view', match_id: z.id }, T0 + 2 * SEC)
  assert.equal(v0.body.stake_settled, undefined)
  // 이긴 사람 계정이 지워진 대국: 트리거가 환불했으므로 진 사람은 '−'가 아니라 환불을 본다
  const d = await started(500, 'stk-long')
  await pick(d.first, d.id, 1, 0, T0 + 2 * SEC)
  await pick(d.second, d.id, 9, 1, T0 + 3 * SEC)
  await sql`delete from auth.users where id = ${d.second}`
  await sql`update public.duel_matches set status = 'finished', winner = 1, end_reason = 'normal', ended_at = now()
             where id = ${d.id}`
  const wv = await call(d.first, { action: 'view', match_id: d.id }, T0 + 4 * SEC)
  assert.deepEqual(wv.body.stake_settled, { staked: 500, payout: 0, refund: 500 })
})

t('stake_money_conserved_for_every_ended_match', async () => {
  const ended = await sql<{ id: string }[]>`
    select id::text from public.duel_matches where id = any(${made}::uuid[]) and status in ('finished', 'void')`
  assert.ok(ended.length >= 8)
  for (const m of ended) assert.equal(await net(m.id), 0, m.id)
})

t('stake_teardown', async () => {
  await sql`delete from public.hidden_games where game_id = 'stk-hidden'`
  await sql.end()
})
