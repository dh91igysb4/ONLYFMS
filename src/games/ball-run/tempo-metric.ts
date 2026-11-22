// 테스트 전용: 생성 코스의 "템포"(가만히 있어도 되는 시간)를 시뮬 없이 코스만으로 잰다(설계 v6).
// 운영 코드에서 import하지 않는다.
//
// - 평범한 행(plain): 바닥 칸이 하나 이상 있고, 그 열 집합이 앞 행과 똑같고, 모두 평평하며 앞 행과 같은 높이(경사·급경사·단차 없음),
//   블록·기둥·문·점프대·왕복 블록·기운 판이 없는 행. 나머지는 사건 행(길 모양 변화, 피할 것, 점프, 경사·단차, 움직이는 블록).
// - 강제 행(forcing): 앞 행의 지나갈 수 있는 길 칸 가운데 하나라도, 그 열에 그대로 있으면 이 행에서 살 수 없는 행
//   (그 칸이 구멍이거나 블록·기둥·문). 왕복 블록 행은 강제 행이다(큐브가 길 어느 칸이든 지나간다). 기운 판은 미는 방향이
//   새로 생기거나 바뀌는 행을 강제 행으로 센다(그대로 있으면 밀려난다). 바닥이 하나도 없거나 지나갈 칸이 없는 행
//   (점프대·오르막 끝 점프로 날아 넘는 구멍·'BBB' 벽)과 그 다음 착지 행은 세지 않는다.
// - 행 하나의 시간 = 1000 / (SPEED_TABLE[단계] · 60)초, 단계 = boostsBefore(행).
import { COL_MAX, COL_MIN, ROW, SPEED_TABLE, TICK_HZ } from './constants.ts'
import type { Course } from './course.ts'
import type { Cell } from './segments.ts'

export type RowInfo = { row: number; stage: number; dt: number; plain: boolean; forcing: boolean; tunnel: boolean; start: boolean }

export const STAGE_BANDS: readonly { name: string; from: number; to: number }[] = [
  { name: '1-3', from: 1, to: 3 },
  { name: '4-8', from: 4, to: 8 },
  { name: '9+', from: 9, to: Infinity },
]

const LAST = SPEED_TABLE.length - 1
const cols = (): number[] => [...Array(COL_MAX - COL_MIN + 1).keys()].map((i) => i + COL_MIN)
const bankOf = (row: Cell[]): number => row.find((c) => c.bank !== undefined)?.bank ?? 0

function rowCells(course: Course, r: number): Cell[] {
  return cols().map((c) => course.cell(c, r))
}

export function isPlain(prev: Cell[], cur: Cell[], mover: boolean): boolean {
  if (mover) return false
  if (!cur.some((c) => c.floor !== null)) return false // 바닥이 없는 행(점프로 날아 넘는 구멍)은 사건 행
  for (let i = 0; i < cur.length; i++) {
    const a = prev[i].floor
    const b = cur[i]
    if ((a === null) !== (b.floor === null)) return false
    if (b.floor === null) continue
    if (b.floor.h0 !== b.floor.h1 || b.floor.h0 !== a!.h1) return false
    if (b.block || b.pad || b.bank !== undefined) return false
  }
  return true
}

export function isForcing(prev: Cell[], cur: Cell[], mover: boolean): boolean {
  const passable = (c: Cell): boolean => c.floor !== null && !c.block
  if (!cur.some(passable)) return false // 날아 넘는 행
  if (!prev.some(passable)) return false // 착지 행
  if (mover) return true
  for (let i = 0; i < cur.length; i++) if (passable(prev[i]) && !passable(cur[i])) return true
  const b = bankOf(cur)
  return b !== 0 && b !== bankOf(prev)
}

/** 0행부터 코스 시간 seconds초까지 행마다 정보. */
export function scanCourse(course: Course, seconds: number): RowInfo[] {
  const out: RowInfo[] = []
  let t = 0
  let prev = rowCells(course, 0)
  for (let r = 0; t < seconds; r++) {
    const stage = course.boostsBefore(r)
    const dt = ROW / (SPEED_TABLE[Math.min(stage, LAST)] * TICK_HZ)
    const cur = r === 0 ? prev : rowCells(course, r)
    const mover = course.moverAt(r) !== null
    const seg = course.segmentAt(r)
    const tunnel = seg.kind === 'tunnel'
    out.push({
      row: r, stage, dt, tunnel, start: seg.id === 'start',
      plain: r === 0 ? true : isPlain(prev, cur, mover),
      forcing: r === 0 ? false : isForcing(prev, cur, mover),
    })
    prev = cur
    t += dt
  }
  return out
}

export type TempoStats = {
  time: number
  plainTime: number
  plainFrac: number
  forcing: number
  meanBetweenForcing: number
  longestPlain: number // 터널 밖 평범한 행이 이어진 가장 긴 시간(초)
  longestPlainAt: string
  longestTunnel: number // 터널 하나(이음 행 포함)를 지나는 가장 긴 시간(초). 시작 터널은 빼고 startTunnel에 따로 둔다.
  startTunnel: number
}

const empty = (): TempoStats => ({
  time: 0, plainTime: 0, plainFrac: 0, forcing: 0, meanBetweenForcing: 0, longestPlain: 0, longestPlainAt: '', longestTunnel: 0, startTunnel: 0,
})

/** 시드 코스들을 seconds초씩 재서 전체와 단계 묶음별 통계. 이어진 구간(평범한 행·터널)은 끝 행의 단계 묶음으로 센다. */
export function tempoStats(courses: { seed: string; course: Course }[], seconds = 90): { all: TempoStats; bands: Record<string, TempoStats> } {
  const all = empty()
  const bands: Record<string, TempoStats> = Object.fromEntries(STAGE_BANDS.map((b) => [b.name, empty()]))
  const bandOf = (stage: number): TempoStats => bands[STAGE_BANDS.find((b) => stage >= b.from && stage <= b.to)?.name ?? '1-3']
  for (const { seed, course } of courses) {
    const rows = scanCourse(course, seconds)
    let run = 0
    let runStart = 0
    let tun = 0
    let st = 0
    const close = (i: number): void => {
      const last = rows[i - 1]
      if (run > 0 && last) {
        for (const s of [all, bandOf(last.stage)]) {
          if (run > s.longestPlain) {
            s.longestPlain = run
            s.longestPlainAt = `${seed} rows ${runStart}..${last.row} ${course.segmentAt(runStart).id}→${course.segmentAt(last.row).id}`
          }
        }
      }
      run = 0
    }
    rows.forEach((x, i) => {
      for (const s of [all, bandOf(x.stage)]) {
        s.time += x.dt
        if (x.plain) s.plainTime += x.dt
        if (x.forcing) s.forcing++
      }
      if (x.plain && !x.tunnel) {
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
  for (const s of [all, ...Object.values(bands)]) {
    s.plainFrac = s.time > 0 ? s.plainTime / s.time : 0
    s.meanBetweenForcing = s.forcing > 0 ? s.time / s.forcing : Infinity
  }
  return { all, bands }
}
