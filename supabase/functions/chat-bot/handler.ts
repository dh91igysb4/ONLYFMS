// 채팅 봇 핸들러 (설계 2026-11-03-chat-bot §3). 브라우저가 데일리 채팅에 글을 쓴 직후 부른다.
// 1) 부른 사람이 그 문항 채팅을 볼 수 있는지(can_chat)를 그 사람 권한으로 확인한다.
// 2) 그 사람이 방금(60초 안) 쓴 글에 봇 부름말이 있으면, 도배 제한을 통과한 뒤 모델을 불러 봇 글을 넣는다.
// 모델 호출은 트랜잭션 밖에서 한다(잠금을 오래 잡지 않게).
import type { Sql, Tx } from '../_shared/db.ts'
import { txOn } from '../_shared/db.ts'
import {
  type ChatLine, type Example, isTriggered, parseBubbles, pickExamples, seedFrom, transcript, TRANSCRIPT_LINES,
  userPrompt,
} from './logic.ts'

export type Completion = { system: string; user: string; model: string; maxTokens: number }

export type ChatBotDeps = {
  sql: Sql
  getUserId(req: Request): Promise<string | null>
  /** 모델 호출. 텍스트만 돌려준다 */
  complete(c: Completion): Promise<string>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 이보다 오래된 본인 글로는 봇을 부르지 않는다 */
const FRESH_SECONDS = 60
/** 같은 문항에서 봇 답 사이 최소 간격 */
const ITEM_GAP_SECONDS = 8
/** 한 사람이 한 시간에 부를 수 있는 횟수 */
const USER_PER_HOUR = 30
const MAX_TOKENS = 400

type Out = { status: number; body: Record<string, unknown> }
const out = (status: number, body: Record<string, unknown>): Out => ({ status, body })
const err = (status: number, error: string): Out => out(status, { error })

function json({ status, body }: Out): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Bot = { id: string; handle: string; trigger_words: string[]; system_prompt: string; model: string }

export async function handle(req: Request, deps: ChatBotDeps): Promise<Response> {
  return json(await run(req, deps))
}

async function run(req: Request, deps: ChatBotDeps): Promise<Out> {
  if (req.method !== 'POST') return err(405, 'method_not_allowed')
  const uid = await deps.getUserId(req)
  if (!uid) return err(401, 'unauthorized')
  let input: { item_id?: unknown }
  try {
    input = await req.json()
  } catch {
    return err(400, 'invalid_request')
  }
  const itemId = typeof input.item_id === 'string' && UUID_RE.test(input.item_id) ? input.item_id : null
  if (!itemId) return err(400, 'invalid_request')

  const tx = txOn(deps.sql)
  const gate = await tx(async (t): Promise<{ out: Out } | { bot: Bot }> => {
    if (!(await canChatAs(t, uid, itemId))) return { out: err(403, 'forbidden') }
    const [last] = await t<{ body: string | null }[]>`
      select body from public.daily_chat
       where item_id = ${itemId} and user_id = ${uid} and deleted_at is null
         and created_at > now() - make_interval(secs => ${FRESH_SECONDS})
       order by created_at desc limit 1`
    if (!last) return { out: out(200, { replies: [] }) }
    const bots = await t<Bot[]>`
      select id, handle, trigger_words, system_prompt, model
        from public.chat_bots where enabled order by id`
    const bot = bots.find((b) => isTriggered(last.body, b.trigger_words))
    if (!bot) return { out: out(200, { replies: [] }) }

    // 같은 문항의 동시 호출이 간격 검사를 함께 통과하지 않게 줄 세운다
    await t`select pg_advisory_xact_lock(hashtextextended(${'chat_bot:' + itemId}, 0))`
    const [recentItem] = await t`
      select 1 from public.chat_bot_calls
       where item_id = ${itemId} and bot_id = ${bot.id}
         and created_at > now() - make_interval(secs => ${ITEM_GAP_SECONDS}) limit 1`
    if (recentItem) return { out: err(429, 'too_fast') }
    const [{ n }] = await t<{ n: number }[]>`
      select count(*)::int as n from public.chat_bot_calls
       where user_id = ${uid} and created_at > now() - interval '1 hour'`
    if (n >= USER_PER_HOUR) return { out: err(429, 'too_many') }
    await t`insert into public.chat_bot_calls (bot_id, item_id, user_id) values (${bot.id}, ${itemId}, ${uid})`
    return { bot }
  })
  if ('out' in gate) return gate.out
  const bot = gate.bot

  const rows = await deps.sql<{ handle: string | null; body: string | null; image_path: string | null; bot_id: string | null }[]>`
    select coalesce(p.handle::text, b.handle) as handle, m.body, m.image_path, m.bot_id
      from public.daily_chat m
      left join public.profiles p on p.id = m.user_id
      left join public.chat_bots b on b.id = m.bot_id
     where m.item_id = ${itemId} and m.deleted_at is null
     order by m.created_at desc, m.id desc
     limit ${TRANSCRIPT_LINES}`
  const lines: ChatLine[] = rows.reverse().map((r) => ({
    handle: r.handle, body: r.body, image: r.image_path !== null, bot: r.bot_id === bot.id,
  }))
  const convo = transcript(lines, bot.handle)
  const pool = await deps.sql<Example[]>`
    select id::int as id, context, reply from public.chat_bot_examples where bot_id = ${bot.id}`
  const examples = pickExamples(pool, lines.slice(-8).map((l) => l.body ?? '').join(' '), seedFrom(itemId + convo))

  let text: string
  try {
    text = await deps.complete({
      system: bot.system_prompt, user: userPrompt(examples, convo, bot.handle), model: bot.model, maxTokens: MAX_TOKENS,
    })
  } catch (e) {
    console.error('chat-bot: completion failed', e)
    return err(502, 'bot_failed')
  }
  const bubbles = parseBubbles(text, [bot.handle, ...nameHints(bot)])
  if (bubbles.length === 0) return out(200, { replies: [] })

  const replies = await tx(async (t) => {
    const res: { id: string; created_at: string; body: string }[] = []
    for (let i = 0; i < bubbles.length; i++) {
      // 같은 트랜잭션의 now()는 고정이라, 순서가 유지되게 1ms씩 민다
      const [r] = await t<{ id: string; created_at: Date }[]>`
        insert into public.daily_chat (item_id, user_id, bot_id, body, created_at)
        values (${itemId}, null, ${bot.id}, ${bubbles[i]}, now() + make_interval(secs => ${i / 1000}))
        returning id, created_at`
      res.push({ id: r.id, created_at: new Date(r.created_at).toISOString(), body: bubbles[i] })
    }
    return res
  })
  return out(200, { bot: { id: bot.id, handle: bot.handle }, replies })
}

/** 모델이 붙이기 쉬운 이름표 후보: 봇 이름에서 '봇'을 뗀 것 */
function nameHints(bot: Bot): string[] {
  const base = bot.handle.replace(/봇$/, '')
  return base && base !== bot.handle ? [base] : []
}

/** 그 사용자 권한(auth.uid())으로 can_chat을 부른다. 트랜잭션 안에서만 설정이 유지된다 */
async function canChatAs(t: Tx, uid: string, itemId: string): Promise<boolean> {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: 'authenticated' })}, true)`
  const [r] = await t<{ ok: boolean }[]>`select public.can_chat(${itemId}::uuid) as ok`
  await t`select set_config('request.jwt.claims', '', true)`
  return r?.ok === true
}
