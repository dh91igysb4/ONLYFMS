// 선수 더하기 (addPlayers.ts)
import { expect, test } from 'vitest'
import { mergeRows, popularityAgainst } from './addPlayers.ts'

test('popularity_is_percentile_among_existing_plus_new', () => {
  // 기존 [1,2,3,4] + 새 [5, 1] → 정렬 [1,1,2,3,4,5]: 5는 아래 5개/5 = 100, 1은 0
  expect([...popularityAgainst([1, 2, 3, 4], new Map([['Q9', 5], ['Q8', 1]]))]).toEqual([['Q9', 100], ['Q8', 0]])
  // 3 → 아래 [1,2] 2개 / (5-1) = 50
  expect(popularityAgainst([1, 2, 4, 5], new Map([['Q7', 3]])).get('Q7')).toBe(50)
})

test('merge_replaces_same_key_and_keeps_others', () => {
  const old = [{ entity_id: 'Q1', alias: 'A', lang: 'en' }, { entity_id: 'Q2', alias: 'B', lang: 'en' }]
  const add = [{ entity_id: 'Q2', alias: 'B', lang: 'ko' }, { entity_id: 'Q3', alias: 'C', lang: 'en' }]
  expect(mergeRows('aliases', old, add)).toEqual([{ entity_id: 'Q1', alias: 'A', lang: 'en' }, { entity_id: 'Q2', alias: 'B', lang: 'ko' }, { entity_id: 'Q3', alias: 'C', lang: 'en' }])
})
