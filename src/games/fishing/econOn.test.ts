// 운영 경제 기능 플래그(2026-11-28 네 개 모두 켬). 바꾸면 world를 다시 배포해야 서버도 따른다(CLAUDE.md).
import { describe, expect, it } from 'vitest'
import { ECONOMY_FLAGS } from './research.ts'

describe('경제 기능 플래그 운영 값', () => {
  it('밑밥·연구·전시·연금 모두 켜짐', () => {
    expect(ECONOMY_FLAGS).toEqual({ bait: true, research: true, exhibit: true, alchemy: true })
  })
})
