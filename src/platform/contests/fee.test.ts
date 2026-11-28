import { expect, test } from 'vitest'
import { FEE_MAX } from '../../games/economy.ts'
import { ApiError } from '../../lib/api.ts'
import { feeCap, feeOf, feePresets, feeProblem, mismatchFee, parseFee, splitPool } from './fee.ts'

test('feeOf: 없거나 0 이하면 0', () => {
  expect(feeOf({ entry_fee: 1000 })).toBe(1000)
  expect(feeOf({})).toBe(0)
  expect(feeOf({ entry_fee: null })).toBe(0)
  expect(feeOf(null)).toBe(0)
})

test('parseFee: 빈칸 0, 쉼표 허용, 정수만', () => {
  expect(parseFee('')).toBe(0)
  expect(parseFee('1,000')).toBe(1000)
  expect(parseFee('1.5')).toBeNull()
  expect(parseFee('-1')).toBeNull()
  expect(parseFee('abc')).toBeNull()
})

test('상한은 min(잔액, FEE_MAX), 빠른 선택은 상한 이하', () => {
  expect(FEE_MAX).toBe(41000)
  expect(feeCap(null)).toBe(FEE_MAX)
  expect(feeCap(700)).toBe(700)
  expect(feeCap(100000)).toBe(FEE_MAX)
  expect(feePresets(700)).toEqual([0, 100, 500])
})

test('feeProblem 문구', () => {
  expect(feeProblem(0, 0)).toBeNull()
  expect(feeProblem(null, 0)).toBe('참가비를 다시 적어 주세요')
  expect(feeProblem(41001, null)).toBe('참가비는 41,000 JWD까지예요')
  expect(feeProblem(1000, 999)).toBe('JWD가 부족해요')
  expect(feeProblem(1000, null)).toBeNull()
})

test('splitPool: 서버와 같은 규칙(0명 환불, 1~2명 독식, 60/30/10 나머지 1등)', () => {
  expect(splitPool(3000, 0)).toEqual([])
  expect(splitPool(2000, 1)).toEqual([2000])
  expect(splitPool(3000, 2)).toEqual([3000])
  expect(splitPool(3000, 3)).toEqual([1800, 900, 300])
  expect(splitPool(5000, 5)).toEqual([3000, 1500, 500])
  expect(splitPool(3003, 3)).toEqual([1803, 900, 300])
  expect(splitPool(21, 3)).toEqual([13, 6, 2])
})

test('mismatchFee: fee_mismatch의 DETAIL', () => {
  expect(mismatchFee(new ApiError('fee_mismatch', 400, { details: '700' }))).toBe(700)
  expect(mismatchFee(new ApiError('fee_mismatch', 400))).toBeNull()
  expect(mismatchFee(new ApiError('forbidden', 403, { details: '700' }))).toBeNull()
})
