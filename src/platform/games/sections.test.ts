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

test('구역이 둘이면 게임이 더 많은 쪽이 wide, 같으면 뒤쪽', () => {
  const fb = m('wya', { topic: 'football' })
  expect(gameSections([fb, m('a'), m('b')], []).map((x) => x.wide)).toEqual([false, true])
  expect(gameSections([fb, m('cq', { topic: 'football' }), m('a')], []).map((x) => x.wide)).toEqual([true, false])
  expect(gameSections([fb, m('a')], []).map((x) => x.wide)).toEqual([false, true])
  expect(gameSections([m('a')], []).map((x) => x.wide)).toEqual([false])
})
