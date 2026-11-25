// 마을회관 명예의 전당: 액자 칸(맵 fixtures의 FameSlot) ↔ 게시판, 장면에 그릴 액자 목록. 순수 모듈.
// 칸 자리는 maps/hall.ts와 같다: 박제(최대어) tx 16~17, 낚시 액자 tx 18·19·20, 게임 액자 tx 24+i(최대 11개), 모두 1줄(ty 1).
import type { FameBoard, HallOfFame } from '../../platform/world/hallOfFame.ts'
import { SPECIES } from './data.ts'
import type { FameSlot } from './map.ts'

export const FAME_ROW = 1
export const FAME_SITE_TX = 24
export const FAME_SITE_MAX = 11
const RECORD_FRAMES: readonly { tx: number; key: string }[] = [{ tx: 18, key: 'total_earned' }, { tx: 19, key: 'dex' }, { tx: 20, key: 'challenges' }]
const MOUNT = { tx: 16, key: 'biggest' }

export type FameFrame = { tx: number; look: 'mount' | 'frame'; species: string | null; avatar: string | null; empty: boolean }

/** 패널에서 넘겨 볼 통합 목록: 이 게임의 기록 게시판(manifest 순서) + 사이트 게시판 */
export function allBoards(hof: HallOfFame, gameId: string): FameBoard[] {
  return [...hof.records.filter((b) => b.gameId === gameId), ...hof.site]
}

/** 액자 칸이 통합 목록에서 몇 번째인가. 없으면 null */
export function boardIndexFor(hof: HallOfFame, gameId: string, slot: FameSlot): number | null {
  const own = hof.records.filter((b) => b.gameId === gameId)
  if (slot.group === 'record') {
    const i = own.findIndex((b) => b.key === slot.key)
    return i < 0 ? null : i
  }
  return slot.index >= 0 && slot.index < hof.site.length ? own.length + slot.index : null
}

/** 장면에 그릴 액자들. hof가 없으면(아직 못 불러옴) 낚시 자리만 빈 액자로 */
export function fameFrames(hof: HallOfFame | null, gameId: string): FameFrame[] {
  const top = (key: string) => hof?.records.find((b) => b.gameId === gameId && b.key === key)?.rows[0] ?? null
  const big = top(MOUNT.key)
  const out: FameFrame[] = [{
    tx: MOUNT.tx, look: 'mount', species: SPECIES.find((s) => s.name === big?.detail)?.id ?? null, avatar: big?.avatar ?? null, empty: !big,
  }]
  for (const { tx, key } of RECORD_FRAMES) {
    const r = top(key)
    out.push({ tx, look: 'frame', species: null, avatar: r?.avatar ?? null, empty: !r })
  }
  for (const [i, b] of (hof?.site ?? []).slice(0, FAME_SITE_MAX).entries()) {
    const r = b.rows[0] ?? null
    out.push({ tx: FAME_SITE_TX + i, look: 'frame', species: null, avatar: r?.avatar ?? null, empty: !r })
  }
  return out
}
