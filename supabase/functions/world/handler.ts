// 지속형(world) 게임 핸들러. 사용자·게임마다 저장 행(world_saves) 하나를 읽고, 게임의 순수 WorldLogic을 적용한다.
// 매 요청은 저장 행을 `for update`로 잠근 한 트랜잭션이다. 게임 id로 분기하지 않는다(등록부·logic이 차이를 푼다).
// 지갑(설계 docs/superpowers/specs/2026-11-23-wallet-design.md §6): logic.wallet이 true인 게임만
//   세이브 행 → 지갑 행 순서로 잠그고(act), 옛 세이브의 골드를 legacyGold로 한 번 옮기고(reason migrate),
//   apply가 돌려준 gold 증감을 _gold_move(reason world)로 장부에 반영한다. 사이트 하루 상한은 _gold_move가 적용하고
//   핸들러는 실제 들어간 양(잔액 차이)만 보고 gold_capped를 알린다. wallet이 없는 게임은 지갑을 건드리지 않는다.
import type { Sql, Tx } from '../_shared/db.ts'
import { txOn } from '../_shared/db.ts'
import { getWorld } from '../../../src/games/index.ts'
import { AVATAR_RECORD_KEY, FREE_BONUS_RECORD_KEY, type WorldLogic, type WorldModule } from '../../../src/games/types.ts'

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

/** _gold_move가 잔액 음수를 거절할 때의 postgres 오류 */
function isNotEnoughGold(e: unknown): boolean {
  return isPlainObject(e) && (e as { message?: unknown }).message === 'not_enough_gold'
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
  try {
    return await txOn(deps.sql)((tx) => run(tx, deps, logic, uid, gameId, isAct, body.payload))
  } catch (e) {
    // 게임이 ctx.gold 검사를 빠뜨렸거나 다른 지출과 겹친 경우의 마지막 안전장치. 트랜잭션은 이미 롤백됐다
    if (isNotEnoughGold(e)) return err(400, 'not_enough_gold')
    throw e
  }
}

/** bigint를 text로 받아 숫자로 (잔액은 2^53보다 훨씬 작다) */
async function goldMove(
  tx: Tx, uid: string, delta: number, reason: string, ref: string | null, gameId: string,
): Promise<number> {
  const [r] = await tx<{ b: string }[]>`
    select public._gold_move(${uid}::uuid, ${delta}::bigint, ${reason}, coalesce(${ref}, gen_random_uuid()::text), ${gameId})::text as b`
  return Number(r.b)
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
  const created = await tx`
    insert into public.world_saves (user_id, game_id, state, logic_version)
    values (${uid}, ${gameId}, ${tx.json(logic.init())}, ${logic.version})
    on conflict (user_id, game_id) do nothing
    returning user_id`
  const [row] = await tx<{ state: unknown; logic_version: number }[]>`
    select state, logic_version from public.world_saves
     where user_id = ${uid} and game_id = ${gameId} for update`

  const wallet = logic.wallet === true
  let gold = 0
  if (wallet) {
    if (isAct) {
      const [w] = await tx<{ b: string }[]>`select public._wallet_lock(${uid}::uuid)::text as b`
      gold = Number(w.b)
    } else {
      const [w] = await tx<{ b: string }[]>`
        select coalesce((select balance from public.wallets where user_id = ${uid}), 0)::text as b`
      gold = Number(w.b)
    }
  }

  // 저장이 이 코드보다 새 버전이면(배포 중 옛 인스턴스, 옛 코드로 되돌림, 옛 브랜치에서 배포) 절대 낮춰 migrate하지 않는다.
  // 낮추면 새 필드를 지우고, 지갑 게임은 이전된 골드 뒤의 수입을 잃는다. 아무것도 쓰지 않고 거절한다
  if (row.logic_version > logic.version) return err(409, 'version_newer')
  let state: unknown = row.state
  let dirty = false
  if (row.logic_version !== logic.version) {
    if (wallet && logic.legacyGold) {
      const n = logic.legacyGold(state, row.logic_version)
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`world: legacyGold must be a non-negative integer, got ${n}`)
      // 중복 방지는 장부 unique (user, 'migrate', gameId)가 맡는다
      if (n > 0) gold = await goldMove(tx, uid, n, 'migrate', gameId, gameId)
    }
    state = logic.migrate(state, row.logic_version)
    dirty = true
  }
  // 프로필 캐릭터를 다시 쓸지 비교할 기준(행동 전, migrate 뒤)
  const avatarBefore = logic.avatar && !dirty && created.length === 0 ? logic.avatar(state) : null

  let result: unknown = null
  let capped: { asked: number; got: number } | null = null
  if (isAct) {
    const r = logic.apply(state, payload, wallet ? { now, rng: deps.rng, gold } : { now, rng: deps.rng, gold: 0 })
    if ('error' in r) {
      // 지갑 게임: 이전(migrate·지갑 이전)이 있었으면 그것만은 저장한다. 지갑 이전이 커밋된 채 세이브가 옛 버전으로
      // 남지 않게(설계 §6). 지갑이 없는 게임은 지금처럼 아무것도 저장하지 않는다
      if (dirty && wallet) {
        await writeSave(tx, uid, gameId, state, logic.version)
        if (logic.avatar) await writeAvatar(tx, uid, gameId, logic.avatar(state))
      }
      return err(400, r.error)
    }
    const delta = r.gold ?? 0
    if (delta !== 0) {
      if (!wallet) throw new Error('world: gold returned by a game without wallet')
      if (!Number.isSafeInteger(delta)) throw new Error(`world: gold must be an integer, got ${delta}`)
      const before = gold
      gold = await goldMove(tx, uid, delta, 'world', null, gameId)
      if (delta > 0 && gold - before < delta) capped = { asked: delta, got: gold - before }
    }
    state = r.state
    result = r.result ?? null
    dirty = true
  }

  if (dirty) await writeSave(tx, uid, gameId, state, logic.version)
  if (isAct) {
    for (const r of logic.records(state)) {
      await tx`
        insert into public.game_records (user_id, game_id, key, value, detail)
        values (${uid}, ${gameId}, ${r.key}, ${r.value}, ${r.detail ?? null})
        on conflict (user_id, game_id, key)
        do update set value = excluded.value, detail = excluded.detail, updated_at = now()`
    }
  }
  // 프로필 캐릭터(manifest avatar가 있는 게임): 기록과 같은 표에 키 AVATAR_RECORD_KEY, 값 0, detail에 문자열.
  // 세이브를 새로 만들었거나 migrate했으면(배포 뒤 첫 load) 쓰고, 그 밖에는 행동으로 문자열이 바뀐 때만 쓴다.
  if (logic.avatar) {
    const avatar = logic.avatar(state)
    if (avatarBefore === null || (isAct && avatar !== avatarBefore)) {
      await writeAvatar(tx, uid, gameId, avatar)
    }
  }
  // 자유 플레이 골드 보너스(지갑 설계 §7.5): 요청마다 다시 계산해 저장된 값과 다르면 쓴다(배포 뒤 첫 요청에서도 채워진다).
  // 자유 플레이 지급 트리거가 DB _free_bonus_pct로 이 행을 읽는다. 게임 id를 모른다: freeBonus가 있는 게임이면 같다.
  if (logic.freeBonus) {
    const pct = logic.freeBonus(state)
    if (!Number.isSafeInteger(pct) || pct < 0) throw new Error(`world: freeBonus must be a non-negative integer, got ${pct}`)
    const [cur] = await tx<{ v: string }[]>`
      select value::text as v from public.game_records
       where user_id = ${uid} and game_id = ${gameId} and key = ${FREE_BONUS_RECORD_KEY}`
    if (!cur || Number(cur.v) !== pct) {
      await tx`
        insert into public.game_records (user_id, game_id, key, value)
        values (${uid}, ${gameId}, ${FREE_BONUS_RECORD_KEY}, ${pct})
        on conflict (user_id, game_id, key)
        do update set value = excluded.value, updated_at = now()`
    }
  }
  if (!wallet) return out(200, { view: logic.view(state, { now, gold: 0 }), result, server_now: now })
  const body: Record<string, unknown> = { view: logic.view(state, { now, gold }), result, server_now: now, gold }
  if (capped) body.gold_capped = capped
  return out(200, body)
}

async function writeSave(tx: Tx, uid: string, gameId: string, state: unknown, version: number) {
  await tx`
    update public.world_saves
       set state = ${tx.json(state as never)}, logic_version = ${version}, updated_at = now()
     where user_id = ${uid} and game_id = ${gameId}`
}

async function writeAvatar(tx: Tx, uid: string, gameId: string, avatar: string) {
  await tx`
    insert into public.game_records (user_id, game_id, key, value, detail)
    values (${uid}, ${gameId}, ${AVATAR_RECORD_KEY}, 0, ${avatar})
    on conflict (user_id, game_id, key)
    do update set value = excluded.value, detail = excluded.detail, updated_at = now()`
}
