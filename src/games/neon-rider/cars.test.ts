import { describe, expect, it } from 'vitest'
import { CARS, CAR_REACH_MAX, DEFAULT_CAR, carById } from './cars.ts'
import { BODY_DY, BODY_R, HEAD_OFFSET, HEAD_R, MM, WHEEL_R } from './constants.ts'

const roof = (c: { headOffset: number; headR: number }): number => c.headOffset + c.headR

describe('차 정의 (설계 §5)', () => {
  it('표의 6대: 순서·이름·가격·판정 치수(mm)', () => {
    expect(CARS.map((c) => [c.id, c.label, c.price, c.headOffset / MM, c.headR / MM, c.bodyDY / MM, c.bodyR / MM])).toEqual([
      ['coupe', '쿠페', 0, 200, 180, 150, 190],
      ['pickup', '픽업', 5000, 270, 180, 150, 190],
      ['buggy', '버기', 15000, 160, 170, 120, 170],
      ['sports', '스포츠카', 30000, 130, 150, 90, 150],
      ['f1', 'F1', 60000, 100, 130, 60, 130],
      ['skate', '스케이트보드', 100000, 80, 120, 40, 120],
    ])
    for (const c of CARS) for (const v of [c.headOffset, c.headR, c.bodyDY, c.bodyR]) expect(v % MM).toBe(0)
  })

  it('지붕 높이 순서: pickup > coupe > buggy > sports > f1 > skate', () => {
    const order = ['pickup', 'coupe', 'buggy', 'sports', 'f1', 'skate']
    for (let i = 1; i < order.length; i++) expect(roof(carById(order[i - 1]))).toBeGreaterThan(roof(carById(order[i])))
  })

  it('모든 차: 캡슐 아래 끝은 바퀴 바닥보다 위, 위 끝은 지붕 이하', () => {
    for (const c of CARS) {
      expect(c.bodyDY - c.bodyR, c.id).toBeGreaterThan(-WHEEL_R)
      expect(c.bodyDY + c.bodyR, c.id).toBeLessThanOrEqual(roof(c))
    }
  })

  it('쿠페는 지금 상수와 같다', () => {
    const c = carById('coupe')
    expect([c.headOffset, c.headR, c.bodyDY, c.bodyR]).toEqual([HEAD_OFFSET, HEAD_R, BODY_DY, BODY_R])
    expect(DEFAULT_CAR).toBe('coupe')
  })

  it('모르는 id·undefined는 쿠페', () => {
    expect(carById('zzz').id).toBe('coupe')
    expect(carById(undefined).id).toBe('coupe')
    expect(carById('skate').id).toBe('skate')
  })

  it('CAR_REACH_MAX는 모든 차의 판정이 축선에서 닿는 최대 거리(픽업 지붕 450 mm)', () => {
    expect(CAR_REACH_MAX).toBe(450 * MM)
    for (const c of CARS) expect(Math.max(roof(c), c.bodyDY + c.bodyR)).toBeLessThanOrEqual(CAR_REACH_MAX)
  })
})
