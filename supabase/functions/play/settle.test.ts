// 데일리 정산 동시성 테스트 (지갑 3단계 Task 15, 설계 §8). `npm run fn:test`로 돌린다.
// pgTAP는 한 세션이라 동시 호출을 재현할 수 없어 진짜 연결 여러 개로 확인한다.
// 같은 DB를 다른 테스트 파일도 쓰므로(끝난 데일리가 남아 있을 수 있다) 검사는 이 파일이 만든 대회 id로만 한다.
import assert from 'node:assert/strict'
import postgres from 'postgres'

const url = Deno.env.get('TEST_DB_URL')
if (!url) throw new Error('TEST_DB_URL is required (npm run fn:test)')
const sql = postgres(url, { max: 20, onnotice: () => {} })

type Tx = postgres.TransactionSql

async function makeUsers(n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, () => crypto.randomUUID())
  for (const id of ids) {
    await sql`insert into auth.users (id, email) values (${id}, ${`settle-${id}@example.com`})`
    await sql`update public.profiles set status = 'approved' where id = ${id}`
  }
  return ids
}

await sql`insert into public.game_modes (game_id, daily, contest, free) values ('settle-g', true, false, false)
          on conflict (game_id) do nothing`

/** 끝난 데일리 하나와 기록(users 순서대로 점수 9, 8, 7 …, 모두 행동 1번 이상) */
async function endedDaily(users: string[]): Promise<string> {
  const key = `settle-g:${crypto.randomUUID().slice(0, 8)}`
  const [c] = await sql<{ id: string }[]>`
    insert into public.contests (kind, title, visibility, starts_at, ends_at, daily_key)
    values ('daily', 'settle', 'public', now() - interval '2 days', now() - interval '1 day', ${key})
    returning id`
  const [it] = await sql<{ id: string }[]>`
    insert into public.contest_items (contest_id, position, game_id) values (${c.id}, 1, 'settle-g') returning id`
  for (const [i, u] of users.entries()) {
    await sql`
      insert into public.attempts (item_id, user_id, state, logic_version, finished, score, action_count)
      values (${it.id}, ${u}, '{}', 1, true, ${9 - i}, 1)`
  }
  return c.id
}

/** 다른 테스트가 남긴 끝난 대회를 정산된 것으로 표시해, 한 번에 20개 제한 안에서 이 테스트의 대회가 잡히게 한다 */
async function clearDue() {
  await sql`update public.contests set settled_at = now() where settled_at is null and ends_at <= now()`
}

async function asUser(tx: Tx, uid: string) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: 'authenticated' })}, true)`
  await tx`set local role authenticated`
}

async function prizeRows(contestId: string): Promise<{ user_id: string; n: number; total: number }[]> {
  return await sql<{ user_id: string; n: number; total: number }[]>`
    select user_id, count(*)::int as n, sum(delta)::int as total from public.gold_ledger
     where reason = 'daily_prize' and ref = ${contestId} group by user_id order by sum(delta) desc`
}

const t = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label}: ${ms}ms 안에 끝나지 않음`)), ms))])

t('정산 중인 대회는 다른 정산이 기다리지 않고 건너뛴다(skip locked), 커밋 뒤 사람마다 한 줄', async () => {
  await clearDue()
  const users = await makeUsers(3)
  const k = await endedDaily(users)
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let aSettled!: () => void
  const aReady = new Promise<void>((r) => { aSettled = r })

  const a = sql.begin(async (tx) => {
    await asUser(tx, users[0])
    await tx`select public.settle_due()`
    aSettled()
    await gate // 커밋하지 않고 잡고 있다
  })
  await aReady
  try {
    // B: A가 잡은 대회를 건너뛰고 바로 끝나야 한다(기다리면 시간 초과)
    await withTimeout(
      sql.begin(async (tx) => {
        await asUser(tx, users[1])
        await tx`select public.settle_due()`
      }),
      5000,
      'B settle_due',
    )
    assert.equal((await prizeRows(k)).length, 0, 'A가 커밋하기 전에는 장부가 보이지 않는다(B가 기다리지도, 지급하지도 않음)')
  } finally {
    release()
    await a
  }
  const rows = await prizeRows(k)
  assert.deepEqual(rows.map((r) => [r.user_id, r.n, r.total]), [[users[0], 1, 6150], [users[1], 1, 5120], [users[2], 1, 4100]])
  const [c] = await sql<{ settled_at: Date | null }[]>`select settled_at from public.contests where id = ${k}`
  assert.ok(c.settled_at)
})

t('my_wallet()을 여러 사용자가 동시에 불러도 한 사람 × 한 데일리 = 한 번', async () => {
  await clearDue()
  const users = await makeUsers(8)
  const k = await endedDaily(users)
  await Promise.all(users.map((u) => sql.begin(async (tx) => {
    await asUser(tx, u)
    await tx`select public.my_wallet()`
  })))
  const rows = await prizeRows(k)
  assert.equal(rows.length, 8)
  assert.ok(rows.every((r) => r.n === 1))
  assert.deepEqual(rows.map((r) => r.total), [6150, 5120, 4100, 3070, 2460, 2050, 2050, 2050])
  const bal = await sql<{ balance: number }[]>`
    select balance::int from public.wallets where user_id = any(${users}::uuid[]) order by balance desc`
  assert.deepEqual(bal.map((b) => b.balance), [6150, 5120, 4100, 3070, 2460, 2050, 2050, 2050])
})

t('사람이 겹치는 두 데일리를 서로 다른 정산이 동시에 잡아도 교착 없이 끝난다', async () => {
  await clearDue()
  const users = await makeUsers(4)
  // 순위가 서로 반대인 두 대회(지급 순서가 대회 순서를 따르면 지갑을 반대로 잡게 된다)
  const k1 = await endedDaily(users)
  const k2 = await endedDaily([...users].reverse())
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let locked!: () => void
  const aLocked = new Promise<void>((r) => { locked = r })
  // A: k1을 먼저 잡아 둔다 → B의 settle_due는 k1을 건너뛰고 k2(와 남은 대회)를 정산
  const a = sql.begin(async (tx) => {
    await tx`select id from public.contests where id = ${k1} for update`
    locked()
    await gate
    await asUser(tx, users[0])
    await tx`select public.settle_due()`
  })
  await aLocked
  const b = sql.begin(async (tx) => {
    await asUser(tx, users[3])
    await tx`select public.settle_due()`
  })
  release()
  await withTimeout(Promise.all([a, b]), 10000, '두 정산')
  assert.equal((await prizeRows(k1)).length, 4)
  assert.equal((await prizeRows(k2)).length, 4)
  const bal = await sql<{ balance: number }[]>`
    select balance::int from public.wallets where user_id = any(${users}::uuid[])`
  // 각자 두 대회 상금 합: 1+4등, 2+3등, 3+2등, 4+1등 = 9,220
  assert.deepEqual(bal.map((b) => b.balance).sort((x, y) => x - y), [9220, 9220, 9220, 9220])
})

t('settle: 연결 닫기', async () => { await sql.end() })
