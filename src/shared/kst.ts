// KST(UTC+9) 날짜 유틸. 한국은 서머타임이 없어 고정 오프셋으로 계산한다. 외부 의존 없음.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

function ymd(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// 'YYYY-MM-DD'의 UTC 자정 시각(ms)
function dateToUtcMidnight(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw new Error(`invalid date: ${date}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function kstDate(nowMs: number): string {
  return ymd(new Date(nowMs + KST_OFFSET_MS))
}

export function kstDayRange(date: string): { start: Date; end: Date } {
  const startMs = dateToUtcMidnight(date) - KST_OFFSET_MS
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) }
}

export function kstWeekStart(date: string): string {
  const ms = dateToUtcMidnight(date)
  const dow = new Date(ms).getUTCDay() // 0=일 … 6=토
  const sinceMonday = (dow + 6) % 7
  return ymd(new Date(ms - sinceMonday * DAY_MS))
}

// date('YYYY-MM-DD')까지 남은 KST 달력일. 당일 0, 지나면 음수
export function kstDaysUntil(date: string, nowMs: number): number {
  return Math.round((dateToUtcMidnight(date) - dateToUtcMidnight(kstDate(nowMs))) / DAY_MS)
}
