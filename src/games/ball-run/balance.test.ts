// 밸런스 게이트: 앞을 내다보는 봇이 모든 템플릿(터널·내리막·장애물)을 원본·반전으로, 시작·중간·최고 속도에서
// 통과해야 한다(설계 §5, v1 §7). 실패하면 봇이 아니라 템플릿을 고친다.
import { describe, expect, it } from 'vitest'
import { ROW, SPEED_TABLE } from './constants.ts'
import { courseFromSegments, getCourse } from './course.ts'
import { PARSED, START_PARSED } from './segments.ts'
import { runBot } from './bots.ts'
import { rowOf } from './sim.ts'

// 시작(0)·중간(8)·최고 속도만 보면 그 사이 속도에서만 막히는 줄(v2 o4-dense의 13단계)을 놓친다. 모든 단계를 본다.
const TOP = SPEED_TABLE.length - 1
const SPEEDS = SPEED_TABLE.map((_, k) => k)
const cases = PARSED.flatMap((seg) => [false, true].map((mirrored) => ({ id: seg.id, seg, mirrored })))

// 시드 코스에서 봇이 죽지 않고 지나야 하는 단계(지나온 터널 수, 시작 터널 제외).
const STAGE_GOAL = 10

describe('ball-run balance', () => {
  it('gate covers start, middle and top speed', () => {
    expect(TOP).toBe(16)
    for (const k of [0, 8, TOP]) expect(SPEEDS).toContain(k)
    expect(cases).toHaveLength(PARSED.length * 2)
  })

  it.each(cases)('every template is passable at every speed: $id mirrored=$mirrored', ({ seg, mirrored }) => {
    const course = courseFromSegments([{ seg: START_PARSED, mirrored: false }, { seg, mirrored }])
    const untilZ = (START_PARSED.length + seg.length + 5) * ROW
    const failures: string[] = []
    for (const speedLevel of SPEEDS) {
      const end = runBot(course, { untilZ, maxTicks: 6000, speedLevel })
      if (end.dead !== null || end.z < untilZ) {
        failures.push(`speed ${speedLevel}: ${end.dead ?? 'time'} at z=${end.z} x=${end.x} tick=${end.tick}`)
      }
    }
    expect(failures).toEqual([])
  }, 30_000)

  const seeds = [
    '0123456789abcdef0123456789abcdef',
    'deadbeefdeadbeefdeadbeefdeadbeef',
    'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    'ffffffff00000000ffffffff00000000',
    '5eed5eed5eed5eed5eed5eed5eed5eed',
  ]
  it.each(seeds)(`bot survives through stage ${STAGE_GOAL} on random seeds: %s`, (seed) => {
    const course = getCourse(seed)
    // STAGE_GOAL번째 터널이 시작되는 행을 찾고, 그 터널 끝(+20행)까지 살아 있어야 한다.
    let goalRow = 0
    while (course.boostsBefore(goalRow) < STAGE_GOAL) goalRow++
    const untilZ = (goalRow + 20) * ROW
    const end = runBot(course, { maxTicks: 60 * 240, untilZ })
    const where = `stage ${course.boostsBefore(rowOf(end.z))} z=${end.z} x=${end.x} tick=${end.tick} in ${course.segmentAt(rowOf(end.z)).id}`
    expect(end.dead, `died (${end.dead}) at ${where}`).toBeNull()
    expect(end.z, `ran out of time at ${where}`).toBeGreaterThanOrEqual(untilZ)
    expect(course.boostsBefore(rowOf(end.z))).toBeGreaterThanOrEqual(STAGE_GOAL)
    expect(end.speedLevel).toBeGreaterThanOrEqual(STAGE_GOAL)
  }, 30_000)
})
