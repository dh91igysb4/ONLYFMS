// 온라인 대국 세션(레이싱 설계 §4, §6). 각자 자기 차만 물리로 돌리고 상대 차는 받은 상태의 유령으로 둔다(3번 구조).
// 시간은 서버 시각 기준: 레이스 틱 0 = 출발 시각 - 카운트다운. 화면이 늦게 열리거나 탭이 숨었다 돌아오면
// 그 사이 틱을 한 번에 돌려 따라잡는다(연습과 달리 프레임 상한 없음, 설계 §6.3).
// 도착(또는 제한 시간 미완주)하면 바로 report를 한 번 부르고(아는 상대 기록과 함께) finish를 되풀이해 알린다.
// 먼저 들어온 쪽이 상대를 기다리면 그 사이 창을 닫을 때 기록을 잃는다(최종 리뷰 C2). 맞대 보기는 늦게 들어온 쪽의 opp가 한다.
import { NET_HZ, RACE_SECONDS, TICK_HZ } from './constants.ts'
import { arcLength, progressAt } from './course/index.ts'
import { sideAt } from './course/road.ts'
import type { Course } from './course/types.ts'
import { logic, type RacerReport } from './logic.ts'
import { decode, encode } from './net/codec.ts'
import { carState, resetCar } from './physics/car.ts'
import type { Controls } from './physics/controls.ts'
import { createOpponent, placeOpponent, receiveState, resolveContact, type Opponent } from './physics/opponent.ts'
import type { Rapier } from './physics/rapier.ts'
import { advance, COUNTDOWN_TICKS, createRace, disposeRace, snapshot, type Pose, type Race, type RaceSnapshot } from './race.ts'

const TICK_MS = 1000 / TICK_HZ
const SEND_EVERY = Math.round(TICK_HZ / NET_HZ)
/** 레이스 끝 틱(카운트다운 포함). 여기까지 도착하지 못하면 미완주 */
const LIMIT_TICKS = COUNTDOWN_TICKS + RACE_SECONDS * TICK_HZ
/** hello·finish(꼭 닿아야 하는 드문 메시지)를 되풀이해 보내는 간격(ms) */
const URGENT_EVERY_MS = 500
/** 그리기 보정: 새 패킷으로 위치가 바뀌면 그 차이를 틱마다 이만큼 남기며 줄인다(약 0.1초에 1/3) */
const GLIDE_KEEP = 0.85
/** 이보다 크게 바뀌면(복귀 등 순간이동) 미끄러지지 않고 바로 옮긴다(m) */
const GLIDE_SNAP = 5
/** 출발 칸: 중심선에서 옆으로 */
const GRID_SIDE = 3

/** 플랫폼 실시간 연결(RealtimeLink)에서 쓰는 부분 */
export type LinkLike = {
  send(data: ArrayBuffer, urgent?: boolean): void
  onMessage(cb: (data: ArrayBuffer) => void): () => void
}

export type MatchOpts = {
  mySeat: 0 | 1
  /** 출발 시각(서버 시각 ms) */
  startAt: number
  link: LinkLike
  report(r: RacerReport): void
  /** 시험용: 코스와 로직 버전 */
  course?: string | Course
  version?: number
}

export type MatchPhase = 'waiting' | 'countdown' | 'racing' | 'done' | 'version_mismatch'

export type MatchSession = {
  race: Race
  opp: Opponent
  opts: MatchOpts
  version: number
  unsub: () => void
  /** 상대가 알려 준 로직 버전(모르면 null) */
  peerVersion: number | null
  /** 상대에게서 무엇이든 받았는지 */
  heard: boolean
  /** 상대 완주 틱. undefined = 아직 모름, null = 미완주 */
  oppFinish: number | null | undefined
  /** 내 완주 틱. undefined = 달리는 중, null = 미완주 */
  myFinish: number | null | undefined
  /** 내가 끝난 서버 시각 */
  doneAt: number | null
  reported: boolean
  /** 출발 전 상대와 화면 버전이 달라 멈췄다(둘 다 멈추고 무효로 보고) */
  mismatch: boolean
  /** 멈춘 이유가 내 화면이 옛 버전이라서(새로고침할 쪽) */
  stale: boolean
  lastSlot: number
  lastUrgent: number
  oppView: { pose: Pose; prev: Pose; fresh: boolean } | null
  /** 서버 시각이 지금 틱과 다음 틱 사이 어디쯤인지(그리기 보간, 0..1) */
  alpha: number
  /** 그리기 전용: 그린 위치 - 실제 유령 위치(패킷 보정 때 생겨 줄어든다) */
  glide: { x: number; y: number; z: number }
  glideFor: StatePacketRef
}

type StatePacketRef = object | null

export function createMatch(R: Rapier, opts: MatchOpts): MatchSession {
  const race = createRace(R, opts.course ?? 'neon-1')
  // 좌석마다 출발 칸을 옆으로 비켜 세운다(같은 자리에 겹치지 않게)
  const c = race.course
  const side = sideAt(c, 0)
  const lateral = opts.mySeat === 0 ? GRID_SIDE : -GRID_SIDE
  resetCar(race.car, {
    pos: { x: c.start.pos.x + side.x * lateral, y: c.start.pos.y, z: c.start.pos.z + side.z * lateral },
    yaw: c.start.yaw,
  })
  const s0 = carState(race.car)
  race.prevPose = { pos: s0.pos, quat: s0.quat }
  const s: MatchSession = {
    race, opp: createOpponent(race.pw), opts, version: opts.version ?? logic.version, unsub: () => {},
    peerVersion: null, heard: false, oppFinish: undefined, myFinish: undefined, doneAt: null, reported: false,
    mismatch: false, stale: false, lastSlot: -1, lastUrgent: -Infinity, oppView: null, alpha: 0, glide: { x: 0, y: 0, z: 0 }, glideFor: null,
  }
  s.unsub = opts.link.onMessage((d) => onPacket(s, d))
  return s
}

function onPacket(s: MatchSession, d: ArrayBuffer): void {
  const p = decode(d)
  if (!p) return
  s.heard = true
  if (p.kind === 'state') receiveState(s.opp, p, s.race.elapsed)
  else if (p.kind === 'finish') s.oppFinish = p.ticks
  else if (p.kind === 'hello') {
    s.peerVersion = p.version
    // 출발 전에만 막는다(달리는 중에 끊지 않는다). 둘 다 멈추고 무효로 보고한다(최종 리뷰 I2).
    // 버전은 오르기만 하므로 낮은 쪽이 옛 화면(새로고침할 쪽)이다
    if (p.version !== s.version && s.race.elapsed <= COUNTDOWN_TICKS && !s.mismatch && s.myFinish === undefined) {
      s.mismatch = true
      s.stale = p.version > s.version
      s.reported = true
      s.opts.report({ my: null, opp: null, met: true, abort: true })
    }
  }
}

function sendState(s: MatchSession): void {
  const st = carState(s.race.car)
  s.opts.link.send(encode({
    kind: 'state', tick: s.race.elapsed, pos: st.pos, quat: st.quat, vel: st.vel, nitro: s.race.nitro.burning,
  }))
}

function finishRace(s: MatchSession, ticks: number | null, now: number): void {
  if (s.myFinish !== undefined) return
  s.myFinish = ticks
  s.doneAt = now
  s.lastUrgent = -Infinity
}

/**
 * 서버 시각 serverNow까지 따라잡는다. 틱마다: 상대 유령 놓기 → 내 차 1틱 → 충돌 풀기.
 * 내 상태는 NET_HZ 칸을 넘을 때 한 번(따라잡는 동안 여러 칸을 넘어도 마지막 상태 하나만) 보낸다.
 */
export function stepMatch(s: MatchSession, serverNow: number, controls: Controls): void {
  if (s.mismatch) {
    // 멈춘 쪽도 버전을 계속 알려 상대가 멈추게 한다
    if (serverNow - s.lastUrgent >= URGENT_EVERY_MS) {
      s.lastUrgent = serverNow
      s.opts.link.send(encode({ kind: 'hello', version: s.version }), true)
    }
    return
  }
  const { race } = s
  const origin = s.opts.startAt - COUNTDOWN_TICKS * TICK_MS
  // 1/60 ms 나눗셈의 부동소수 오차로 한 틱 모자라지 않게
  const exact = ((serverNow - origin) * TICK_HZ) / 1000
  const target = Math.min(LIMIT_TICKS, Math.floor(exact + 1e-6))
  // 레이스가 다 끝난 뒤 처음 연 화면: 한 번도 달리지 않았으니 통째로 돌리지 않고 미완주로
  if (race.elapsed === 0 && target >= LIMIT_TICKS && s.myFinish === undefined) finishRace(s, null, serverNow)
  else {
    while (race.elapsed < target) {
      placeIt(s)
      advance(race, TICK_MS, controls)
      resolveContact(s.opp, race.car, race.elapsed)
      if (race.finishTicks !== null) finishRace(s, race.finishTicks, origin + race.elapsed * TICK_MS)
    }
    if (race.elapsed >= LIMIT_TICKS && race.finishTicks === null) finishRace(s, null, serverNow)
  }
  s.alpha = Math.min(1, Math.max(0, exact - race.elapsed))

  const slot = Math.floor(race.elapsed / SEND_EVERY)
  if (target >= 0 && slot !== s.lastSlot && race.elapsed < LIMIT_TICKS) {
    s.lastSlot = slot
    sendState(s)
  }
  if (serverNow - s.lastUrgent >= URGENT_EVERY_MS) {
    s.lastUrgent = serverNow
    // 출발 전에는 버전을, 끝난 뒤에는 완주 기록을 되풀이해 알린다(재전송 없는 전송이라)
    if (race.elapsed <= COUNTDOWN_TICKS) s.opts.link.send(encode({ kind: 'hello', version: s.version }), true)
    if (s.myFinish !== undefined) s.opts.link.send(encode({ kind: 'finish', ticks: s.myFinish }), true)
  }

  if (!s.reported && s.myFinish !== undefined) {
    s.reported = true
    const r: RacerReport = { my: s.myFinish, opp: s.oppFinish ?? null }
    if (s.heard) r.met = true
    s.opts.report(r)
  }
}

/**
 * 유령을 이번 틱에 놓고 그릴 자세를 정한다. 충돌은 실제 위치(placeOpponent)로, 그리기는 새 패킷이 와서 위치가 바뀐
 * 만큼을 남겨 두었다가 줄여 미끄러지듯 따라가게 한다(사용자 시험: 상대 차가 끊겨 보임).
 */
function placeIt(s: MatchSession): void {
  const p = placeOpponent(s.opp, s.race.elapsed)
  if (!p) return
  const raw = p.pose.pos
  const g = s.glide
  const packet = s.opp.latest?.p ?? null
  if (packet !== s.glideFor && s.oppView) {
    // 새 패킷: 직전에 그린 자리와 새 실제 자리의 차이를 보정으로 남긴다
    const drawn = s.oppView.pose.pos
    const dx = drawn.x - raw.x
    const dy = drawn.y - raw.y
    const dz = drawn.z - raw.z
    if (Math.hypot(dx, dy, dz) > GLIDE_SNAP) { g.x = 0; g.y = 0; g.z = 0 } else { g.x = dx; g.y = dy; g.z = dz }
  } else {
    g.x *= GLIDE_KEEP
    g.y *= GLIDE_KEEP
    g.z *= GLIDE_KEEP
  }
  s.glideFor = packet
  const pose: Pose = { pos: { x: raw.x + g.x, y: raw.y + g.y, z: raw.z + g.z }, quat: p.pose.quat }
  const prev = s.oppView?.pose ?? pose
  s.oppView = { pose, prev, fresh: p.fresh }
}

export type MatchView = {
  phase: MatchPhase
  /** version_mismatch일 때 내 화면이 옛 버전인지 */
  stale: boolean
  snap: RaceSnapshot
  opponent: { pose: Pose; prev: Pose; fresh: boolean } | null
  /** 그리기 전용 순위(진행도 비교). 상대 소식이 없으면 null */
  rank: 1 | 2 | null
  heard: boolean
  myFinish: number | null | undefined
  oppFinish: number | null | undefined
  alpha: number
}

export function matchView(s: MatchSession): MatchView {
  const snap = snapshot(s.race)
  let phase: MatchPhase
  if (s.mismatch) phase = 'version_mismatch'
  else if (s.myFinish !== undefined) phase = 'done'
  else if (s.race.elapsed === 0) phase = 'waiting'
  else if (snap.countdown !== null) phase = 'countdown'
  else phase = 'racing'
  return { phase, stale: s.stale, snap, opponent: s.oppView, rank: rankOf(s, snap), heard: s.heard, myFinish: s.myFinish, oppFinish: s.oppFinish, alpha: s.alpha }
}

function rankOf(s: MatchSession, snap: RaceSnapshot): 1 | 2 | null {
  const mine = s.myFinish
  const theirs = s.oppFinish
  if (typeof mine === 'number' && typeof theirs === 'number') return mine <= theirs ? 1 : 2
  if (typeof mine === 'number') return 1
  if (typeof theirs === 'number') return 2
  if (!s.oppView) return null
  const c = s.race.course
  const arc = arcLength(c)
  const p = progressAt(c, s.oppView.pose.pos, s.race.progressIndex)
  const opp = Math.min(1, arc[p.index] / arc[c.finish])
  return snap.progress >= opp ? 1 : 2
}

export function disposeMatch(s: MatchSession): void {
  s.unsub()
  disposeRace(s.race)
}
