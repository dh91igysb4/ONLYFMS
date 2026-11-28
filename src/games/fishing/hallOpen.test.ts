// 마을회관 1층 정리: 복도 바닥 점선(반사 줄)과 왼쪽 로비 가운데 소파 벽을 뺐다.
import { expect, test } from 'vitest'
import { HALL_INTERIOR } from './hallArt.ts'
import { HALL } from './maps/hall.ts'
import { isWalkable } from './map.ts'

test('왼쪽 로비(자판기 상점 ↔ 순간이동기 사이) 가운데 칸 x4~6, y8은 걸을 수 있다', () => {
  for (const tx of [4, 5, 6]) expect(isWalkable(HALL, tx, 8, new Set())).toBe(true)
})

test('회관 실내 그림에 복도 점선 색(#8a9bb5)·로비 소파 색(#3f6e8c)이 없다', () => {
  const colors = Object.values(HALL_INTERIOR.palette)
  expect(colors).not.toContain('#8a9bb5')
  expect(colors).not.toContain('#3f6e8c')
})
