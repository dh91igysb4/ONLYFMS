import { expect, test, vi } from 'vitest'

vi.mock('../../games/index.ts', () => ({
  games: [
    { manifest: { id: 'pub', name: '공개 게임', hidden: false } },
    { manifest: { id: 'sec', name: '숨김 게임', hidden: true } },
  ],
  duels: [{ manifest: { id: 'duel1', name: '대전 게임', hidden: false } }],
  worlds: [
    { manifest: { id: 'world1', name: '월드 게임', hidden: false } },
    { manifest: { id: 'wsec', name: '숨김 월드', hidden: true } },
  ],
}))

import { SITE_TARGET, suggestTargets, targetName } from './targets.ts'

test('일반 사용자는 숨김 게임이 빠진다', () => {
  expect(suggestTargets(false)).toEqual([
    { id: 'pub', name: '공개 게임' }, { id: 'duel1', name: '대전 게임' }, { id: 'world1', name: '월드 게임' },
    { id: 'site', name: '사이트' },
  ])
})

test('관리자는 숨김 게임도 본다', () => {
  expect(suggestTargets(true).map((t) => t.id)).toEqual(['pub', 'sec', 'duel1', 'world1', 'wsec', 'site'])
})

test('targetName', () => {
  expect(SITE_TARGET).toBe('site')
  expect(targetName('site')).toBe('사이트')
  expect(targetName('sec')).toBe('숨김 게임')
  expect(targetName('wsec')).toBe('숨김 월드')
  expect(targetName('zzz')).toBe('zzz')
})
