import { expect, test } from 'vitest'
import { STAKE_MAX } from '../../games/economy.ts'
import { parseStake, stakeCap, stakeOf, stakeOutcome, stakeProblem, stakePresets } from './stake.ts'

test('stakeOf: 없으면 0 (옛 함수·옛 목록)', () => {
  expect(stakeOf({})).toBe(0)
  expect(stakeOf({ stake: null })).toBe(0)
  expect(stakeOf({ stake: 500 })).toBe(500)
})

test('parseStake: 숫자·쉼표만, 정수', () => {
  expect(parseStake('')).toBe(0)
  expect(parseStake('1,000')).toBe(1000)
  expect(parseStake(' 500 ')).toBe(500)
  expect(parseStake('1.5')).toBeNull()
  expect(parseStake('-3')).toBeNull()
  expect(parseStake('abc')).toBeNull()
})

test('stakeCap: min(잔액, STAKE_MAX), 잔액을 모르면 STAKE_MAX', () => {
  expect(stakeCap(1200)).toBe(1200)
  expect(stakeCap(100000)).toBe(STAKE_MAX)
  expect(stakeCap(null)).toBe(STAKE_MAX)
})

test('stakePresets: 상한 이하만, 0은 언제나', () => {
  expect(stakePresets(1200)).toEqual([0, 100, 500, 1000])
  expect(stakePresets(0)).toEqual([0])
  expect(stakePresets(null)).toEqual([0, 100, 500, 1000, 5000, 10000])
})

test('stakeProblem', () => {
  expect(stakeProblem(null, 1000)).toBe('판돈을 다시 적어 주세요')
  expect(stakeProblem(STAKE_MAX + 1, null)).toBe('판돈은 41,000 JWD까지예요')
  expect(stakeProblem(1500, 1000)).toBe('JWD가 부족해요')
  expect(stakeProblem(1000, 1000)).toBeNull()
  expect(stakeProblem(0, 0)).toBeNull()
  expect(stakeProblem(500, null)).toBeNull()
})

test('stakeOutcome', () => {
  const v = (o: Record<string, unknown>) => ({ status: 'finished', winner: 0, my_seat: 0, stake: 1000, ...o }) as never
  expect(stakeOutcome(v({}))).toEqual({ kind: 'won', amount: 2000 })
  expect(stakeOutcome(v({ winner: 1 }))).toEqual({ kind: 'lost', amount: 1000 })
  expect(stakeOutcome(v({ winner: null }))).toEqual({ kind: 'refund', amount: 1000 })
  expect(stakeOutcome(v({ status: 'void', winner: null }))).toEqual({ kind: 'refund', amount: 1000 })
  expect(stakeOutcome(v({ stake: 0 }))).toBeNull()
  expect(stakeOutcome(v({ my_seat: null }))).toBeNull()
  // 대기 중 취소·만료: 만든 사람은 아직 자리가 없다(my_seat null)
  expect(stakeOutcome(v({ status: 'void', winner: null, my_seat: null }))).toEqual({ kind: 'refund', amount: 1000 })
  expect(stakeOutcome(v({ status: 'active' }))).toBeNull()
})

test('stakeOutcome: 서버가 준 장부 금액(stake_settled)을 우선한다', () => {
  const v = (o: Record<string, unknown>) => ({ status: 'finished', winner: 0, my_seat: 0, stake: 1000, ...o }) as never
  // 진 사람 계정이 지워져 승자가 남은 판돈만 받음
  expect(stakeOutcome(v({ stake_settled: { staked: 1000, payout: 1000, refund: 0 } }))).toEqual({ kind: 'won', amount: 1000 })
  // 이긴 사람 계정이 지워져 진 사람이 환불받음
  expect(stakeOutcome(v({ winner: 1, stake_settled: { staked: 1000, payout: 0, refund: 1000 } }))).toEqual({ kind: 'refund', amount: 1000 })
  expect(stakeOutcome(v({ winner: 1, stake_settled: { staked: 1000, payout: 0, refund: 0 } }))).toEqual({ kind: 'lost', amount: 1000 })
  // 맡긴 것도 받은 것도 없으면 표시 없음
  expect(stakeOutcome(v({ status: 'void', winner: null, stake_settled: { staked: 0, payout: 0, refund: 0 } }))).toBeNull()
})
