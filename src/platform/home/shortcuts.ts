// 메인 바로가기 버튼 목록과 할 일 표시 데이터(메인 미리보기 설계 §4.2, §4.3).
// 목록은 등록부 manifest만으로 만든다(게임 id 분기 없음). 표시용 데이터는 기존 RPC·테이블만 읽는다.
import type { Manifest } from '../../games/types.ts'
import { rpc } from '../../lib/api.ts'
import { now } from '../../lib/serverTime.ts'
import { kstDate } from '../../shared/kst.ts'
import { syncServerTime } from '../contests/clock.ts'
import { getMyContestIds, listContests, type ContestRow } from '../contests/data.ts'
import { phaseOf } from '../contests/format.ts'
import type { DuelList, DuelListItem } from '../duel/data.ts'

export type Badge = 'daily' | 'duels' | 'contests'
export type Shortcut = { key: string; label: string; to: string; badge: Badge | null; gameId?: string }

const DAY_MS = 24 * 3_600_000

export function buildShortcuts(mods: { manifest: Manifest }[], isAdmin: boolean): Shortcut[] {
  const visible = mods.map((x) => x.manifest).filter((m) => !m.hidden || isAdmin)
  return [
    ...visible.filter((m) => m.modes.daily).map((m): Shortcut => (
      { key: `daily:${m.id}`, label: `데일리 ${m.name}`, to: `/play/${m.id}/daily`, badge: 'daily', gameId: m.id })),
    { key: 'duel', label: '대전', to: '/duel', badge: 'duels' },
    { key: 'contests', label: '대회', to: '/contests', badge: 'contests' },
    ...visible.filter((m) => m.modes.free).map((m): Shortcut => (
      { key: `free:${m.id}`, label: m.name, to: `/play/${m.id}/free`, badge: null, gameId: m.id })),
  ]
}

/** 하나뿐이면 그곳으로 바로, 아니면 목록(클릭 수 유지, 설계 §4.3) */
export function shortcutTarget(base: string, items: { id: string }[], pathOf: (id: string) => string): string {
  return items.length === 1 ? pathOf(items[0].id) : base
}

/** 오늘(KST, 서버 시계) 이 게임 데일리를 끝냈는가 */
export async function loadDailyDone(gameId: string, userId: string): Promise<boolean> {
  const rows = await rpc<{ user_id: string }[] | null>('lb_daily', { p_day: kstDate(now()), p_game: gameId })
  return (rows ?? []).some((r) => r.user_id === userId)
}

/** 끝나지 않은 내 대국: 진행 중 + 상대를 기다리는 내 방(옛 홈 대전 블록이 바로 링크하던 범위, 설계 §2 클릭 수) */
export async function loadMyOpenDuels(): Promise<DuelListItem[]> {
  const r = await rpc<DuelList | null>('duel_list')
  return (r?.mine ?? []).filter((d) => d.status === 'active' || d.status === 'waiting')
}

/** 공개이거나 내가 참가했고, 취소되지 않았으며 진행 중이거나 24시간 안에 시작하는 대회(옛 홈 대회 블록과 같은 범위) */
export async function loadOpenContests(userId: string): Promise<ContestRow[]> {
  await syncServerTime()
  const t = now()
  const [all, mine] = await Promise.all([listContests(t), getMyContestIds(userId)])
  return all.filter((c) => {
    if (c.visibility !== 'public' && !mine.has(c.id)) return false
    const p = phaseOf(c, t)
    return p === 'live' || (p === 'lobby' && Date.parse(c.starts_at) - t <= DAY_MS)
  })
}
