import { describe, expect, it } from 'vitest'
import { defineMap } from './map.ts'
import { computeGround } from './ground.ts'

describe('computeGround', () => {
  it('물 위 바위는 물, 풀밭 바위는 풀, 부두는 물, 절벽은 null', () => {
    const m = defineMap('village', ['~~~,,', '~o~,o', '~#~,c'], { spots: { water: 'shore' } })
    const g = computeGround(m, 'high')
    const at = (x: number, y: number) => g[y * m.w + x]
    expect(at(1, 1)).toBe('water')
    expect(at(4, 1)).toBe('grass')
    expect(at(1, 2)).toBe('water')
    expect(at(4, 2)).toBeNull()
  })
})
