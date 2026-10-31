import type { ContestRow } from './data.ts'

export type Phase = 'cancelled' | 'lobby' | 'live' | 'ended'

export function phaseOf(c: ContestRow, nowMs: number): Phase {
  if (c.cancelled_at) return 'cancelled'
  if (nowMs < Date.parse(c.starts_at)) return 'lobby'
  if (nowMs < Date.parse(c.ends_at)) return 'live'
  return 'ended'
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts: string[] = []
  if (d) parts.push(`${d}일`)
  if (d || h) parts.push(`${h}시간`)
  if (d || h || m) parts.push(`${m}분`)
  parts.push(`${s}초`)
  return parts.join(' ')
}

const KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
})
export function kstLabel(iso: string): string {
  return `${KST.format(new Date(iso))} (KST)`
}

export const kindLabel = (k: ContestRow['kind']) => (k === 'official' ? '공식' : '친선')
