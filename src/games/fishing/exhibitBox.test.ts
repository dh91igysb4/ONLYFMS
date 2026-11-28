// 전시관 유리 상자와 물고기 위치: 16×16 물고기 그림이 상자 안쪽(유리)에 딱 맞게 들어간다(전엔 칸 가운데에서 시작해 오른쪽으로 삐져나왔다).
import { expect, test } from 'vitest'
import { exhibitBox } from './scene.ts'
import { TILE } from './map.ts'
import { SPRITES } from './sprites.ts'
import { HALL2_PEDESTALS } from './maps/hall2.ts'

test('모든 전시 어종: 물고기 그림이 유리 안쪽 상자 안에 있고, 유리는 받침대 칸 가운데', () => {
  for (const [id, at] of Object.entries(HALL2_PEDESTALS)) {
    const sp = SPRITES[`fish-${id}`]
    const b = exhibitBox(at.tx, at.ty, sp.w, sp.h)
    expect(b.fish.x).toBeGreaterThanOrEqual(b.inner.x)
    expect(b.fish.y).toBeGreaterThanOrEqual(b.inner.y)
    expect(b.fish.x + sp.w).toBeLessThanOrEqual(b.inner.x + b.inner.w)
    expect(b.fish.y + sp.h).toBeLessThanOrEqual(b.inner.y + b.inner.h)
    expect(b.edge.x + b.edge.w / 2).toBe(at.tx * TILE + TILE / 2)
  }
})
