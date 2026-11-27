import { expect, test } from 'vitest'
import type { Manifest } from '../../games/types.ts'
import { gameSections } from './sections.ts'

const m = (id: string, extra: Partial<Manifest> = {}) => ({ id, name: id, ...extra }) as Manifest

test('주제 구역이 먼저, 나머지는 다른 게임. 구역 안에서는 지속형 게임이 먼저', () => {
  const solo = [m('a'), m('wya', { topic: 'football' }), m('b'), m('cq', { topic: 'football' })]
  const worlds = [m('fish', { category: 'world' })]
  const s = gameSections(solo, worlds)
  expect(s.map((x) => [x.title, x.games.map((g) => g.id)])).toEqual([
    ['축구', ['wya', 'cq']],
    ['다른 게임', ['fish', 'a', 'b']],
  ])
})

test('빈 구역은 뺀다', () => {
  expect(gameSections([m('a')], []).map((x) => x.title)).toEqual(['다른 게임'])
  expect(gameSections([], [])).toEqual([])
})
