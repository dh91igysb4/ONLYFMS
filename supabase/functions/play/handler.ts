// 출제·판정 핸들러 (설계 §8). 시각은 모두 deps.now()(서버 시계)에서 온다 — 클라이언트 시각은 쓰지 않는다.
// 정답(puzzle)과 내부 상태(state)는 응답에 넣지 않는다. 브라우저에는 logic.publicState와,
// 기록이 끝났거나 대회가 끝난 뒤에만 logic.reveal을 보낸다.
import type { Sql, Tx } from './db.ts'
import { txOn } from './db.ts'
import { normalizeScore, pickFresh, step } from './engine.ts'
import { registry as defaultRegistry, type Registry } from './registry.ts'
import type { Ctx, GameModule } from '../../../src/games/types.ts'
import { kstDate, kstDayRange } from '../../../src/shared/kst.ts'
import { hmacSeed, rngFromSeed } from '../../../src/shared/rng.ts'

export type Deps = {
  sql: Sql
  now: () => number
  getUserId: (req: Request) => Promise<string | null>
  secret: string
  registry?: Registry
}

export type PlayView = {
  item_id: string
  contest_id: string
  game_id: string
  options: Record<string, string>
  public_state: unknown
  finished: boolean
  score: number | null
  action_count: number
  ends_at: string
  server_now: number
  reveal?: unknown
}

const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_DAYS = 60
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Out = { status: number; body: Record<string, unknown> }
const out = (status: number, body: Record<string, unknown>): Out => ({ status, body })
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Out =>
  out(status, { error, ...extra })

function json({ status, body }: Out): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

type Me = { id: string; admin: boolean }

type ItemRow = {
  id: string
  contest_id: string
  position: number
  game_id: string
  options: Record<string, string>
  puzzle: unknown
  puzzle_key: string | null
  kind: 'daily' | 'official' | 'friendly'
  starts_at: Date
  ends_at: Date
  cancelled_at: Date | null
  hidden: boolean
  joined: boolean
  mode_ok: boolean
}

type AttemptRow = {
  state: unknown
  logic_version: number
  finished: boolean
  score: string | number
  action_count: number
  started_at: Date
}

// ---------------------------------------------------------------- entry
export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    return json(await route(req, deps))
  } catch (e) {
    console.error('play: unexpected error', e)
    return json(err(500, 'internal'))
  }
}

async function route(req: Request, deps: Deps): Promise<Out> {
  if (req.method !== 'POST') return err(405, 'method_not_allowed')
  const uid = await deps.getUserId(req)
  if (!uid || !UUID_RE.test(uid)) return err(401, 'unauthorized')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return err(400, 'invalid_action', { message: '요청 형식이 잘못됐어요' })
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return err(400, 'invalid_action', { message: '요청 형식이 잘못됐어요' })
  }
  const b = body as Record<string, unknown>

  const [p] = await deps.sql<{ status: string; is_admin: boolean }[]>`
    select status, is_admin from public.profiles where id = ${uid}`
  if (!p || p.status !== 'approved') return err(403, 'not_approved')
  const me: Me = { id: uid, admin: p.is_admin }
  const reg = deps.registry ?? defaultRegistry

  switch (b.action) {
    case 'daily':
      if (typeof b.game_id !== 'string') return err(400, 'invalid_action', { message: 'game_id가 필요해요' })
      return await daily(deps, reg, me, b.game_id)
    case 'open':
      if (typeof b.item_id !== 'string' || !UUID_RE.test(b.item_id)) {
        return err(400, 'invalid_action', { message: 'item_id가 잘못됐어요' })
      }
      return await open(deps, reg, me, b.item_id)
    case 'act': {
      if (typeof b.item_id !== 'string' || !UUID_RE.test(b.item_id)) {
        return err(400, 'invalid_action', { message: 'item_id가 잘못됐어요' })
      }
      const ec = b.expected_count
      if (typeof ec !== 'number' || !Number.isInteger(ec) || ec < 0) {
        return err(400, 'invalid_action', { message: 'expected_count가 잘못됐어요' })
      }
      return await act(deps, reg, me, b.item_id, ec, b.payload)
    }
    default:
      return err(400, 'invalid_action', { message: '알 수 없는 요청이에요' })
  }
}

// ---------------------------------------------------------------- daily
async function daily(deps: Deps, reg: Registry, me: Me, gameId: string): Promise<Out> {
  const game = reg.getGame(gameId)
  if (!game || !game.manifest.modes.daily) return err(404, 'unknown_game')
  const now = deps.now()

  return await txOn(deps.sql)(async (tx) => {
    const [g] = await tx<{ daily: boolean; hidden: boolean }[]>`
      select gm.daily, exists (select 1 from public.hidden_games h where h.game_id = gm.game_id) as hidden
        from public.game_modes gm where gm.game_id = ${gameId}`
    if (!g || !g.daily) return err(404, 'unknown_game')
    if (g.hidden && !me.admin) return err(403, 'forbidden')

    const date = kstDate(now)
    const { start, end } = kstDayRange(date)
    const key = `${gameId}:${date}`
    const title = `${game.manifest.name} · ${date}`.slice(0, 40)
    const options = defaultOptions(game)

    await tx`
      insert into public.contests (kind, title, visibility, starts_at, ends_at, daily_key)
      values ('daily', ${title}, 'public', ${start}, ${end}, ${key})
      on conflict (daily_key) do nothing`
    const [c] = await tx<{ id: string }[]>`select id from public.contests where daily_key = ${key}`
    await tx`
      insert into public.contest_items (contest_id, position, game_id, options)
      values (${c.id}, 1, ${gameId}, ${tx.json(options)})
      on conflict (contest_id, position) do nothing`
    const [it] = await tx<{ id: string }[]>`
      select id from public.contest_items where contest_id = ${c.id} and position = 1`
    if (now < end.getTime()) {
      await tx`
        insert into public.contest_entries (contest_id, user_id) values (${c.id}, ${me.id})
        on conflict do nothing`
    }
    return out(200, { contest_id: c.id, item_id: it.id })
  })
}

function defaultOptions(game: GameModule): Record<string, string> {
  return Object.fromEntries(game.manifest.options.map((o) => [o.key, o.default]))
}

// ---------------------------------------------------------------- shared loading/checks
async function loadItem(tx: Tx, itemId: string, uid: string): Promise<ItemRow | undefined> {
  const [row] = await tx<ItemRow[]>`
    select i.id, i.contest_id, i.position, i.game_id, i.options, i.puzzle, i.puzzle_key,
           c.kind, c.starts_at, c.ends_at, c.cancelled_at,
           exists (select 1 from public.hidden_games h where h.game_id = i.game_id) as hidden,
           exists (select 1 from public.contest_entries e
                    where e.contest_id = c.id and e.user_id = ${uid}) as joined,
           coalesce((select case when c.kind = 'daily' then gm.daily else gm.contest end
                       from public.game_modes gm where gm.game_id = i.game_id), false) as mode_ok
      from public.contest_items i
      join public.contests c on c.id = i.contest_id
     where i.id = ${itemId}`
  return row
}

/** 게임·권한·시작/취소 검사. 통과하면 game을 돌려준다 */
function checkAccess(
  reg: Registry,
  me: Me,
  item: ItemRow | undefined,
  now: number,
): { game: GameModule } | { fail: Out } {
  if (!item) return { fail: err(403, 'forbidden') }
  const game = reg.getGame(item.game_id)
  const modeOk = game && (item.kind === 'daily' ? game.manifest.modes.daily : game.manifest.modes.contest)
  if (!game || !modeOk || !item.mode_ok) return { fail: err(404, 'unknown_game') }
  // 숨김 게임(숨김 전용 대회 포함)은 관리자만
  if (item.hidden && !me.admin) return { fail: err(403, 'forbidden') }
  // 데일리는 open에서 자동 참가. 나머지는 참가자만
  if (item.kind !== 'daily' && !item.joined) return { fail: err(403, 'not_joined') }
  if (item.cancelled_at) return { fail: err(409, 'ended') }
  if (now < item.starts_at.getTime()) return { fail: err(409, 'not_started') }
  return { game }
}

/**
 * 이 기록의 마감 시각(ms). 데일리이고 게임에 제한 시간이 있으면 처음 연 시각부터 그만큼, 단 그날 자정을 넘지 않는다.
 * 대회와 제한 시간이 없는 게임은 대회 종료 시각.
 */
function deadlineOf(game: GameModule, item: ItemRow, startedAt: number | undefined): number {
  const end = item.ends_at.getTime()
  const limit = item.kind === 'daily' ? game.manifest.dailyTimeLimitSec : null
  if (!limit || startedAt === undefined) return end
  return Math.min(end, startedAt + limit * 1000)
}

function ctxFor(now: number, game: GameModule, item: ItemRow, startedAt: number): Ctx {
  return { now, startedAt, deadline: deadlineOf(game, item, startedAt) }
}

function view(game: GameModule, item: ItemRow, attempt: AttemptRow | undefined, now: number): PlayView {
  const deadline = deadlineOf(game, item, attempt?.started_at.getTime())
  const ended = now >= deadline
  const v: PlayView = {
    item_id: item.id,
    contest_id: item.contest_id,
    game_id: item.game_id,
    options: item.options,
    // 다른 버전의 상태는 지금 로직의 publicState에 넘기지 않는다 (§4.5)
    public_state: attempt && attempt.logic_version === game.logic.version
      ? game.logic.publicState(attempt.state)
      : null,
    // 대회가 끝났으면 더 풀 수 없으므로 끝난 것으로 보여 준다 (정답도 이때 공개된다)
    finished: (attempt?.finished ?? false) || ended,
    score: attempt ? Number(attempt.score) : null,
    action_count: attempt?.action_count ?? 0,
    ends_at: new Date(deadline).toISOString(),
    server_now: now,
  }
  if ((attempt?.finished || ended) && item.puzzle != null) v.reveal = game.logic.reveal(item.puzzle)
  return v
}

async function lockAttempt(tx: Tx, itemId: string, uid: string): Promise<AttemptRow | undefined> {
  const [a] = await tx<AttemptRow[]>`
    select state, logic_version, finished, score, action_count, started_at
      from public.attempts where item_id = ${itemId} and user_id = ${uid}
       for update`
  return a
}

/**
 * §4.5: 버전이 다른 진행 중 기록을 "그 시점 점수"로 확정한다. 저장된 score는 마지막 행동 때의 로직이 매긴
 * "지금 포기했다면 받을 점수"(§4.2, §5.3)이므로 그대로 둔다. 새 버전 로직은 옛 상태에 전혀 호출하지 않는다.
 */
async function finalizeForVersion(tx: Tx, item: ItemRow, uid: string, now: number): Promise<AttemptRow> {
  return await finalizeAt(tx, item, uid, now)
}

/** 진행 중 기록을 저장된 점수 그대로 at 시각에 끝낸다 (버전 변경·데일리 제한 시간 초과) */
async function finalizeAt(tx: Tx, item: ItemRow, uid: string, at: number): Promise<AttemptRow> {
  const [row] = await tx<AttemptRow[]>`
    update public.attempts
       set finished = true, finished_at = ${new Date(at)}
     where item_id = ${item.id} and user_id = ${uid}
     returning state, logic_version, finished, score, action_count, started_at`
  return row
}

// ---------------------------------------------------------------- puzzle generation
/** 잠근 뒤 아직 문제가 없으면 출제한다. 실패(은행 비었음)면 Out */
async function ensurePuzzle(
  tx: Tx,
  deps: Deps,
  game: GameModule,
  item: ItemRow,
  now: number,
): Promise<Out | null> {
  const [locked] = await tx<{ puzzle: unknown; puzzle_key: string | null }[]>`
    select puzzle, puzzle_key from public.contest_items where id = ${item.id} for update`
  if (locked.puzzle != null) {
    item.puzzle = locked.puzzle
    item.puzzle_key = locked.puzzle_key
    return null
  }
  const seedFor = (retry: number) =>
    hmacSeed(deps.secret, `${item.contest_id}:${item.position}:${retry}`)

  let puzzle: unknown
  let key: string
  if (game.manifest.puzzleSource === 'generate') {
    const since = new Date(now - RECENT_DAYS * DAY_MS)
    const recent = await tx<{ puzzle_key: string }[]>`
      select puzzle_key from public.contest_items
       where game_id = ${item.game_id} and puzzle_key is not null and generated_at > ${since}`
    const picked = await pickFresh(
      game.logic,
      item.options,
      seedFor,
      new Set(recent.map((r) => r.puzzle_key)),
    )
    puzzle = picked.puzzle
    key = picked.key
  } else {
    // 미사용 문제를 puzzle_key 순으로 세우고 시드 인덱스부터 돌며, 다른 출제가 잠그지 않은 첫 행을 쓴다
    const ids = await tx<{ id: string }[]>`
      select id from public.puzzle_bank
       where game_id = ${item.game_id} and used_item_id is null
       order by puzzle_key`
    if (ids.length === 0) return err(409, 'bank_empty')
    const start = Math.floor(rngFromSeed(await seedFor(0))() * ids.length)
    let row: { puzzle: unknown; puzzle_key: string } | undefined
    for (let k = 0; k < ids.length && !row; k++) {
      const id = ids[(start + k) % ids.length].id
      ;[row] = await tx<{ puzzle: unknown; puzzle_key: string }[]>`
        select puzzle, puzzle_key from public.puzzle_bank
         where id = ${id} and used_item_id is null
         for update skip locked`
      if (row) await tx`update public.puzzle_bank set used_item_id = ${item.id} where id = ${id}`
    }
    if (!row) return err(409, 'bank_empty')
    puzzle = row.puzzle
    key = row.puzzle_key
  }
  await tx`
    update public.contest_items
       set puzzle = ${tx.json(puzzle as never)}, puzzle_key = ${key},
           logic_version = ${game.logic.version}, generated_at = ${new Date(now)}
     where id = ${item.id}`
  item.puzzle = puzzle
  item.puzzle_key = key
  return null
}

// ---------------------------------------------------------------- open
async function open(deps: Deps, reg: Registry, me: Me, itemId: string): Promise<Out> {
  const now = deps.now()
  return await txOn(deps.sql)(async (tx) => {
    const item = await loadItem(tx, itemId, me.id)
    const access = checkAccess(reg, me, item, now)
    if ('fail' in access) return access.fail
    const { game } = access
    const it = item!
    const live = now < it.ends_at.getTime()

    if (it.kind === 'daily' && live && !it.joined) {
      await tx`
        insert into public.contest_entries (contest_id, user_id) values (${it.contest_id}, ${me.id})
        on conflict do nothing`
    }
    // 시작 후 첫 open에 출제. 종료 뒤에는 새로 출제하지 않는다(풀 사람이 없다)
    if (it.puzzle == null && live) {
      const fail = await ensurePuzzle(tx, deps, game, it, now)
      if (fail) return fail
    }

    let attempt = await lockAttempt(tx, it.id, me.id)
    if (!attempt && live) {
      const ctx = ctxFor(now, game, it, now)
      const state = game.logic.initState(it.puzzle, ctx)
      const score = normalizeScore(game.logic.score(state, ctx))
      await tx`
        insert into public.attempts
          (item_id, user_id, state, logic_version, finished, score, action_count, started_at)
        values (${it.id}, ${me.id}, ${tx.json(state as never)}, ${game.logic.version}, false, ${score}, 0, ${new Date(now)})
        on conflict (item_id, user_id) do nothing`
      attempt = await lockAttempt(tx, it.id, me.id)
    }
    if (attempt && live && !attempt.finished && attempt.logic_version !== game.logic.version) {
      attempt = await finalizeForVersion(tx, it, me.id, now)
      return err(409, 'version_changed', { view: view(game, it, attempt, now) })
    }
    // 데일리 제한 시간이 지났으면 마감 시각에 그 시점 점수로 확정한다
    if (attempt && live && !attempt.finished) {
      const deadline = deadlineOf(game, it, attempt.started_at.getTime())
      if (now >= deadline) attempt = await finalizeAt(tx, it, me.id, deadline)
    }
    return out(200, view(game, it, attempt, now))
  })
}

// ---------------------------------------------------------------- act
async function act(
  deps: Deps,
  reg: Registry,
  me: Me,
  itemId: string,
  expectedCount: number,
  payload: unknown,
): Promise<Out> {
  const now = deps.now()
  return await txOn(deps.sql)(async (tx) => {
    const item = await loadItem(tx, itemId, me.id)
    const access = checkAccess(reg, me, item, now)
    if ('fail' in access) return access.fail
    const { game } = access
    const it = item!

    // 같은 사용자의 동시 행동은 이 행 잠금으로 줄을 선다 (§8)
    const attempt = await lockAttempt(tx, it.id, me.id)
    if (!attempt) return err(409, 'not_opened')
    if (now >= it.ends_at.getTime()) return err(409, 'ended', { view: view(game, it, attempt, now) })
    if (attempt.finished) return err(409, 'finished', { view: view(game, it, attempt, now) })
    if (attempt.logic_version !== game.logic.version) {
      const done = await finalizeForVersion(tx, it, me.id, now)
      return err(409, 'version_changed', { view: view(game, it, done, now) })
    }
    const deadline = deadlineOf(game, it, attempt.started_at.getTime())
    if (now >= deadline) {
      const done = await finalizeAt(tx, it, me.id, deadline)
      return err(409, 'timeout', { view: view(game, it, done, now) })
    }
    if (expectedCount !== attempt.action_count) {
      return err(409, 'stale', { view: view(game, it, attempt, now) })
    }

    const r = step(game.logic, it.puzzle, attempt.state, payload, ctxFor(now, game, it, attempt.started_at.getTime()))
    if (!r.ok) return err(400, 'invalid_action', r.error === undefined ? {} : { message: r.error })

    const at = new Date(now)
    const [saved] = await tx<AttemptRow[]>`
      update public.attempts
         set state = ${tx.json(r.state as never)}, score = ${r.score}, action_count = ${r.actionCount},
             last_action_at = ${at}, finished = ${r.finished},
             finished_at = ${r.finished ? at : null}
       where item_id = ${it.id} and user_id = ${me.id}
       returning state, logic_version, finished, score, action_count, started_at`
    return out(200, view(game, it, saved, now))
  })
}
