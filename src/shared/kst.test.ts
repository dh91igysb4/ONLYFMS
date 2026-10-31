import { expect, test } from 'vitest'
import { kstDate, kstDayRange, kstWeekStart } from './kst.ts'

test('kstDate switches at 00:00 KST', () => {
  expect(kstDate(Date.parse('2026-10-31T14:59:59Z'))).toBe('2026-10-31')
  expect(kstDate(Date.parse('2026-10-31T15:00:00Z'))).toBe('2026-11-01')
})
test('kstDayRange', () => {
  const r = kstDayRange('2026-11-01')
  expect(r.start.toISOString()).toBe('2026-10-31T15:00:00.000Z')
  expect(r.end.toISOString()).toBe('2026-11-01T15:00:00.000Z')
})
test('kstWeekStart is Monday', () => {
  expect(kstWeekStart('2026-11-01')).toBe('2026-10-26') // 일요일 → 그 주 월요일
  expect(kstWeekStart('2026-11-02')).toBe('2026-11-02')
})
