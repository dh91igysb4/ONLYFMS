// 섬 시설 외형 자리와 목록.
import { describe, expect, it } from 'vitest'
import { FACILITIES } from './gallery.ts'
import { FACILITY_SIZE, FACILITY_SPOTS, facilityScene, isFacilityId, ownedFacilities } from './facility.ts'
import { isleMap } from './isle.ts'
import { ISLE_LAYOUTS } from './data.ts'
import { tileAt } from './map.ts'
import { HOUSE_MAX } from './isleEcon.ts'

describe('섬 시설 외형', () => {
  it('모든 섬 모양·시설 자리: 칸과 둘레 2칸이 모두 바다이고, 3칸 안에 땅이 있으며 서로 겹치지 않는다', () => {
    for (const layout of ISLE_LAYOUTS) {
      // 다 치우고 집을 다 지은 섬에서도 자리가 바다여야 한다
      const m = isleMap(layout.id, 99, HOUSE_MAX)
      const used = new Set<string>()
      for (const f of FACILITIES) {
        const { tx, ty } = FACILITY_SPOTS[layout.id][f.id]
        const { w, h } = FACILITY_SIZE[f.id]
        let land = false
        for (let x = tx - 3; x < tx + w + 3; x++) {
          for (let y = ty - 3; y < ty + h + 3; y++) {
            const water = tileAt(m, x, y) === 'water'
            const inner = x >= tx - 2 && x < tx + w + 2 && y >= ty - 2 && y < ty + h + 2
            if (inner) expect(water, `${layout.id} ${f.id} ${x},${y}`).toBe(true)
            else if (!water) land = true
          }
        }
        expect(land, `${layout.id} ${f.id}`).toBe(true)
        for (let x = tx; x < tx + w; x++) for (let y = ty; y < ty + h; y++) {
          expect(used.has(`${x},${y}`)).toBe(false)
          used.add(`${x},${y}`)
        }
      }
    }
  })
  it('가진 시설만, FACILITIES 순서로, 모르는 값은 버린다', () => {
    expect(ownedFacilities(['sea-bg', 'observatory', 'lighthouse'])).toEqual(['lighthouse', 'observatory'])
    expect(ownedFacilities([])).toEqual([])
    expect(facilityScene('twin', ['spring', 'nope', 3])).toEqual([{ id: 'spring', ...FACILITY_SPOTS.twin.spring }])
    expect(isFacilityId('spring')).toBe(true)
    expect(isFacilityId('sea-bg')).toBe(false)
  })
})
