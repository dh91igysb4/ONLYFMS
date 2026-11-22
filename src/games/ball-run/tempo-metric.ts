// 테스트 전용: 생성 코스의 "템포"(가만히 있어도 되는 시간)를 잰다(설계 v6). 운영 코드에서 import하지 않는다.
//
// - 평범한 행(plain): 바닥 칸이 하나 이상 있고 그 열 집합이 앞 행과 똑같으며, 블록·기둥·문·점프대·왕복 블록·기운 판이 없는 행.
//   높이는 보지 않는다 — 열이 그대로인 경사·급경사·단차 행도 손댈 일이 없으니 평범한 행이다(단차 뒤 착지 길의 열이 바뀌면 그 행이 사건).
// - 강제 행(forcing): 앞 행의 지나갈 수 있는 길 칸 가운데 하나라도, 그 열에 그대로 있으면 이 행에서 살 수 없는 행
//   (그 칸이 구멍이거나 블록·기둥·문). 왕복 블록 행은 강제 행이다. 기운 판은 미는 방향이 새로 생기거나 바뀌는 행을 센다.
//   바닥이 하나도 없거나 지나갈 칸이 없는 행(날아 넘는 구멍·'BBB' 벽)과 그 다음 착지 행은 세지 않는다.
// - 조향 행(steering): 손을 뗀 공(목표 x 고정)을 그 행 시작에서 길 가운데(지나갈 칸 묶음 가운데 0에 가장 가까운 것의 가운데)에
//   바닥에 붙여 두고 그 단계 속도로 굴렸을 때 60틱 안에 죽거나 떨어지는(발밑이 구멍이고 마지막 바닥보다 0.5 m 아래) 행.
//   실제 시뮬(step)을 조각 하나만 놓은 코스에서 돌리고 (조각, 단계)마다 캐시한다. 왕복 블록은 뺀다(위상에 따라 달라서. 왕복 블록 행
//   자체는 강제 행이고, 그 앞 행은 쉬는 시간으로 센다 — 쉬는 시간을 많게 잡는 쪽). 조각 끝 뒤는 넓은 평지라 그쪽도 많게 잡는다.
//   연속 조향(contSteering): 그중 손 뗀 공이 강제 행이 아닌 곳에서 실패하는 행(기운 판에 밀려나는 등). 보고용.
//   모든 칸 조향(steerAll): 길 가운데뿐 아니라 그 행의 지나갈 수 있는 어느 칸 가운데에서 손을 놓아도 실패하는 행(앉아 있을 안전한
//   칸이 없다). 보고용(더 엄격한 쉬는 시간 = 강제 행도 모든 칸 조향 행도 아닌 행).
// - 쉬는 행(idle) = 강제 행도 조향 행도 아닌 행. 터널 행도 쉬는 행이다.
// - 행 하나의 시간 = 1000 / (SPEED_TABLE[단계] · 60)초, 단계 = boostsBefore(행).
import { COL_MAX, COL_MIN, R, ROW, SPEED_TABLE, TICK_HZ } from './constants.ts'
import { courseFromSegments } from './course.ts'
import type { Course } from './course.ts'
import { PARSED, START_PARSED } from './segments.ts'
import type { Cell, ParsedSegment } from './segments.ts'
import { floorAt, initSim, rowOf, step } from './sim.ts'

export type RowInfo = {
  row: number
  stage: number
  dt: number
  plain: boolean
  forcing: boolean
  steering: boolean
  contSteering: boolean
  steerAll: boolean
  idle: boolean
  slope: boolean
  tunnel: boolean
  start: boolean
  kind: string
}

export const STAGE_BANDS: readonly { name: string; from: number; to: number }[] = [
  { name: '1-3', from: 1, to: 3 },
  { name: '4-8', from: 4, to: 8 },
  { name: '9+', from: 9, to: Infinity },
]

export const STEER_TICKS = 60
const LAST = SPEED_TABLE.length - 1
const COLS = COL_MAX - COL_MIN + 1
const bankOf = (row: Cell[]): number => row.find((c) => c.bank !== undefined)?.bank ?? 0
const passable = (c: Cell): boolean => c.floor !== null && !c.block

function rowCells(course: Course, r: number): Cell[] {
  const out: Cell[] = []
  for (let c = COL_MIN; c <= COL_MAX; c++) out.push(course.cell(c, r))
  return out
}

export function isPlain(prev: Cell[], cur: Cell[], mover: boolean): boolean {
  if (mover) return false
  if (!cur.some((c) => c.floor !== null)) return false // 바닥이 없는 행(점프로 날아 넘는 구멍)은 사건 행
  for (let i = 0; i < cur.length; i++) {
    const b = cur[i]
    if ((prev[i].floor === null) !== (b.floor === null)) return false
    if (b.floor === null) continue
    if (b.block || b.pad || b.bank !== undefined) return false
  }
  return true
}

export function isForcing(prev: Cell[], cur: Cell[], mover: boolean): boolean {
  if (!cur.some(passable)) return false // 날아 넘는 행
  if (!prev.some(passable)) return false // 착지 행
  if (mover) return true
  for (let i = 0; i < cur.length; i++) if (passable(prev[i]) && !passable(cur[i])) return true
  const b = bankOf(cur)
  return b !== 0 && b !== bankOf(prev)
}

// 지나갈 칸 묶음 가운데 가운데가 0에 가장 가까운 것(같으면 왼쪽)의 가운데 x(mm). 없으면 null.
function roadCentre(cells: Cell[]): number | null {
  let best: number | null = null
  for (let i = 0; i < COLS; ) {
    if (!passable(cells[i])) {
      i++
      continue
    }
    let j = i
    while (j + 1 < COLS && passable(cells[j + 1])) j++
    const x = ((i + j) / 2 + COL_MIN) * 1000
    if (best === null || Math.abs(x) < Math.abs(best)) best = x
    i = j + 1
  }
  return best
}

type Steer = { steer: boolean[]; cont: boolean[]; all: boolean[] }
const steerCache = new Map<string, Steer>()
/** 조각 하나(왕복 블록 뺌)에서 행마다 손 뗀 공이 STEER_TICKS 안에 실패하는지. */
export function steeringRows(seg: ParsedSegment, level: number): Steer {
  const key = `${seg.id}|${seg.length}|${level}`
  const hit = steerCache.get(key)
  if (hit) return hit
  const bare: ParsedSegment = { ...seg, movers: seg.movers.map(() => null) }
  const c = courseFromSegments([{ seg: bare, mirrored: false }])
  const forcingAt = (r: number): boolean => r >= 1 && r < seg.length && isForcing(rowCells(c, r - 1), rowCells(c, r), seg.movers[r] !== null)
  const steer: boolean[] = []
  const cont: boolean[] = []
  const all: boolean[] = []
  // x에서 손을 놓았을 때 실패한 행(없으면 -1).
  const failFrom = (r: number, x: number): number => {
    const f = floorAt(c, x, r * ROW)
    if (f === null) return -1
    let s = { ...initSim({ speedLevel: level }), x, z: r * ROW, y: f + R, lastFloor: f }
    for (let t = 0; t < STEER_TICKS; t++) {
      s = step(s, x, c)
      const off = floorAt(c, s.x, s.z) === null && s.y - R < s.lastFloor - 500
      if (s.dead !== null || off) return rowOf(s.z)
    }
    return -1
  }
  for (let r = 0; r < seg.length; r++) {
    const cells = rowCells(c, r)
    const x = roadCentre(cells)
    if (x === null || floorAt(c, x, r * ROW) === null) {
      steer.push(false)
      cont.push(false)
      all.push(false)
      continue
    }
    const failRow = failFrom(r, x)
    steer.push(failRow >= 0)
    let every = failRow >= 0
    for (let i = 0; every && i < COLS; i++) if (passable(cells[i]) && failFrom(r, (i + COL_MIN) * 1000) < 0) every = false
    all.push(every)
    // 실패한 행 근처(뒤 3행 ~ 앞 1행)에 강제 행이 없으면 연속 조향.
    let near = false
    for (let k = failRow - 3; failRow >= 0 && k <= failRow + 1; k++) if (forcingAt(k)) near = true
    cont.push(failRow >= 0 && !near)
  }
  const out = { steer, cont, all }
  steerCache.set(key, out)
  return out
}

const BY_ID = new Map([START_PARSED, ...PARSED].map((p) => [p.id, p]))

/** 0행부터 코스 시간 seconds초까지 행마다 정보. segs: 조각 id → ParsedSegment(테스트용 코스는 넘긴다). */
export function scanCourse(course: Course, seconds: number, segs: Map<string, ParsedSegment> = BY_ID): RowInfo[] {
  const out: RowInfo[] = []
  let t = 0
  let prev = rowCells(course, 0)
  for (let r = 0; t < seconds; r++) {
    const stage = course.boostsBefore(r)
    const level = Math.min(stage, LAST)
    const dt = ROW / (SPEED_TABLE[level] * TICK_HZ)
    const cur = r === 0 ? prev : rowCells(course, r)
    const mover = course.moverAt(r) !== null
    const info = course.segmentAt(r)
    const seg = segs.get(info.id)
    const st = seg ? steeringRows(seg, level) : null
    const local = r - info.startRow
    const forcing = r === 0 ? false : isForcing(prev, cur, mover)
    const steering = st ? st.steer[local] : false
    out.push({
      row: r, stage, dt, tunnel: info.kind === 'tunnel', start: info.id === 'start', kind: info.kind,
      plain: r === 0 ? true : isPlain(prev, cur, mover),
      forcing, steering, contSteering: st ? st.cont[local] : false, steerAll: st ? st.all[local] : false, idle: !forcing && !steering,
      slope: cur.some((x) => x.floor !== null && x.floor.h0 !== x.floor.h1),
    })
    prev = cur
    t += dt
  }
  return out
}

export type TempoStats = {
  time: number
  idleFrac: number
  strictIdleFrac: number // 강제 행도 모든 칸 조향 행도 아닌 시간 비율(보고용)
  plainFrac: number
  steerFrac: number
  contSteerFrac: number
  slopeFrac: number
  slopeFracOutsideDescents: number
  forcing: number
  meanBetweenForcing: number
  longestIdle: number // 터널 밖 쉬는 행이 이어진 가장 긴 시간(초)
  longestIdleAt: string
  longestTunnel: number // 터널 하나(이음 행 포함)를 지나는 가장 긴 시간(초). 시작 터널은 빼고 startTunnel에 따로 둔다.
  startTunnel: number
  dropPerMinOutsideDescents: number // 내리막 조각 밖에서 1분에 내려가는 높이(m)
}

type Acc = TempoStats & { strictT: number; idleT: number; plainT: number; steerT: number; contT: number; slopeT: number; slopeOutT: number; dropOut: number }
const empty = (): Acc => ({
  time: 0, idleFrac: 0, strictIdleFrac: 0, strictT: 0, plainFrac: 0, steerFrac: 0, contSteerFrac: 0, slopeFrac: 0, slopeFracOutsideDescents: 0, forcing: 0,
  meanBetweenForcing: 0, longestIdle: 0, longestIdleAt: '', longestTunnel: 0, startTunnel: 0, dropPerMinOutsideDescents: 0,
  idleT: 0, plainT: 0, steerT: 0, contT: 0, slopeT: 0, slopeOutT: 0, dropOut: 0,
})

/** 시드 코스들을 seconds초씩 재서 전체와 단계 묶음별 통계. 이어진 구간(쉬는 행·터널)은 끝 행의 단계 묶음으로 센다. */
export function tempoStats(
  courses: { seed: string; course: Course }[],
  seconds = 90,
  segs?: Map<string, ParsedSegment>,
): { all: TempoStats; bands: Record<string, TempoStats> } {
  const all = empty()
  const bands: Record<string, Acc> = Object.fromEntries(STAGE_BANDS.map((b) => [b.name, empty()]))
  const bandOf = (stage: number): Acc => bands[STAGE_BANDS.find((b) => stage >= b.from && stage <= b.to)?.name ?? '1-3']
  for (const { seed, course } of courses) {
    const rows = scanCourse(course, seconds, segs)
    let run = 0
    let runStart = 0
    let tun = 0
    let st = 0
    const close = (i: number): void => {
      const last = rows[i - 1]
      if (run > 0 && last) {
        for (const s of [all, bandOf(last.stage)]) {
          if (run > s.longestIdle) {
            s.longestIdle = run
            s.longestIdleAt = `${seed} rows ${runStart}..${last.row} ${course.segmentAt(runStart).id}→${course.segmentAt(last.row).id}`
          }
        }
      }
      run = 0
    }
    rows.forEach((x, i) => {
      const a = i > 0 ? course.cell(0, rows[i - 1].row).floor : null
      const b = course.cell(0, x.row).floor
      const drop = x.kind !== 'descent' && a !== null && b !== null ? Math.max(0, a.h1 - b.h1) : 0
      for (const s of [all, bandOf(x.stage)]) {
        s.time += x.dt
        if (x.idle) s.idleT += x.dt
        if (!x.forcing && !x.steerAll) s.strictT += x.dt
        if (x.plain) s.plainT += x.dt
        if (x.steering) s.steerT += x.dt
        if (x.contSteering) s.contT += x.dt
        if (x.slope) s.slopeT += x.dt
        if (x.slope && x.kind !== 'descent') s.slopeOutT += x.dt
        if (x.forcing) s.forcing++
        s.dropOut += drop
      }
      if (x.idle && !x.tunnel) {
        if (run === 0) runStart = x.row
        run += x.dt
      } else close(i)
      if (x.start) st += x.dt
      else if (x.tunnel) tun += x.dt
      else if (tun > 0) {
        for (const s of [all, bandOf(rows[i - 1].stage)]) s.longestTunnel = Math.max(s.longestTunnel, tun)
        tun = 0
      }
    })
    close(rows.length)
    for (const s of [all, bandOf(1)]) s.startTunnel = Math.max(s.startTunnel, st)
  }
  const fin = (s: Acc): TempoStats => {
    const f = (v: number) => (s.time > 0 ? v / s.time : 0)
    return {
      time: s.time, idleFrac: f(s.idleT), strictIdleFrac: f(s.strictT), plainFrac: f(s.plainT), steerFrac: f(s.steerT), contSteerFrac: f(s.contT), slopeFrac: f(s.slopeT),
      slopeFracOutsideDescents: f(s.slopeOutT), forcing: s.forcing, meanBetweenForcing: s.forcing > 0 ? s.time / s.forcing : Infinity,
      longestIdle: s.longestIdle, longestIdleAt: s.longestIdleAt, longestTunnel: s.longestTunnel, startTunnel: s.startTunnel,
      dropPerMinOutsideDescents: s.time > 0 ? s.dropOut / 1000 / (s.time / 60) : 0,
    }
  }
  return { all: fin(all), bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, fin(v)])) }
}
