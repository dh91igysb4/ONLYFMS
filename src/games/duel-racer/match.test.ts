import { beforeAll, expect, test } from 'vitest'
import { NET_HZ, RACE_SECONDS, TICK_HZ } from './constants.ts'
import { flatCourse } from './course/testCourses.ts'
import type { RacerReport } from './logic.ts'
import { createMatch, disposeMatch, matchView, stepMatch, type LinkLike, type MatchSession } from './match.ts'
import { decode, encode } from './net/codec.ts'
import { NO_CONTROLS, type Controls } from './physics/controls.ts'
import { loadRapier, type Rapier } from './physics/rapier.ts'
import { COUNTDOWN_TICKS, snapshot } from './race.ts'

let R: Rapier
beforeAll(async () => { R = await loadRapier() })

const GAS: Controls = { ...NO_CONTROLS, throttle: 1 }
const START = 100_000
const COUNTDOWN_MS = (COUNTDOWN_TICKS / TICK_HZ) * 1000

/** 서로 이어진 가짜 연결 둘. sent에 보낸 패킷 종류를 남긴다 */
function links(): [LinkLike & { sent: string[] }, LinkLike & { sent: string[] }] {
  const cbs: ((d: ArrayBuffer) => void)[][] = [[], []]
  const mk = (me: 0 | 1) => ({
    sent: [] as string[],
    send(d: ArrayBuffer) {
      this.sent.push(decode(d)?.kind ?? 'bad')
      for (const cb of cbs[1 - me]) cb(d)
    },
    onMessage(cb: (d: ArrayBuffer) => void) { cbs[me].push(cb); return () => {} },
  })
  return [mk(0), mk(1)]
}

function duo(o: { course?: ReturnType<typeof flatCourse>; versions?: [number, number] } = {}) {
  const [la, lb] = links()
  const reports: [RacerReport[], RacerReport[]] = [[], []]
  const course = o.course ?? flatCourse()
  const a = createMatch(R, { mySeat: 0, startAt: START, link: la, report: (r) => reports[0].push(r), course, version: o.versions?.[0] })
  const b = createMatch(R, { mySeat: 1, startAt: START, link: lb, report: (r) => reports[1].push(r), course, version: o.versions?.[1] })
  return { a, b, la, lb, reports }
}

/** 두 세션을 같은 서버 시각으로 dt마다 진행 */
function run(s: MatchSession[], from: number, to: number, controls: Controls[] = [], dt = 1000 / 60) {
  for (let t = from; t <= to; t += dt) s.forEach((x, i) => stepMatch(x, t, controls[i] ?? NO_CONTROLS))
}

test('countdown until startAt, then both cars run from the same tick', () => {
  const { a, b } = duo()
  stepMatch(a, START - COUNTDOWN_MS - 2000, NO_CONTROLS)
  expect(matchView(a).phase).toBe('waiting')
  expect(a.race.elapsed).toBe(0)
  stepMatch(a, START - 2000, NO_CONTROLS)
  expect(matchView(a).phase).toBe('countdown')
  expect(snapshot(a.race).countdown).toBe(2)
  run([a, b], START - 2000, START + 400, [GAS, GAS])
  for (const x of [a, b]) stepMatch(x, START + 500, GAS)
  expect(matchView(a).phase).toBe('racing')
  expect(snapshot(a.race).tick).toBe(30)
  expect(snapshot(b.race).tick).toBe(30)
  // 출발 칸은 좌석마다 옆으로 비켜 선다
  expect(Math.abs(snapshot(a.race).car.pos.x - snapshot(b.race).car.pos.x)).toBeGreaterThan(4)
  disposeMatch(a)
  disposeMatch(b)
})

test('a 30 s gap catches up to the server clock in one step', () => {
  const { a, b } = duo()
  stepMatch(a, START, NO_CONTROLS)
  stepMatch(a, START + 30_000, NO_CONTROLS)
  expect(snapshot(a.race).tick).toBe(30 * TICK_HZ)
  disposeMatch(a)
  disposeMatch(b)
})

test('each side receives the other at NET_HZ and places the opponent', () => {
  const { a, b, la } = duo()
  run([a, b], START - 100, START + 2000, [GAS, GAS], 50)
  const sent = la.sent.length
  run([a, b], START + 2050, START + 3000, [GAS, GAS], 50)
  const states = la.sent.slice(sent).filter((k) => k === 'state').length
  expect(states).toBeGreaterThanOrEqual(NET_HZ - 2)
  expect(states).toBeLessThanOrEqual(NET_HZ + 1)
  const v = matchView(a)
  expect(v.opponent).not.toBeNull()
  expect(v.opponent!.fresh).toBe(true)
  const bz = snapshot(b.race).car.pos.z
  expect(Math.abs(v.opponent!.pose.pos.z - bz)).toBeLessThan(3)
  // 진행 막대에 쓸 상대 진행도(0..1)
  expect(v.oppProgress).not.toBeNull()
  expect(v.oppProgress!).toBeGreaterThan(0)
  expect(Math.abs(v.oppProgress! - snapshot(b.race).progress)).toBeLessThan(0.02)
  disposeMatch(a)
  disposeMatch(b)
})

test('reports the moment it finishes; the later finisher carries the earlier time (최종 리뷰 C2)', () => {
  const { a, b, reports } = duo({ course: flatCourse(300) })
  run([a, b], START - 100, START + 25_000, [GAS, { ...GAS, throttle: 0.6 }], 50)
  const fa = snapshot(a.race).finishTicks!
  const fb = snapshot(b.race).finishTicks!
  expect(fa).not.toBeNull()
  expect(fb).toBeGreaterThan(fa)
  // 먼저 들어온 쪽은 기다리지 않고 바로 보고한다(나가도 기록이 남게)
  expect(reports[0]).toEqual([{ my: fa, opp: null, met: true }])
  expect(reports[1]).toEqual([{ my: fb, opp: fa, met: true }])
  expect(matchView(a).phase).toBe('done')
  expect(matchView(b).oppProgress).toBe(1)
  disposeMatch(a)
  disposeMatch(b)
})

test('opponent never finishing → reports once at the finish with opp null', () => {
  const { a, b, reports } = duo({ course: flatCourse(300) })
  run([a, b], START - 100, START + 20_000, [GAS, NO_CONTROLS], 50)
  const fa = snapshot(a.race).finishTicks!
  expect(fa).not.toBeNull()
  expect(reports[0]).toEqual([{ my: fa, opp: null, met: true }])
  stepMatch(a, START + 60_000, NO_CONTROLS)
  expect(reports[0]).toHaveLength(1)
  disposeMatch(a)
  disposeMatch(b)
})

test('opening long after the race ended is a DNF without simulating the whole race', () => {
  const [l] = links()
  const reports: RacerReport[] = []
  const s = createMatch(R, { mySeat: 0, startAt: START, link: l, report: (r) => reports.push(r), course: flatCourse() })
  const t0 = performance.now()
  stepMatch(s, START + (RACE_SECONDS + 40) * 1000, NO_CONTROLS)
  expect(performance.now() - t0).toBeLessThan(500)
  expect(matchView(s).phase).toBe('done')
  expect(matchView(s).myFinish).toBeNull()
  expect(l.sent).toContain('finish')
  // 상대 소식을 한 번도 못 들었다(met 없음)
  expect(reports).toEqual([{ my: null, opp: null }])
  disposeMatch(s)
})

test('version mismatch in hello stops both sides before the start and reports abort (최종 리뷰 I2)', () => {
  const { a, b, reports } = duo({ versions: [2, 1] })
  run([a, b], START - COUNTDOWN_MS - 1000, START + 1000, [GAS, GAS], 50)
  expect(matchView(b).phase).toBe('version_mismatch')
  expect(matchView(a).phase).toBe('version_mismatch')
  // 새로고침할 쪽은 옛 버전
  expect(matchView(b).stale).toBe(true)
  expect(matchView(a).stale).toBe(false)
  expect(b.race.elapsed).toBe(0)
  expect(a.race.elapsed).toBe(0)
  for (const r of reports) expect(r).toEqual([{ my: null, opp: null, met: true, abort: true }])
  disposeMatch(a)
  disposeMatch(b)
})

test('drawn opponent glides to a corrected position instead of jumping; big jumps (respawn) snap', () => {
  const [la, lb] = links()
  const a = createMatch(R, { mySeat: 0, startAt: START, link: la, report: () => {}, course: flatCourse() })
  let seq = 0
  const at = (z: number) => encode({ kind: 'state', tick: ++seq, pos: { x: 20, y: 1, z }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, nitro: false })
  let t = START + 1000
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { t += 1000 / 60; stepMatch(a, t, NO_CONTROLS) } }
  stepMatch(a, t, NO_CONTROLS)
  lb.send(at(100))
  tick()
  expect(matchView(a).opponent!.pose.pos.z).toBeCloseTo(100, 3)
  lb.send(at(101)) // 1m 보정
  tick()
  expect(matchView(a).opponent!.pose.pos.z).toBeLessThan(100.4)
  tick(40)
  expect(matchView(a).opponent!.pose.pos.z).toBeCloseTo(101, 1)
  // 충돌용 실제 위치는 보정 즉시 새 값
  expect(a.opp.pos!.z).toBeCloseTo(101, 3)
  lb.send(at(300)) // 복귀 같은 큰 순간이동
  tick()
  expect(matchView(a).opponent!.pose.pos.z).toBeCloseTo(300, 3)
  disposeMatch(a)
})
