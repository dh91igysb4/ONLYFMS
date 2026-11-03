// chat-bot handler 통합 테스트 (Deno + 로컬 Postgres). `npm run fn:test`로 돌린다.
// TEST_DB_URL은 소유자(슈퍼유저) 연결 — Supabase의 서비스 연결처럼 RLS를 우회한다. 모델 호출은 가짜다.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { type Completion, handle, type ChatBotDeps } from './handler.ts'

const url = Deno.env.get('TEST_DB_URL')
if (!url) throw new Error('TEST_DB_URL is required (npm run fn:test)')
const sql = postgres(url, { max: 5, onnotice: () => {} })

const U1 = '00000000-0000-0000-0000-00000000cb01' // 문항을 끝낸 승인 사용자
const U2 = '00000000-0000-0000-0000-00000000cb02' // 문항을 안 푼 승인 사용자
const CONTEST = 'cbcb0000-0000-0000-0000-000000000001'
const ITEM = 'cbcb0000-0000-0000-0000-0000000000a1'

let calls: Completion[] = []
let reply: string | Error = 'ㅇㄴ\n재원봇: 근데\n저건 왜 노카드임'

function deps(uid: string | null): ChatBotDeps {
  return {
    sql,
    getUserId: () => Promise.resolve(uid),
    complete: (c) => {
      calls.push(c)
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)
    },
  }
}

function req(body: unknown): Request {
  return new Request('http://x/chat-bot', { method: 'POST', body: JSON.stringify(body) })
}

async function call(uid: string | null, body: unknown = { item_id: ITEM }) {
  const res = await handle(req(body), deps(uid))
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

async function say(uid: string, body: string, agoSeconds = 0) {
  await sql`insert into public.daily_chat (item_id, user_id, body, created_at)
            values (${ITEM}, ${uid}, ${body}, now() - make_interval(secs => ${agoSeconds}))`
}

async function reset() {
  calls = []
  reply = 'ㅇㄴ\n재원봇: 근데\n저건 왜 노카드임'
  await sql`delete from public.daily_chat where item_id = ${ITEM}`
  await sql`delete from public.chat_bot_calls where item_id = ${ITEM}`
}

async function setup() {
  await sql`delete from public.chat_bots where id = 'jaewon-test'`
  await sql`delete from public.contests where id = ${CONTEST}`
  await sql`delete from auth.users where id in (${U1}, ${U2})`
  await sql`insert into auth.users (id, email) values (${U1}, 'cb1@example.com'), (${U2}, 'cb2@example.com')`
  await sql`update public.profiles set status = 'approved', handle = 'botuser1' where id = ${U1}`
  await sql`update public.profiles set status = 'approved', handle = 'botuser2' where id = ${U2}`
  await sql`insert into public.contests (id, kind, title, visibility, starts_at, ends_at, daily_key)
            values (${CONTEST}, 'daily', 'bot', 'public', now() - interval '1 hour', now() + interval '23 hours',
                    'chat-bot-fn-test')`
  await sql`insert into public.contest_items (id, contest_id, position, game_id, logic_version, generated_at)
            values (${ITEM}, ${CONTEST}, 1, 'g-bot', 1, now())`
  await sql`insert into public.attempts (item_id, user_id, state, logic_version, finished, score, finished_at)
            values (${ITEM}, ${U1}, '{}', 1, true, 1, now())`
  await sql`insert into public.chat_bots (id, handle, trigger_words, system_prompt, model)
            values ('jaewon-test', '재원봇', array['@재원', '재원봇'], 'PERSONA', 'test-model')`
  await sql`insert into public.chat_bot_examples (bot_id, context, reply) values
            ('jaewon-test', '친구1: 토트넘 또 짐', '아니 왜'),
            ('jaewon-test', '친구2: 점심 뭐먹음', '국밥')`
}

Deno.test({
  name: 'chat-bot handler',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await setup()
    try {
      await t.step('토큰 없으면 401', async () => {
        await reset()
        assert.equal((await call(null)).status, 401)
      })
      await t.step('item_id 형식이 틀리면 400', async () => {
        await reset()
        assert.equal((await call(U1, { item_id: 'nope' })).status, 400)
      })
      await t.step('문항을 안 푼 사람은 403', async () => {
        await reset()
        await say(U1, '@재원 뭐함')
        assert.equal((await call(U2)).status, 403)
        assert.equal(calls.length, 0)
      })
      await t.step('부름말이 없으면 모델을 부르지 않는다', async () => {
        await reset()
        await say(U1, '토트넘 또 짐')
        const r = await call(U1)
        assert.equal(r.status, 200)
        assert.deepEqual(r.body.replies, [])
        assert.equal(calls.length, 0)
      })
      await t.step('60초가 지난 글로는 부르지 않는다', async () => {
        await reset()
        await say(U1, '@재원 뭐함', 120)
        const r = await call(U1)
        assert.deepEqual(r.body.replies, [])
        assert.equal(calls.length, 0)
      })
      await t.step('부르면 봇 글을 순서대로 넣는다', async () => {
        await reset()
        await say(U1, '토트넘 또 졌냐', 5)
        await say(U1, '@재원 심판 어떰')
        const r = await call(U1)
        assert.equal(r.status, 200)
        const replies = r.body.replies as { body: string }[]
        assert.deepEqual(replies.map((x) => x.body), ['ㅇㄴ', '근데', '저건 왜 노카드임'])
        assert.equal(calls.length, 1)
        assert.equal(calls[0].system, 'PERSONA')
        assert.equal(calls[0].model, 'test-model')
        assert.ok(calls[0].user.includes('botuser1: @재원 심판 어떰'))
        assert.ok(calls[0].user.includes('[재원봇]\n아니 왜'), '관련 예시가 들어간다')
        const rows = await sql<{ body: string; user_id: string | null; bot_id: string }[]>`
          select body, user_id, bot_id from public.daily_chat
           where item_id = ${ITEM} and bot_id is not null order by created_at, id`
        assert.deepEqual(rows.map((x) => x.body), ['ㅇㄴ', '근데', '저건 왜 노카드임'])
        assert.ok(rows.every((x) => x.user_id === null && x.bot_id === 'jaewon-test'))
      })
      await t.step('같은 문항에서 바로 또 부르면 429 too_fast', async () => {
        await say(U1, '재원봇 또 해봐')
        const r = await call(U1)
        assert.equal(r.status, 429)
        assert.equal(r.body.error, 'too_fast')
        assert.equal(calls.length, 1)
      })
      await t.step('다음 호출의 대화 기록에 봇 글이 봇 이름으로 들어간다', async () => {
        await sql`update public.chat_bot_calls set created_at = now() - interval '1 minute' where item_id = ${ITEM}`
        const r = await call(U1)
        assert.equal(r.status, 200)
        assert.ok(calls[1].user.includes('재원봇: 저건 왜 노카드임'))
      })
      await t.step('한 시간 30번이 넘으면 429 too_many', async () => {
        await reset()
        await sql`insert into public.chat_bot_calls (bot_id, item_id, user_id, created_at)
                  select 'jaewon-test', ${ITEM}, ${U1}, now() - interval '10 minutes' from generate_series(1, 30)`
        await say(U1, '@재원')
        const r = await call(U1)
        assert.equal(r.status, 429)
        assert.equal(r.body.error, 'too_many')
      })
      await t.step('모델 호출이 실패하면 502, 글은 안 들어간다', async () => {
        await reset()
        reply = new Error('boom')
        await say(U1, '@재원')
        const r = await call(U1)
        assert.equal(r.status, 502)
        const [{ n }] = await sql<{ n: number }[]>`
          select count(*)::int as n from public.daily_chat where item_id = ${ITEM} and bot_id is not null`
        assert.equal(n, 0)
      })
      await t.step('모델이 빈 답을 내면 아무것도 넣지 않는다', async () => {
        await reset()
        reply = '\n  \n'
        await say(U1, '@재원')
        const r = await call(U1)
        assert.equal(r.status, 200)
        assert.deepEqual(r.body.replies, [])
      })
    } finally {
      await sql`delete from public.chat_bots where id = 'jaewon-test'`
      await sql`delete from public.contests where id = ${CONTEST}`
      await sql`delete from auth.users where id in (${U1}, ${U2})`
      await sql.end()
    }
  },
})
