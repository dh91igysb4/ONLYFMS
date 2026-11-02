import { expect, test } from 'vitest'
import { kstDate, kstDayRange, kstDaysUntil, kstWeekStart } from './kst.ts'

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
test('kstDaysUntil counts KST calendar days', () => {
  const at = (iso: string) => Date.parse(iso)
  expect(kstDaysUntil('2028-03-06', at('2026-11-02T09:00:00Z'))).toBe(490)
  expect(kstDaysUntil('2028-03-06', at('2028-03-05T14:59:59Z'))).toBe(1) // 3/5 23:59 KST
  expect(kstDaysUntil('2028-03-06', at('2028-03-05T15:00:00Z'))).toBe(0) // 3/6 00:00 KST
  expect(kstDaysUntil('2028-03-06', at('2028-03-06T15:00:00Z'))).toBe(-1)
  expect(kstDaysUntil('2028-03-01', at('2028-02-27T03:00:00Z'))).toBe(3) // 2028-02-29 포함
})
