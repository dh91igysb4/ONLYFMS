// 대회 참가비 동시성 테스트 (지갑 5단계 Task 23, 설계 §10). `npm run fn:test`로 돌린다.
// pgTAP는 한 세션이라 동시 호출·잠금 경합을 재현할 수 없어 진짜 연결 여러 개로 확인한다.
// 검사는 이 파일이 만든 대회 id로만 한다(같은 DB를 다른 테스트 파일도 쓴다).
import assert from 'node:assert/strict'
import postgres from 'postgres'

const url = Deno.env.get('TEST_DB_URL')
if (!url) throw new Error('TEST_DB_URL is required (npm run fn:test)')
const sql = postgres(url, { max: 30, onnotice: () => {} })

type Tx = postgres.TransactionSql

await sql`insert into public.game_modes (game_id, daily, contest, free) values ('fee-g', false, true, false)
          on conflict (game_id) do nothing`

async function makeUsers(n: number, gold = 100000): Promise<string[]> {
  const ids = Array.from({ length: n }, () => crypto.randomUUID())
  for (const id of ids) {
    await sql`insert into auth.users (id, email) values (${id}, ${`fee-${id}@example.com`})`
    await sql`update public.profiles set status = 'approved' where id = ${id}`
    if (gold > 0) await sql`select public._gold_move(${id}, ${gold}, 'admin', ${`fee-seed-${id}`})`
  }
  return ids
}

async function asUser(tx: Tx, uid: string) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: 'authenticated' })}, true)`
  await tx`set local role authenticated`
}

async function createContest(creator: string, fee: number): Promise<string> {
  return await sql.begin(async (tx) => {
    await asUser(tx, creator)
    const [r] = await tx<{ id: string }[]>`
      select id from public.create_contest('fee', now() + interval '10 minutes', 30, 'public',
        ${sql.json([{ game_id: 'fee-g', options: {}, count: 1 }])}, false, ${fee})`
    return r.id
  })
}

async function join(uid: string, contest: string, fee: number): Promise<string> {
  try {
    await sql.begin(async (tx) => {
      await asUser(tx, uid)
      await tx`select public.join_contest(${contest}, null, ${fee})`
    })
    return 'ok'
  } catch (e) {
    return (e as { message?: string }).message ?? 'error'
  }
}

async function balance(uid: string): Promise<number> {
  const [r] = await sql<{ b: number }[]>`select coalesce((select balance from public.wallets where user_id = ${uid}), 0)::int as b`
  return r.b
}

async function net(contest: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select coalesce(sum(delta), 0)::int as n from public.gold_ledger
     where reason in ('contest_fee', 'contest_prize', 'contest_refund') and ref = ${contest}`
  return r.n
}

async function feeRows(contest: string, uid: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.gold_ledger where reason = 'contest_fee' and ref = ${contest} and user_id = ${uid}`
  return r.n
}

const t = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label}: ${ms}ms 안에 끝나지 않음`)), ms))])

function gate() {
  let open!: () => void
  const p = new Promise<void>((r) => { open = r })
  return { p, open }
}

t('같은 사람이 동시에 네 번 참가해도 참가비는 한 번', async () => {
  const [a, b] = await makeUsers(2)
  const c = await createContest(a, 1000)
  const res = await Promise.all([1, 2, 3, 4].map(() => join(b, c, 1000)))
  assert.deepEqual(res, ['ok', 'ok', 'ok', 'ok'])
  assert.equal(await feeRows(c, b), 1)
  assert.equal(await balance(b), 99000)
})

t('여러 사람이 동시에 참가하면 사람마다 한 번씩', async () => {
  const users = await makeUsers(6)
  const c = await createContest(users[0], 500)
  const res = await Promise.all(users.slice(1).map((u) => join(u, c, 500)))
  assert.ok(res.every((r) => r === 'ok'))
  const [r] = await sql<{ n: number; s: number }[]>`
    select count(*)::int as n, sum(-delta)::int as s from public.gold_ledger where reason = 'contest_fee' and ref = ${c}`
  assert.deepEqual([r.n, r.s], [6, 3000])
  const [e] = await sql<{ n: number }[]>`select count(*)::int as n from public.contest_entries where contest_id = ${c}`
  assert.equal(e.n, 6)
})

t('외래 키 확인(KEY SHARE)을 쥔 트랜잭션이 있어도 참가가 기다리지 않는다 (for no key update)', async () => {
  const [a, b] = await makeUsers(2)
  const c = await createContest(a, 300)
  const g = gate()
  const held = gate()
  // A: contest_entries·contest_items 삽입이 잡는 것과 같은 잠금(KEY SHARE)을 대회 행에 쥐고 있다
  const holder = sql.begin(async (tx) => {
    await tx`select 1 from public.contests where id = ${c} for key share`
    held.open()
    await g.p
  })
  await held.p
  try {
    assert.equal(await withTimeout(join(b, c, 300), 5000, '참가'), 'ok')
  } finally {
    g.open()
    await holder
  }
  assert.equal(await balance(b), 99700)
})

t('지갑 잠금을 쥔 동안 참가가 기다리고, 그 뒤 취소가 대회 잠금을 기다려도 교착 없이 환불까지 맞는다', async () => {
  const [a, b] = await makeUsers(2)
  const c = await createContest(a, 800)
  const g = gate()
  const held = gate()
  // A: b의 지갑을 잡고 있다(다른 탭의 낚시 판매·정산 지급 흉내). 장부도 써서 profiles KEY SHARE까지 쥔다
  const holder = sql.begin(async (tx) => {
    await tx`select public._gold_move(${b}, 1, 'admin', ${`fee-hold-${b}`})`
    held.open()
    await g.p
  })
  await held.p
  // B: b의 참가 — 대회 행을 잡은 채 b 지갑을 기다린다
  const joining = join(b, c, 800)
  await new Promise((r) => setTimeout(r, 300))
  // C: 만든 사람의 취소 — 대회 행을 기다린다
  const cancelling = sql.begin(async (tx) => {
    await asUser(tx, a)
    await tx`select public.cancel_contest(${c})`
  })
  await new Promise((r) => setTimeout(r, 300))
  g.open()
  await holder
  const [j] = await withTimeout(Promise.all([joining, cancelling]), 10000, '참가·취소')
  assert.equal(j, 'ok')
  assert.equal(await net(c), 0, '참가비를 냈고 취소로 모두 돌려받았다')
  assert.equal(await balance(b), 100001)
  assert.equal(await balance(a), 100000)
})

t('취소가 먼저 대회를 잡으면 뒤의 참가는 contest_closed이고 돈이 빠지지 않는다', async () => {
  const [a, b] = await makeUsers(2)
  const c = await createContest(a, 600)
  const g = gate()
  const held = gate()
  const cancelling = sql.begin(async (tx) => {
    await asUser(tx, a)
    await tx`select public.cancel_contest(${c})`
    held.open()
    await g.p
  })
  await held.p
  const joining = join(b, c, 600)
  await new Promise((r) => setTimeout(r, 300))
  g.open()
  await cancelling
  assert.equal(await joining, 'contest_closed')
  assert.equal(await balance(b), 100000)
  assert.equal(await net(c), 0)
})

/** 끝난 대회로 옮기고 기록을 넣는다(점수는 users 순서대로 9, 8, 7 …) */
async function endWithScores(contest: string, users: string[]) {
  await sql`update public.contests set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = ${contest}`
  const [it] = await sql<{ id: string }[]>`select id from public.contest_items where contest_id = ${contest} order by position limit 1`
  for (const [i, u] of users.entries()) {
    await sql`insert into public.attempts (item_id, user_id, state, logic_version, finished, score, action_count)
              values (${it.id}, ${u}, '{}', 1, true, ${9 - i}, 1)`
  }
}

async function clearDue() {
  await sql`update public.contests set settled_at = now() where settled_at is null and ends_at <= now()`
}

async function prizes(contest: string): Promise<number[]> {
  const rows = await sql<{ d: number }[]>`
    select delta::int as d from public.gold_ledger where reason = 'contest_prize' and ref = ${contest} order by delta desc`
  return rows.map((r) => r.d)
}

t('1등 지갑이 잠깐 잡혀 있으면 정산이 기다렸다 분배한다 (lock_timeout 안)', async () => {
  await clearDue()
  const users = await makeUsers(3)
  const c = await createContest(users[0], 1000)
  for (const u of users.slice(1)) assert.equal(await join(u, c, 1000), 'ok')
  await endWithScores(c, users)
  const g = gate()
  const held = gate()
  const holder = sql.begin(async (tx) => {
    await tx`select public._wallet_lock(${users[0]})`
    held.open()
    await g.p
  })
  await held.p
  const settling = sql.begin(async (tx) => {
    await asUser(tx, users[2])
    return await tx<{ n: number }[]>`select public.settle_due() as n`
  })
  await new Promise((r) => setTimeout(r, 400))
  g.open()
  await holder
  const [r] = await withTimeout(settling, 10000, '정산')
  assert.equal(r.n, 1)
  assert.deepEqual(await prizes(c), [1800, 900, 300])
  assert.equal(await net(c), 0)
})

t('지갑을 오래 잡으면 정산은 실패로 끝나고(my_wallet은 삼킴), 다음 접속 때 한 번만 분배한다', async () => {
  await clearDue()
  const users = await makeUsers(3)
  const c = await createContest(users[0], 1000)
  for (const u of users.slice(1)) assert.equal(await join(u, c, 1000), 'ok')
  await endWithScores(c, users)
  const g = gate()
  const held = gate()
  const holder = sql.begin(async (tx) => {
    await tx`select public._wallet_lock(${users[1]})`
    held.open()
    await g.p
  })
  await held.p
  try {
    // my_wallet: settle_due가 lock_timeout(2초)으로 실패해도 잔액은 읽힌다
    const [w] = await withTimeout(sql.begin(async (tx) => {
      await asUser(tx, users[2])
      return await tx<{ w: { balance: number } }[]>`select public.my_wallet() as w`
    }), 10000, 'my_wallet')
    assert.equal(w.w.balance, 99000)
    assert.deepEqual(await prizes(c), [])
    const [s] = await sql<{ settled_at: Date | null }[]>`select settled_at from public.contests where id = ${c}`
    assert.equal(s.settled_at, null, '실패한 대회는 settled_at이 없다')
  } finally {
    g.open()
    await holder
  }
  await Promise.all(users.map((u) => sql.begin(async (tx) => {
    await asUser(tx, u)
    await tx`select public.my_wallet()`
  })))
  assert.deepEqual(await prizes(c), [1800, 900, 300])
  assert.equal(await net(c), 0)
})

t('contest_fee: 연결 닫기', async () => { await sql.end() })
