// 상점 구매 동시성 테스트 (네온 라이더 차 설계 §7.2). `npm run fn:test`로 돌린다.
// pgTAP는 한 세션이라 동시 호출·잠금 경합을 재현할 수 없어 진짜 연결 여러 개로 확인한다(contest_fee.test.ts와 같은 방식).
// 검사는 이 파일이 만든 사용자로만 한다(같은 DB를 다른 테스트 파일도 쓴다).
import assert from 'node:assert/strict'
import postgres from 'postgres'

const url = Deno.env.get('TEST_DB_URL')
if (!url) throw new Error('TEST_DB_URL is required (npm run fn:test)')
const sql = postgres(url, { max: 30, onnotice: () => {} })

type Tx = postgres.TransactionSql

async function makeUser(gold: number): Promise<string> {
  const id = crypto.randomUUID()
  await sql`insert into auth.users (id, email) values (${id}, ${`shop-${id}@example.com`})`
  await sql`update public.profiles set status = 'approved' where id = ${id}`
  if (gold > 0) await sql`select public._gold_move(${id}, ${gold}, 'admin', ${`shop-seed-${id}`})`
  return id
}

async function asUser(tx: Tx, uid: string) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: 'authenticated' })}, true)`
  await tx`set local role authenticated`
}

async function buy(uid: string, item: string, price: number): Promise<string> {
  try {
    await sql.begin(async (tx) => {
      await asUser(tx, uid)
      await tx`select public.buy_item('neon-rider', ${item}, ${price})`
    })
    return 'ok'
  } catch (e) {
    return (e as { message?: string }).message ?? 'error'
  }
}

async function equip(uid: string, item: string): Promise<string> {
  try {
    await sql.begin(async (tx) => {
      await asUser(tx, uid)
      await tx`select public.equip_item('neon-rider', ${item})`
    })
    return 'ok'
  } catch (e) {
    return (e as { message?: string }).message ?? 'error'
  }
}

async function state(uid: string) {
  const [r] = await sql<{ bal: number; ledger: number; items: number }[]>`
    select (select balance from public.wallets where user_id = ${uid})::int as bal,
           (select count(*) from public.gold_ledger where user_id = ${uid} and reason = 'shop')::int as ledger,
           (select count(*) from public.user_items where user_id = ${uid})::int as items`
  return r
}

const t = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })

t('같은 사람이 같은 품목을 동시에 네 번 사도 장부 1행·보유 1행', async () => {
  const u = await makeUser(100000)
  const res = await Promise.all([1, 2, 3, 4].map(() => buy(u, 'f1', 60000)))
  assert.equal(res.filter((r) => r === 'ok').length, 1, res.join(','))
  assert.deepEqual(res.filter((r) => r !== 'ok'), ['already_owned', 'already_owned', 'already_owned'])
  assert.deepEqual(await state(u), { bal: 40000, ledger: 1, items: 1 })
})

t('서로 다른 품목을 동시에 사면 잔액 안에서만 산다', async () => {
  const u = await makeUser(20000)
  const res = await Promise.all([buy(u, 'buggy', 15000), buy(u, 'pickup', 5000), buy(u, 'sports', 30000)])
  assert.deepEqual(res, ['ok', 'ok', 'not_enough_gold'])
  assert.deepEqual(await state(u), { bal: 0, ledger: 2, items: 2 })
})

t('동시에 서로 다른 품목을 장착해도 equipped는 하나', async () => {
  const u = await makeUser(20000)
  assert.equal(await buy(u, 'buggy', 15000), 'ok')
  assert.equal(await buy(u, 'pickup', 5000), 'ok')
  for (let i = 0; i < 40; i++) {
    const res = await Promise.all([equip(u, 'buggy'), equip(u, 'pickup'), equip(u, 'buggy'), equip(u, 'pickup')])
    assert.deepEqual(res, ['ok', 'ok', 'ok', 'ok'])
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.user_items where user_id = ${u} and equipped`
    assert.equal(r.n, 1)
  }
})

t('shop: 연결 닫기', async () => { await sql.end() })
