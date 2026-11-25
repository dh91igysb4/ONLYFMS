import { describe, expect, it } from 'vitest'
import { AREAS, TP_BASE, TP_PER_10, type AreaId } from './data.ts'
import { MAPS } from './maps/index.ts'
import { teleportFee, teleporterWorld } from './teleport.ts'

// 이동기가 있는 지역(1차 마을회관은 이동기 없음)
const IDS = AREAS.map((a) => a.id).filter((id) => MAPS[id]?.teleporter)
const pairs = (ids: AreaId[]) => ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b] as const))

describe('teleporterWorld', () => {
  it('맵 world 원점 + 이동기 칸 사각형 중심(칸 단위)', () => {
    for (const id of IDS) {
      const m = MAPS[id]!
      const t = m.teleporter!.tiles
      expect(teleporterWorld(id)).toEqual({ x: m.world.tx + t.tx + t.w / 2, y: m.world.ty + t.ty + t.h / 2 })
    }
  })
})

describe('teleportFee', () => {
  it('TP_BASE + ceil(dist/10) * TP_PER_10, 같은 곳은 TP_BASE, 대칭', () => {
    for (const [a, b] of pairs(IDS)) {
      const p = teleporterWorld(a)!
      const q = teleporterWorld(b)!
      expect(teleportFee(a, b), `${a}→${b}`).toBe(TP_BASE + Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / 10) * TP_PER_10)
      expect(teleportFee(a, b)).toBe(teleportFee(b, a))
    }
    expect(teleportFee('village', 'village')).toBe(TP_BASE)
  })

  it('이웃 지역은 싸고(마을↔강 ≤ 40), 섬(과 그 너머 난파선)과의 요금은 뭍 쌍의 최대 요금의 세 배 이상', () => {
    expect(teleportFee('village', 'river')).toBeLessThanOrEqual(40)
    const land = IDS.filter((id) => id !== 'island' && id !== 'wreck')
    const maxLand = Math.max(...pairs(land).map(([a, b]) => teleportFee(a, b)))
    for (const id of land) expect(teleportFee(id, 'island'), id).toBeGreaterThanOrEqual(3 * maxLand)
  })
})
