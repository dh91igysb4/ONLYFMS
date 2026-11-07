// 밸런스 게이트: 앞을 내다보는 봇이 모든 템플릿을 원본·반전, 시작·최고 속도에서 통과해야 한다(설계 §7).
import { describe, expect, it } from 'vitest'
import { ROW, SPEED_TABLE } from './constants.ts'
import { courseFromSegments, getCourse } from './course.ts'
import { PARSED, START_PARSED } from './segments.ts'
import { runBot } from './bots.ts'

const TOP = SPEED_TABLE.length - 1
const cases = PARSED.flatMap((seg) =>
  [false, true].flatMap((mirrored) => [0, TOP].map((speedLevel) => ({ id: seg.id, seg, mirrored, speedLevel }))),
)

describe('ball-run balance', () => {
  it.each(cases)('every template is passable: $id mirrored=$mirrored speed=$speedLevel', ({ seg, mirrored, speedLevel }) => {
    const course = courseFromSegments([{ seg: START_PARSED, mirrored: false }, { seg, mirrored }])
    const untilZ = (START_PARSED.length + seg.length + 5) * ROW
    const end = runBot(course, { untilZ, maxTicks: 6000, speedLevel })
    expect(end.dead, `died at z=${end.z} x=${end.x} tick=${end.tick}`).toBeNull()
    expect(end.z).toBeGreaterThanOrEqual(untilZ)
  }, 30_000)

  const seeds = [
    '0123456789abcdef0123456789abcdef',
    'deadbeefdeadbeefdeadbeefdeadbeef',
    'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    'ffffffff00000000ffffffff00000000',
    '5eed5eed5eed5eed5eed5eed5eed5eed',
  ]
  it.each(seeds)('bot goes far on random seeds: %s', (seed) => {
    const end = runBot(getCourse(seed), { maxTicks: 60 * 180 })
    expect(end.z, `stopped (${end.dead ?? 'time'}) at z=${end.z} x=${end.x} tick=${end.tick}`).toBeGreaterThanOrEqual(1_500_000)
  }, 30_000)
})
