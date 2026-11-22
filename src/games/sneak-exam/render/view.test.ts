import { describe, expect, it } from 'vitest'
import { CAM, offscreenSide } from './view.ts'
import { ME_X, ME_Z } from '../constants.ts'

describe('CAM', () => {
  it('내 자리 눈높이에 있다', () => {
    expect(CAM).toEqual({ x: ME_X, y: 1150, z: ME_Z, fovY: 60 })
  })
})

describe('offscreenSide', () => {
  it('카메라와 같은 줄이면 dx 부호(0이면 왼쪽)', () => {
    expect(offscreenSide(0, 1000, 9 / 16)).toBe(-1)
    expect(offscreenSide(1800, 1000, 9 / 16)).toBe(1)
    expect(offscreenSide(ME_X, 1100, 9 / 16)).toBe(-1)
  })
  it('시야 안이면 0', () => {
    expect(offscreenSide(0, 8200, 9 / 16)).toBe(0)
    expect(offscreenSide(900, 5000, 9 / 16)).toBe(0)
    expect(offscreenSide(3600, 8200, 16 / 9)).toBe(0)
  })
  it('시야 옆으로 벗어나면 그쪽', () => {
    expect(offscreenSide(-3600, 2400, 9 / 16)).toBe(-1)
    expect(offscreenSide(3600, 2400, 9 / 16)).toBe(1)
  })
})
