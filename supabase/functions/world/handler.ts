// 지속형(world) 게임 핸들러. 사용자·게임마다 저장 행(world_saves) 하나를 읽고, 게임의 순수 WorldLogic을 적용한다.
// 매 요청은 저장 행을 `for update`로 잠근 한 트랜잭션이다. 게임 id로 분기하지 않는다(등록부·logic이 차이를 푼다).
import type { Sql, Tx } from '../_shared/db.ts'
import { txOn } from '../_shared/db.ts'
import { getWorld } from '../../../src/games/index.ts'
import type { WorldLogic, WorldModule } from '../../../src/games/types.ts'

export type WorldDeps = {
  sql: Sql
  now: () => number
  getUserId(req: Request): Promise<string | null>
  rng: () => number
  registry?: { getWorld(id: string): WorldModule | undefined }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 행동 payload의 JSON 최대 길이 */
const MAX_PAYLOAD_CHARS = 2048

type Out = { status: number; body: Record<string, unknown> }
const out = (status: number, body: Record<string, unknown>): Out => ({ status, body })
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Out =>
  out(status, { error, ...extra })
const bad = (message: string) => err(400, 'invalid_action', { message })

function json({ status, body }: Out): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

// deno-lint-ignore no-explicit-any
type Logic = WorldLogic<any, any, any>

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export async function handle(req: Request, deps: WorldDeps): Promise<Response> {
  try {
    return json(await route(req, deps))
  } catch (e) {
    console.error('world: unexpected error', e)
    return json(err(500, 'internal'))
  }
}

async function route(req: Request, deps: WorldDeps): Promise<Out> {
  if (req.method !== 'POST') return err(405, 'method_not_allowed')
  const uid = await deps.getUserId(req)
  if (!uid || !UUID_RE.test(uid)) return err(401, 'unauthorized')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return bad('요청 형식이 잘못됐어요')
  }
  if (!isPlainObject(body)) return bad('요청 형식이 잘못됐어요')

  const [p] = await deps.sql<{ status: string; is_admin: boolean }[]>`
    select status, is_admin from public.profiles where id = ${uid}`
  if (!p || p.status !== 'approved') return err(403, 'not_approved')

  if (typeof body.game !== 'string') return bad('game이 필요해요')
  const gameId = body.game
  const mod = (deps.registry ?? { getWorld }).getWorld(gameId)
  if (!mod) return err(404, 'unknown_game')
  if (!p.is_admin) {
    const [h] = await deps.sql<{ hidden: boolean }[]>`
      select exists (select 1 from public.hidden_games where game_id = ${gameId}) as hidden`
    if (h.hidden) return err(404, 'unknown_game')
  }

  if (body.action !== 'load' && body.action !== 'act') return bad('action은 load 또는 act여야 해요')
  const isAct = body.action === 'act'
  if (isAct && (JSON.stringify(body.payload) ?? '').length > MAX_PAYLOAD_CHARS) {
    return bad('행동이 너무 커요')
  }

  const logic: Logic = mod.logic
  return await txOn(deps.sql)((tx) => run(tx, deps, logic, uid, gameId, isAct, body.payload))
}

async function run(
  tx: Tx,
  deps: WorldDeps,
  logic: Logic,
  uid: string,
  gameId: string,
  isAct: boolean,
  payload: unknown,
): Promise<Out> {
  const now = deps.now()
  // 없으면 만들고(동시 요청은 여기서 한 줄로 서게 된다), 잠근다
  await tx`
    insert into public.world_saves (user_id, game_id, state, logic_version)
    values (${uid}, ${gameId}, ${tx.json(logic.init())}, ${logic.version})
    on conflict (user_id, game_id) do nothing`
  const [row] = await tx<{ state: unknown; logic_version: number }[]>`
    select state, logic_version from public.world_saves
     where user_id = ${uid} and game_id = ${gameId} for update`

  let state: unknown = row.state
  let dirty = false
  if (row.logic_version !== logic.version) {
    state = logic.migrate(state, row.logic_version)
    dirty = true
  }

  let result: unknown = null
  if (isAct) {
    const r = logic.apply(state, payload, { now, rng: deps.rng })
    if ('error' in r) return err(400, r.error)
    state = r.state
    result = r.result ?? null
    dirty = true
  }

  if (dirty) {
    await tx`
      update public.world_saves
         set state = ${tx.json(state as never)}, logic_version = ${logic.version}, updated_at = now()
       where user_id = ${uid} and game_id = ${gameId}`
  }
  if (isAct) {
    for (const r of logic.records(state)) {
      await tx`
        insert into public.game_records (user_id, game_id, key, value, detail)
        values (${uid}, ${gameId}, ${r.key}, ${r.value}, ${r.detail ?? null})
        on conflict (user_id, game_id, key)
        do update set value = excluded.value, detail = excluded.detail, updated_at = now()`
    }
  }
  return out(200, { view: logic.view(state, { now }), result, server_now: now })
}
