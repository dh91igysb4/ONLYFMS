import { describe, expect, test } from 'vitest'
import { homeBlockIds, homeBlocks } from './blocks.ts'

describe('홈 블록 등록부', () => {
  test('모든 id는 ^[a-z0-9-]{1,32}$ 형식이다', () => {
    for (const b of homeBlocks) {
      expect(b.id).toMatch(/^[a-z0-9-]{1,32}$/)
    }
  })

  test('id는 중복되지 않는다', () => {
    expect(new Set(homeBlockIds).size).toBe(homeBlockIds.length)
  })

  test('개수는 32 이하이다', () => {
    expect(homeBlocks.length).toBeLessThanOrEqual(32)
  })

  test('homeBlockIds는 정해진 순서와 정확히 같다', () => {
    expect(homeBlockIds).toEqual(['daily', 'contests', 'duels', 'weekly', 'elo', 'streak'])
  })

  test('제목은 정해진 문구와 순서로 등록되어 있다', () => {
    expect(homeBlocks.map((b) => [b.id, b.title])).toEqual([
      ['daily', '오늘의 데일리'],
      ['contests', '대회'],
      ['duels', '대전'],
      ['weekly', '이번 주 순위'],
      ['elo', '대전 레이팅'],
      ['streak', '내 기록'],
    ])
  })

  test('homeBlockIds는 homeBlocks의 id와 일치한다', () => {
    expect(homeBlockIds).toEqual(homeBlocks.map((b) => b.id))
  })
})
