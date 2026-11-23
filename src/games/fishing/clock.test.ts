import { describe, expect, it } from 'vitest'
import {
  GAME_DAY_MS,
  RAIN_CHANCE,
  SEASON_ANCHOR_MS,
  conditionsAt,
  formatClock,
  inHours,
  isNight,
  nightLevel,
  weatherOf,
} from './clock.ts'

const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s) // KST 시각 → ms

describe('clock', () => {
  it('KST 자정은 게임 0시, 실제 1초 = 게임 1분, 24분마다 다시 0시', () => {
    expect(conditionsAt(at(2026, 11, 23, 0)).gameMinute).toBe(0)
    expect(conditionsAt(at(2026, 11, 23, 0, 0, 59)).gameMinute).toBe(59)
    expect(conditionsAt(at(2026, 11, 23, 0, 23, 59)).gameMinute).toBe(1439)
    expect(conditionsAt(at(2026, 11, 23, 0, 24)).gameMinute).toBe(0)
    expect(conditionsAt(at(2026, 11, 23, 0, 24)).gameDay).toBe(conditionsAt(at(2026, 11, 23, 0)).gameDay + 1)
  })

  it('계절: 기준 주는 봄, 1주마다 다음 계절, 4주 뒤 다시 봄, 기준 1ms 전은 겨울', () => {
    expect(conditionsAt(SEASON_ANCHOR_MS).season).toBe('spring')
    expect(conditionsAt(at(2026, 11, 29, 23, 59, 59)).season).toBe('spring')
    expect(conditionsAt(at(2026, 11, 30, 0)).season).toBe('summer')
    expect(conditionsAt(at(2026, 12, 7, 0)).season).toBe('autumn')
    expect(conditionsAt(at(2026, 12, 14, 0)).season).toBe('winter')
    expect(conditionsAt(at(2026, 12, 21, 0)).season).toBe('spring')
    expect(conditionsAt(SEASON_ANCHOR_MS - 1).season).toBe('winter')
  })

  it('날씨: 같은 게임 날짜는 같은 날씨, 10,000일 중 비 22~28%, 게임 날짜 안에서는 바뀌지 않는다', () => {
    for (const d of [-5, 0, 1, 20_000, 123_456]) {
      expect(weatherOf(d)).toBe(weatherOf(d))
    }
    let rain = 0
    for (let d = 20_000; d < 30_000; d++) if (weatherOf(d) === 'rain') rain++
    expect(rain / 10_000).toBeGreaterThan(RAIN_CHANCE - 0.03)
    expect(rain / 10_000).toBeLessThan(RAIN_CHANCE + 0.03)
    // 음수 날짜도 유한한 값이 나온다
    expect(['sun', 'rain']).toContain(weatherOf(-12345))
    // 하루 시작과 끝-1ms의 날씨가 같다
    for (let k = 0; k < 200; k++) {
      const start = (20_000 + k) * GAME_DAY_MS - 9 * 3_600_000
      const a = conditionsAt(start)
      const b = conditionsAt(start + GAME_DAY_MS - 1)
      expect(a.gameDay).toBe(b.gameDay)
      expect(a.weather).toBe(b.weather)
      expect(a.weather).toBe(weatherOf(a.gameDay))
    }
  })

  it('inHours: 일반 구간과 자정을 넘는 구간, 경계', () => {
    expect(inHours(6 * 60, [6, 19])).toBe(true)
    expect(inHours(19 * 60, [6, 19])).toBe(false)
    expect(inHours(23 * 60, [18, 2])).toBe(true)
    expect(inHours(1 * 60 + 59, [18, 2])).toBe(true)
    expect(inHours(2 * 60, [18, 2])).toBe(false)
    expect(inHours(12 * 60, [18, 2])).toBe(false)
  })

  it('isNight: 20:00~4:59 밤, 19:59·5:00 낮', () => {
    expect(isNight(20 * 60)).toBe(true)
    expect(isNight(19 * 60 + 59)).toBe(false)
    expect(isNight(4 * 60 + 59)).toBe(true)
    expect(isNight(5 * 60)).toBe(false)
  })

  it('nightLevel: 정오 0, 자정 1, 19:00은 0과 1 사이, 5:30은 0과 1 사이, 6:00 이후 0', () => {
    expect(nightLevel(12 * 60)).toBe(0)
    expect(nightLevel(0)).toBe(1)
    expect(nightLevel(19 * 60)).toBeGreaterThan(0)
    expect(nightLevel(19 * 60)).toBeLessThan(1)
    expect(nightLevel(5 * 60 + 30)).toBeGreaterThan(0)
    expect(nightLevel(5 * 60 + 30)).toBeLessThan(1)
    expect(nightLevel(6 * 60)).toBe(0)
    expect(nightLevel(15 * 60)).toBe(0)
    expect(nightLevel(20 * 60)).toBe(1)
  })

  it("formatClock: 0 → '00:00', 14*60+37 → '14:30', 1439 → '23:50'", () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(14 * 60 + 37)).toBe('14:30')
    expect(formatClock(1439)).toBe('23:50')
    expect(formatClock(9 * 60 + 5)).toBe('09:00')
  })
})
