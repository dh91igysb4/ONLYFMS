// 1대1 대전 핸들러 (대전 설계 §4, §7). 시각은 모두 deps.now()(서버 시계)에서 온다.
// 게임 상태(state)와 초대 코드는 DuelView에 넣지 않는다. 브라우저에는 logic.view 결과만 간다.
// 모든 변경은 대국 행을 `for update`로 잠근 트랜잭션 안에서 하고, 커밋 뒤에 "바뀜" 신호만 보낸다.
import type { Sql, Tx } from '../play/db.ts'
import { txOn } from '../play/db.ts'
import { getDuel } from '../../../src/games/index.ts'
import type { DuelLogic, DuelModule, Manifest, Seat } from '../../../src/games/types.ts'
import { hmacSeed, rngFromSeed } from '../../../src/shared/rng.ts'

export type DuelDeps = {
  sql: Sql
  now: () => number
  getUserId(req: Request): Promise<string | null>
  secret: string
  broadcast(matchId: string, payload: { action_no: number; status: string }): Promise<void>
  registry?: { getDuel(id: string): DuelModule | undefined }
}

export type DuelView = {
  match_id: string
  game_id: string
  options: Record<string, string>
  rated: boolean
  visibility: 'public' | 'invite'
  status: Status
  turn_seconds: number
  players: { id: string; handle: string | null; rating: number }[]
  my_seat: Seat | null
  to_move: Seat | null
  action_no: number
  turn_deadline: string | null
  server_now: number
  view: unknown
  winner: Seat | null
  end_reason: string | null
  final_scores: [number, number] | null
  rating_change?: { before: number; after: number }
}

type Status = 'waiting' | 'active' | 'finished' | 'void'
type EndReason = 'normal' | 'resign' | 'timeout' | 'void'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE_RE = /^[a-z0-9]{10}$/
const WAITING_LIMIT = 3
const WAITING_TTL_MS = 10 * 60 * 1000
/** 시간 초과 한 턴에서 timeoutAction을 적용하는 최대 횟수 (설계 §3.2) */
const MAX_AUTO_PER_TURN = 8
/** 행동 payload의 JSON 최대 길이 */
const MAX_PAYLOAD_CHARS = 2048
const DEFAULT_TURN = { choices: [60], default: 60 }

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

type Me = { id: string; admin: boolean }
type Registry = { getDuel(id: string): DuelModule | undefined }
// deno-lint-ignore no-explicit-any
type Logic = DuelLogic<any, any, any>

type MatchRow = {
  id: string
  game_id: string
  options: Record<string, string>
  logic_version: number
  rated: boolean
  visibility: 'public' | 'invite'
  status: Status
  created_by: string | null
  players: string[] | null
  state: unknown
  action_no: number
  turn_no: number
  turn_seconds: number
  turn_deadline: Date | null
  timeouts: number[]
  moved: boolean[]
  winner: number | null
  end_reason: EndReason | null
  final_scores: number[] | null
  created_at: Date
  started_at: Date | null
  ended_at: Date | null
}

/** 트랜잭션 결과: 응답과, 커밋 뒤 보낼 신호(바뀐 경우) */
type TxResult = { out: Out; signal?: { matchId: string; action_no: number; status: string } }

// ---------------------------------------------------------------- entry
export async function handle(req: Request, deps: DuelDeps): Promise<Response> {
  try {
    return json(await route(req, deps))
  } catch (e) {
    console.error('duel: unexpected error', e)
    return json(err(500, 'internal'))
  }
}

async function route(req: Request, deps: DuelDeps): Promise<Out> {
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
  const b = body

  const [p] = await deps.sql<{ status: string; is_admin: boolean }[]>`
    select status, is_admin from public.profiles where id = ${uid}`
  if (!p || p.status !== 'approved') return err(403, 'not_approved')
  const me: Me = { id: uid, admin: p.is_admin }
  const reg = deps.registry ?? { getDuel }

  const matchId = (): string | null =>
    typeof b.match_id === 'string' && UUID_RE.test(b.match_id) ? b.match_id : null

  switch (b.action) {
    case 'create':
      return await create(deps, reg, me, b)
    case 'join': {
      const id = matchId()
      const code = typeof b.code === 'string' && CODE_RE.test(b.code) ? b.code : null
      if (!id && !code) return bad('match_id 또는 code가 필요해요')
      return await run(deps, (tx) => join(tx, deps, reg, me, id ? { id } : { code: code! }))
    }
    case 'cancel':
    case 'view':
    case 'tick':
    case 'resign': {
      const id = matchId()
      if (!id) return bad('match_id가 잘못됐어요')
      const fn = { cancel, view: viewAction, tick, resign }[b.action as 'cancel' | 'view' | 'tick' | 'resign']
      return await run(deps, (tx) => fn(tx, deps, reg, me, id))
    }
    case 'move': {
      const id = matchId()
      if (!id) return bad('match_id가 잘못됐어요')
      const ec = b.expected_action_no
      if (typeof ec !== 'number' || !Number.isInteger(ec) || ec < 0) return bad('expected_action_no가 잘못됐어요')
      const payload = b.payload
      if (!isPlainObject(payload)) return bad('행동 형식이 잘못됐어요')
      const size = JSON.stringify(payload).length
      if (size > MAX_PAYLOAD_CHARS) return bad('행동이 너무 커요')
      return await run(deps, (tx) => move(tx, deps, reg, me, id, ec, payload))
    }
    default:
      return bad('알 수 없는 요청이에요')
  }
}

/** 트랜잭션을 돌리고, 커밋된 뒤에 신호를 보낸다. 신호 실패는 로그만 남긴다 */
async function run(deps: DuelDeps, fn: (tx: Tx) => Promise<TxResult>): Promise<Out> {
  const r = await txOn(deps.sql)(fn)
  if (r.signal) {
    const { matchId, ...payload } = r.signal
    try {
      await deps.broadcast(matchId, payload)
    } catch (e) {
      console.error('duel: broadcast failed', matchId, e)
    }
  }
  return r.out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// ---------------------------------------------------------------- helpers
async function rngFor(secret: string, matchId: string, actionNo: number): Promise<() => number> {
  return rngFromSeed(await hmacSeed(secret, `duel:${matchId}:${actionNo}`))
}

async function isHidden(tx: Tx | Sql, gameId: string): Promise<boolean> {
  const [h] = await tx<{ hidden: boolean }[]>`
    select exists (select 1 from public.hidden_games where game_id = ${gameId}) as hidden`
  return h.hidden
}

const MATCH_COLS = `id, game_id, options, logic_version, rated, visibility, status, created_by, players, state,
  action_no, turn_no, turn_seconds, turn_deadline, timeouts, moved, winner, end_reason, final_scores,
  created_at, started_at, ended_at`

async function lockById(tx: Tx, id: string): Promise<MatchRow | undefined> {
  const [m] = await tx.unsafe<MatchRow[]>(`select ${MATCH_COLS} from public.duel_matches where id = $1 for update`, [id])
  return m
}

async function lockByCode(tx: Tx, code: string): Promise<MatchRow | undefined> {
  const [m] = await tx.unsafe<MatchRow[]>(
    `select ${MATCH_COLS} from public.duel_matches where invite_code = $1 for update`,
    [code],
  )
  return m
}

async function save(tx: Tx, m: MatchRow): Promise<void> {
  await tx`
    update public.duel_matches
       set logic_version = ${m.logic_version},
           status        = ${m.status}::public.duel_status,
           players       = ${m.players ? tx.array(m.players) : null}::uuid[],
           state         = ${m.state == null ? null : tx.json(m.state as never)},
           action_no     = ${m.action_no},
           turn_no       = ${m.turn_no},
           turn_deadline = ${m.turn_deadline},
           timeouts      = ${tx.array(m.timeouts)}::int[],
           moved         = ${tx.array(m.moved)}::boolean[],
           winner        = ${m.winner},
           end_reason    = ${m.end_reason}::public.duel_end_reason,
           final_scores  = ${m.final_scores ? tx.array(m.final_scores) : null}::int[],
           started_at    = ${m.started_at},
           ended_at      = ${m.ended_at}
     where id = ${m.id}`
  // Elo는 랭크 대국이 finished가 되는 이 트랜잭션 안에서 (한 번만 반영됨은 함수가 보장)
  if (m.status === 'finished' && m.rated) await tx`select public._duel_apply_elo(${m.id})`
}

async function recordMove(tx: Tx, m: MatchRow, seat: Seat, action: unknown, auto: boolean, now: number) {
  await tx`
    insert into public.duel_moves (match_id, action_no, seat, action, auto, created_at)
    values (${m.id}, ${m.action_no}, ${seat}, ${tx.json(action as never)}, ${auto}, ${new Date(now)})`
}

/** 종료. 어느 한쪽이라도 첫 행동 전이면 무효(설계 §4.7) */
function finish(m: MatchRow, winner: Seat | null, reason: EndReason, now: number, scores?: [number, number]) {
  m.status = 'finished'
  m.end_reason = reason
  m.winner = winner
  m.final_scores = scores ?? null
  m.turn_deadline = null
  m.ended_at = new Date(now)
  if (m.moved.includes(false)) voidMatch(m, now)
}

function voidMatch(m: MatchRow, now: number) {
  m.status = 'void'
  m.end_reason = 'void'
  m.winner = null
  m.turn_deadline = null
  m.ended_at = new Date(now)
}

const signalOf = (m: MatchRow) => ({ matchId: m.id, action_no: m.action_no, status: m.status })

function seatOf(m: MatchRow, uid: string): Seat | null {
  const i = m.players?.indexOf(uid) ?? -1
  return i === 0 || i === 1 ? i : null
}

function isMember(m: MatchRow, uid: string): boolean {
  return seatOf(m, uid) !== null || (m.created_by !== null && m.created_by === uid)
}

function expireIfStale(m: MatchRow, now: number): boolean {
  if (m.status === 'waiting' && now - m.created_at.getTime() >= WAITING_TTL_MS) {
    voidMatch(m, now)
    return true
  }
  return false
}

function safe<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (e) {
    console.error(`duel: logic.${label} threw`, e)
    return fallback
  }
}

async function buildView(tx: Tx, m: MatchRow, me: Me, logic: Logic | undefined, now: number): Promise<DuelView> {
  const players = await tx<{ id: string; handle: string | null; rating: number }[]>`
    select u.uid as id, p.handle::text as handle, coalesce(r.rating, 1000)::int as rating
      from unnest(coalesce(${m.players ? tx.array(m.players) : null}::uuid[],
                           array_remove(array[${m.created_by}::uuid], null))) with ordinality as u(uid, ord)
      left join public.profiles p on p.id = u.uid
      left join public.duel_ratings r on r.user_id = u.uid and r.game_id = ${m.game_id}
     order by u.ord`
  const mySeat = seatOf(m, me.id)
  // 다른 버전의 상태는 지금 로직에 넘기지 않는다
  const usable = logic && m.state != null && m.logic_version === logic.version ? logic : null
  const live = m.status === 'active'
  const v: DuelView = {
    match_id: m.id,
    game_id: m.game_id,
    options: m.options,
    rated: m.rated,
    visibility: m.visibility,
    status: m.status,
    turn_seconds: m.turn_seconds,
    players: players.map((p) => ({ id: p.id, handle: p.handle, rating: Number(p.rating) })),
    my_seat: mySeat,
    to_move: live && usable ? safe('toMove', () => usable.toMove(m.state), null) : null,
    action_no: m.action_no,
    turn_deadline: m.turn_deadline ? m.turn_deadline.toISOString() : null,
    server_now: now,
    // 진행 중에는 내 좌석의 화면, 종료 후·관전은 viewer = null (설계 §3.2)
    view: usable ? safe('view', () => usable.view(m.state, live ? mySeat : null), null) : null,
    winner: m.winner === 0 || m.winner === 1 ? m.winner : null,
    end_reason: m.end_reason,
    final_scores: m.final_scores && m.final_scores.length === 2 ? [m.final_scores[0], m.final_scores[1]] : null,
  }
  const [rc] = await tx<{ before: number; after: number }[]>`
    select before, after from public.duel_rating_changes where match_id = ${m.id} and user_id = ${me.id}`
  if (rc) v.rating_change = { before: rc.before, after: rc.after }
  return v
}

/** 대국 행을 잠그고 공통 검사(없음·참가자 아님·게임 없음)를 한다 */
async function loadMember(
  tx: Tx,
  reg: Registry,
  me: Me,
  id: string,
): Promise<{ m: MatchRow; game: DuelModule | undefined } | { fail: Out }> {
  const m = await lockById(tx, id)
  if (!m) return { fail: err(404, 'not_found') }
  if (!isMember(m, me.id)) return { fail: err(403, 'not_player') }
  return { m, game: reg.getDuel(m.game_id) }
}

/** 진행 중 대국의 로직 버전이 다르면 무효 처리하고 409 version_changed (설계 §4.7, §10) */
async function voidIfVersionChanged(tx: Tx, m: MatchRow, me: Me, logic: Logic, now: number): Promise<TxResult | null> {
  if (m.status !== 'active' || m.logic_version === logic.version) return null
  voidMatch(m, now)
  await save(tx, m)
  return { out: err(409, 'version_changed', { view: await buildView(tx, m, me, logic, now) }), signal: signalOf(m) }
}

/** 끝난/대기 대국에 진행 행동을 보낸 경우의 409 */
async function notActive(tx: Tx, m: MatchRow, me: Me, logic: Logic | undefined, now: number): Promise<TxResult> {
  const code = m.status === 'waiting' ? 'not_waiting' : 'finished'
  return { out: err(409, code, { view: await buildView(tx, m, me, logic, now) }) }
}

// ---------------------------------------------------------------- timeouts
/**
 * 마감이 지난 턴을 모두 처리한다(설계 §4.4). 턴마다 timeoutAction을 turnNo가 바뀌거나 게임이 끝날 때까지
 * 하나씩 적용(최대 8번, 행동마다 그 순번의 난수)하고, 그 좌석의 연속 초과를 1 올린다. 2회면 상대 승.
 * 새 마감 = 이전 마감 + turn_seconds. 바뀐 것이 있으면 true.
 */
async function runTimeouts(tx: Tx, deps: DuelDeps, m: MatchRow, logic: Logic, now: number): Promise<boolean> {
  let changed = false
  while (m.status === 'active' && m.turn_deadline && m.turn_deadline.getTime() <= now) {
    changed = true
    const seat = logic.toMove(m.state) as Seat
    const startTurn = logic.turnNo(m.state)
    let advanced = false
    for (let i = 0; i < MAX_AUTO_PER_TURN; i++) {
      let action: unknown
      let r: { state: unknown } | { error: string }
      try {
        action = logic.timeoutAction(m.state)
        r = logic.apply(m.state, seat, action, await rngFor(deps.secret, m.id, m.action_no))
      } catch (e) {
        console.error('duel: timeout action threw', m.id, e)
        break
      }
      if ('error' in r) {
        console.error('duel: timeout action rejected', m.id, r.error)
        break
      }
      await recordMove(tx, m, seat, action, true, now)
      m.state = r.state
      m.action_no += 1
      if (logic.turnNo(m.state) !== startTurn || logic.result(m.state).over) {
        advanced = true
        break
      }
    }
    m.turn_no = logic.turnNo(m.state)
    m.timeouts = [...m.timeouts]
    m.timeouts[seat] += 1
    const res = logic.result(m.state)
    // 연속 2회 초과, 또는 기본 수로 턴을 넘기지 못하면(로직 오류) 그 좌석의 시간 초과 패
    if (m.timeouts[seat] >= 2 || !advanced) {
      finish(m, seat === 0 ? 1 : 0, 'timeout', now)
    } else if (res.over) {
      finish(m, res.winner, 'normal', now, res.scores)
    } else {
      m.turn_deadline = new Date(m.turn_deadline.getTime() + m.turn_seconds * 1000)
    }
  }
  return changed
}

// ---------------------------------------------------------------- create
function parseOptions(manifest: Manifest, raw: unknown): Record<string, string> | null {
  const defaults = Object.fromEntries(manifest.options.map((o) => [o.key, o.default]))
  if (raw === undefined || raw === null) return defaults
  if (!isPlainObject(raw)) return null
  for (const [k, v] of Object.entries(raw)) {
    const opt = manifest.options.find((o) => o.key === k)
    if (!opt || typeof v !== 'string' || !opt.choices.some((c) => c.value === v)) return null
  }
  return { ...defaults, ...(raw as Record<string, string>) }
}

async function create(deps: DuelDeps, reg: Registry, me: Me, b: Record<string, unknown>): Promise<Out> {
  if (typeof b.game_id !== 'string') return bad('game_id가 필요해요')
  const game = reg.getDuel(b.game_id)
  if (!game) return err(404, 'unknown_game')
  const options = parseOptions(game.manifest, b.options)
  if (!options) return bad('설정이 잘못됐어요')
  if (typeof b.rated !== 'boolean') return bad('rated가 잘못됐어요')
  if (b.visibility !== 'public' && b.visibility !== 'invite') return bad('visibility가 잘못됐어요')
  const turn = game.manifest.duel?.turnSeconds ?? DEFAULT_TURN
  const ts = b.turn_seconds === undefined ? turn.default : b.turn_seconds
  if (typeof ts !== 'number' || !turn.choices.includes(ts)) return bad('턴 시간이 잘못됐어요')
  const rated = b.rated
  const visibility = b.visibility
  const now = deps.now()

  return await txOn(deps.sql)(async (tx) => {
    if ((await isHidden(tx, game.manifest.id)) && !me.admin) return err(404, 'unknown_game')
    // 대기 대국 수 검사를 직렬화한다(같은 사람의 동시 생성)
    await tx`select 1 from public.profiles where id = ${me.id} for update`
    await tx`
      update public.duel_matches
         set status = 'void', end_reason = 'void', ended_at = ${new Date(now)}
       where created_by = ${me.id} and status = 'waiting' and created_at <= ${new Date(now - WAITING_TTL_MS)}`
    const [{ n }] = await tx<{ n: number }[]>`
      select count(*)::int as n from public.duel_matches where created_by = ${me.id} and status = 'waiting'`
    if (n >= WAITING_LIMIT) return err(409, 'too_many_waiting')
    // Ruling T4-a: 공개 대국에도 초대 코드를 만든다(링크 공유용)
    const [m] = await tx<{ id: string; invite_code: string }[]>`
      insert into public.duel_matches
        (game_id, options, logic_version, rated, visibility, invite_code, created_by, turn_seconds, created_at)
      values (${game.manifest.id}, ${tx.json(options)}, ${game.logic.version}, ${rated},
              ${visibility}::public.duel_visibility, public._new_invite_code(), ${me.id}, ${ts}, ${new Date(now)})
      returning id, invite_code`
    return out(200, { match_id: m.id, invite_code: m.invite_code })
  })
}

// ---------------------------------------------------------------- join
async function join(
  tx: Tx,
  deps: DuelDeps,
  reg: Registry,
  me: Me,
  key: { id: string } | { code: string },
): Promise<TxResult> {
  const now = deps.now()
  const m = 'id' in key ? await lockById(tx, key.id) : await lockByCode(tx, key.code)
  if (!m) return { out: err(404, 'not_found') }
  const game = reg.getDuel(m.game_id)
  // 이미 참가자면 그 대국 화면 (멱등)
  if (seatOf(m, me.id) !== null) return { out: out(200, await buildView(tx, m, me, game?.logic, now)) }
  if (m.status === 'active' || m.status === 'finished') return { out: err(409, 'full') }
  if (m.status === 'void') return { out: err(409, 'not_waiting') }
  if (m.created_by === me.id) return { out: err(409, 'own_match') }
  if (!game) return { out: err(404, 'unknown_game') }
  if ((await isHidden(tx, m.game_id)) && !me.admin) return { out: err(404, 'unknown_game') }
  // 10분 지난 대기 대국, 만든 사람이 지워진 대국은 시작할 수 없다
  const expired = expireIfStale(m, now)
  if (expired || m.created_by === null) {
    if (!expired) voidMatch(m, now)
    await save(tx, m)
    return { out: err(409, 'not_waiting') }
  }

  // 선공: action_no = -1 시드의 첫 값 < 0.5면 참가자. 같은 난수열의 나머지로 init
  const rng = await rngFor(deps.secret, m.id, -1)
  const joinerFirst = rng() < 0.5
  const logic = game.logic
  m.players = joinerFirst ? [me.id, m.created_by] : [m.created_by, me.id]
  m.state = logic.init(rng, m.options)
  // 상태는 지금 로직으로 만든다
  m.logic_version = logic.version
  m.status = 'active'
  m.action_no = 0
  m.turn_no = logic.turnNo(m.state)
  m.turn_deadline = new Date(now + m.turn_seconds * 1000)
  m.started_at = new Date(now)
  await save(tx, m)
  return { out: out(200, await buildView(tx, m, me, logic, now)), signal: signalOf(m) }
}

// ---------------------------------------------------------------- cancel / view
async function cancel(tx: Tx, deps: DuelDeps, reg: Registry, me: Me, id: string): Promise<TxResult> {
  const now = deps.now()
  const m = await lockById(tx, id)
  if (!m) return { out: err(404, 'not_found') }
  if (m.created_by !== me.id) return { out: err(403, 'not_player') }
  const logic = reg.getDuel(m.game_id)?.logic
  if (m.status !== 'waiting') return { out: err(409, 'not_waiting', { view: await buildView(tx, m, me, logic, now) }) }
  voidMatch(m, now)
  await save(tx, m)
  return { out: out(200, await buildView(tx, m, me, logic, now)), signal: signalOf(m) }
}

async function viewAction(tx: Tx, deps: DuelDeps, reg: Registry, me: Me, id: string): Promise<TxResult> {
  const now = deps.now()
  const r = await loadMember(tx, reg, me, id)
  if ('fail' in r) return { out: r.fail }
  const { m, game } = r
  if (expireIfStale(m, now)) {
    await save(tx, m)
    return { out: out(200, await buildView(tx, m, me, game?.logic, now)), signal: signalOf(m) }
  }
  if (game) {
    const changed = await voidIfVersionChanged(tx, m, me, game.logic, now)
    if (changed) return changed
  }
  return { out: out(200, await buildView(tx, m, me, game?.logic, now)) }
}

// ---------------------------------------------------------------- move
async function move(
  tx: Tx,
  deps: DuelDeps,
  reg: Registry,
  me: Me,
  id: string,
  expected: number,
  payload: Record<string, unknown>,
): Promise<TxResult> {
  const now = deps.now()
  const r = await loadMember(tx, reg, me, id)
  if ('fail' in r) return { out: r.fail }
  const { m, game } = r
  if (m.status !== 'active') return await notActive(tx, m, me, game?.logic, now)
  if (!game) return { out: err(404, 'unknown_game') }
  const logic = game.logic
  const vc = await voidIfVersionChanged(tx, m, me, logic, now)
  if (vc) return vc

  // 마감이 지났으면 시간 초과를 먼저 처리하고, 이 행동은 늦은 것으로 거절한다
  if (m.turn_deadline && m.turn_deadline.getTime() <= now) {
    await runTimeouts(tx, deps, m, logic, now)
    await save(tx, m)
    return { out: err(409, 'stale', { view: await buildView(tx, m, me, logic, now) }), signal: signalOf(m) }
  }
  const seat = seatOf(m, me.id)
  if (seat === null || logic.toMove(m.state) !== seat) {
    return { out: err(409, 'not_your_turn', { view: await buildView(tx, m, me, logic, now) }) }
  }
  if (expected !== m.action_no) {
    return { out: err(409, 'stale', { view: await buildView(tx, m, me, logic, now) }) }
  }

  let res: { state: unknown } | { error: string }
  try {
    res = logic.apply(m.state, seat, payload, await rngFor(deps.secret, m.id, m.action_no))
  } catch (e) {
    console.error('duel: logic.apply threw', m.id, e)
    return { out: bad('잘못된 행동이에요') }
  }
  if ('error' in res) return { out: err(400, 'invalid_action', { message: res.error }) }

  await recordMove(tx, m, seat, payload, false, now)
  const prevTurn = m.turn_no
  m.state = res.state
  m.action_no += 1
  m.moved = [...m.moved]
  m.moved[seat] = true
  m.turn_no = logic.turnNo(m.state)
  // 턴이 넘어갔을 때만 마감을 새로 잡고 연속 초과를 지운다 (한 턴 안의 여러 행동은 같은 마감)
  if (m.turn_no !== prevTurn) {
    m.timeouts = [...m.timeouts]
    m.timeouts[seat] = 0
    m.turn_deadline = new Date(now + m.turn_seconds * 1000)
  }
  const result = logic.result(m.state)
  if (result.over) finish(m, result.winner, 'normal', now, result.scores)
  await save(tx, m)
  return { out: out(200, await buildView(tx, m, me, logic, now)), signal: signalOf(m) }
}

// ---------------------------------------------------------------- tick / resign
async function tick(tx: Tx, deps: DuelDeps, reg: Registry, me: Me, id: string): Promise<TxResult> {
  const now = deps.now()
  const r = await loadMember(tx, reg, me, id)
  if ('fail' in r) return { out: r.fail }
  const { m, game } = r
  if (m.status !== 'active') return await notActive(tx, m, me, game?.logic, now)
  if (!game) return { out: err(404, 'unknown_game') }
  const vc = await voidIfVersionChanged(tx, m, me, game.logic, now)
  if (vc) return vc
  if (!m.turn_deadline || now < m.turn_deadline.getTime()) {
    return { out: err(409, 'not_due', { view: await buildView(tx, m, me, game.logic, now) }) }
  }
  await runTimeouts(tx, deps, m, game.logic, now)
  await save(tx, m)
  return { out: out(200, await buildView(tx, m, me, game.logic, now)), signal: signalOf(m) }
}

async function resign(tx: Tx, deps: DuelDeps, reg: Registry, me: Me, id: string): Promise<TxResult> {
  const now = deps.now()
  const r = await loadMember(tx, reg, me, id)
  if ('fail' in r) return { out: r.fail }
  const { m, game } = r
  if (m.status !== 'active') return await notActive(tx, m, me, game?.logic, now)
  const seat = seatOf(m, me.id)
  if (seat === null) return { out: err(403, 'not_player') }
  if (game) {
    const vc = await voidIfVersionChanged(tx, m, me, game.logic, now)
    if (vc) return vc
  }
  finish(m, seat === 0 ? 1 : 0, 'resign', now)
  await save(tx, m)
  return { out: out(200, await buildView(tx, m, me, game?.logic, now)), signal: signalOf(m) }
}
