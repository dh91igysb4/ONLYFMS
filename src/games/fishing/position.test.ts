import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadPosition, savePosition } from './position.ts'
import { PIER_END, SPAWN, TILE } from './map.ts'

const KEY = 'fishing-pos:u1'
const center = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('position', () => {
  test('save then load round-trips, keyed by user', () => {
    const p = { pos: center(PIER_END.tx, PIER_END.ty), facing: 'left' as const }
    savePosition('u1', p)
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(p)
    expect(loadPosition('u1')).toEqual(p)
    expect(loadPosition('u2')).toBeNull()
  })

  test('the spawn position itself is valid', () => {
    savePosition('u1', SPAWN)
    expect(loadPosition('u1')).toEqual(SPAWN)
  })

  test('nothing saved, broken JSON or a wrong shape gives null', () => {
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, '{not json')
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, 'null')
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ pos: { x: '200', y: 104 }, facing: 'down' }))
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ pos: { x: 200, y: 104 }, facing: 'north' }))
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ pos: { x: 200, y: 104 } }))
    expect(loadPosition('u1')).toBeNull()
  })

  test('non-finite coordinates give null', () => {
    // JSON에는 NaN·Infinity가 없어 null이 되지만, 아주 큰 수는 Infinity로 읽힌다
    localStorage.setItem(KEY, '{"pos":{"x":1e999,"y":104},"facing":"down"}')
    expect(loadPosition('u1')).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ pos: { x: NaN, y: 104 }, facing: 'down' }))
    expect(loadPosition('u1')).toBeNull()
  })

  test('a position on an unwalkable tile or off the map gives null', () => {
    savePosition('u1', { pos: center(10, 30), facing: 'down' }) // 바다
    expect(loadPosition('u1')).toBeNull()
    savePosition('u1', { pos: center(0, 0), facing: 'down' }) // 나무
    expect(loadPosition('u1')).toBeNull()
    savePosition('u1', { pos: { x: -40, y: 104 }, facing: 'down' })
    expect(loadPosition('u1')).toBeNull()
  })

  test('a position whose feet overlap an unwalkable tile gives null even if its centre tile is walkable', () => {
    // 부두 끝 타일 가운데에서 왼쪽으로 7px: 중심은 부두지만 발(폭 10) 왼쪽이 물에 걸친다
    const end = center(PIER_END.tx, PIER_END.ty)
    savePosition('u1', { pos: { x: end.x - 7, y: end.y }, facing: 'down' })
    expect(loadPosition('u1')).toBeNull()
    // 발이 타일 안에 딱 맞으면(왼쪽 변이 경계) 괜찮다
    savePosition('u1', { pos: { x: end.x - 3, y: end.y }, facing: 'down' })
    expect(loadPosition('u1')).not.toBeNull()
  })

  test('a throwing localStorage gives null and never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(loadPosition('u1')).toBeNull()
    expect(() => savePosition('u1', SPAWN)).not.toThrow()
  })
})
