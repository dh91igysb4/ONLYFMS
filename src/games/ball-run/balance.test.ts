// 밸런스 게이트: 앞을 내다보는 봇이 모든 템플릿(터널·내리막·장애물)을 원본·반전으로, 시작·중간·최고 속도에서
// 통과해야 한다(설계 §5, v1 §7). 실패하면 봇이 아니라 템플릿을 고친다.
import { describe, expect, it } from 'vitest'
import { MOVER_PERIOD, ROW, SPEED_TABLE, TICK_HZ } from './constants.ts'
import { courseFromSegments, getCourse } from './course.ts'
import { PARSED, START_PARSED } from './segments.ts'
import { runBot } from './bots.ts'
import { rowOf } from './sim.ts'

// 시작(0)·중간(8)·최고 속도만 보면 그 사이 속도에서만 막히는 줄(v2 o4-dense의 13단계)을 놓친다. 모든 단계를 본다.
const TOP = SPEED_TABLE.length - 1
const SPEEDS = SPEED_TABLE.map((_, k) => k)
// v4: 왕복 블록이 있는 조각은 조각 위상을 주기에 고르게 PHASES개 돌려 본다(공이 그 행에 닿는 틱은 코스로 정해지므로 위상이 곧
// 큐브 자리다). 위상마다 따로 케이스를 둬 실패한 위상이 보이게 한다.
const PHASES = 6
const hasMover = (seg: (typeof PARSED)[number]) => seg.movers.some((m) => m !== null)
const cases = PARSED.flatMap((seg) =>
  [false, true].flatMap((mirrored) =>
    (hasMover(seg) ? [...Array(PHASES).keys()].map((k) => Math.floor((k * MOVER_PERIOD) / PHASES) + 3 * k) : [0]).map((phase) => ({
      id: seg.id, seg, mirrored, phase,
    })),
  ),
)

// 시드 코스에서 봇이 죽지 않고 지나야 하는 단계(지나온 터널 수, 시작 터널 포함 = 속도 단계).
// 전에는 시작 터널을 세지 않은 10(터널 11개째)이었다. 시작 터널을 세게 되며 같은 자리가 11이고, 마지막 tier 가중치
// 구간(fromStage 12)까지 보려고 12로 둔다.
const STAGE_GOAL = 12

describe('ball-run balance', () => {
  it('gate covers start, middle and top speed', () => {
    expect(TOP).toBe(16)
    for (const k of [0, 8, TOP]) expect(SPEEDS).toContain(k)
    const movers = PARSED.filter(hasMover).length
    expect(movers).toBeGreaterThanOrEqual(4)
    expect(cases).toHaveLength((PARSED.length - movers) * 2 + movers * 2 * PHASES)
    const phases = new Set(cases.filter((c) => hasMover(c.seg)).map((c) => c.phase))
    expect(phases.size).toBe(PHASES)
    for (const p of phases) expect(p).toBeLessThan(MOVER_PERIOD)
  })

  it.each(cases)('every template is passable at every speed: $id mirrored=$mirrored phase=$phase', ({ seg, mirrored, phase }) => {
    const course = courseFromSegments([{ seg: START_PARSED, mirrored: false }, { seg, mirrored, phase }])
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

  // 원작 녹화: '속도 증가'가 시작 ≈2.75초 뒤, 그다음 5~8초마다. 봇 주행 첫 60초 동안 단계가 오른 간격의 중앙값이 4~9초.
  it.each(['0123456789abcdef0123456789abcdef', 'deadbeefdeadbeefdeadbeefdeadbeef', '5eed5eed5eed5eed5eed5eed5eed5eed'])(
    'boosts come every 4-9 s over the first minute: %s',
    (seed) => {
      const rises: number[] = []
      let level = 0
      const end = runBot(getCourse(seed), {
        maxTicks: 60 * TICK_HZ,
        onStep: (s) => {
          if (s.speedLevel > level) rises.push(s.tick)
          level = s.speedLevel
        },
      })
      expect(end.dead).toBeNull()
      const gaps = rises.slice(1).map((t, i) => (t - rises[i]) / TICK_HZ).sort((a, b) => a - b)
      expect(gaps.length, `rises at ${rises}`).toBeGreaterThanOrEqual(5)
      const median = gaps.length % 2 === 1 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2
      expect(median, `gaps ${gaps.map((g) => g.toFixed(2))}`).toBeGreaterThanOrEqual(4)
      expect(median, `gaps ${gaps.map((g) => g.toFixed(2))}`).toBeLessThanOrEqual(9)
    },
    30_000,
  )

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
