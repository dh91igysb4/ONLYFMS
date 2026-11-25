import { describe, expect, it } from 'vitest'
import type { FameBoard, HallOfFame } from '../../platform/world/hallOfFame.ts'
import { SPECIES } from './data.ts'
import { allBoards, boardIndexFor, fameFrames } from './fame.ts'

const board = (gameId: string, group: FameBoard['group'], key: string, rows: FameBoard['rows'] = []): FameBoard =>
  ({ gameId, group, key, title: gameId, label: key, rows })
const fish = SPECIES[0]
const hof = (siteCount: number): HallOfFame => ({
  records: [
    board('fishing', 'record', 'total_earned'),
    board('fishing', 'record', 'biggest', [{ handle: 'kane', text: '48cm', detail: fish.name, avatar: 'AV' }]),
    board('fishing', 'record', 'dex'),
    board('fishing', 'record', 'challenges'),
    board('other-world', 'record', 'score'),
  ],
  site: Array.from({ length: siteCount }, (_, i) => board(`g${i}`, 'free', 'free', i === 0 ? [{ handle: 'son', text: '1', detail: null, avatar: 'AV2' }] : [])),
})

describe('allBoards / boardIndexFor', () => {
  it('통합 목록 = 이 게임 기록 게시판 + 사이트 게시판(다른 지속형 게임 기록은 빠진다)', () => {
    const all = allBoards(hof(3), 'fishing')
    expect(all.map((b) => `${b.gameId}:${b.key}`)).toEqual(['fishing:total_earned', 'fishing:biggest', 'fishing:dex', 'fishing:challenges', 'g0:free', 'g1:free', 'g2:free'])
  })
  it('record 칸은 그 키의 위치, site 칸은 기록 수 + index, 없으면 null', () => {
    const h = hof(3)
    expect(boardIndexFor(h, 'fishing', { group: 'record', key: 'dex' })).toBe(2)
    expect(boardIndexFor(h, 'fishing', { group: 'site', index: 0 })).toBe(4)
    expect(boardIndexFor(h, 'fishing', { group: 'site', index: 3 })).toBeNull()
    expect(boardIndexFor(h, 'fishing', { group: 'record', key: 'zzz' })).toBeNull()
  })
})

describe('fameFrames', () => {
  it('박제(16, biggest 1위 어종 id) · 액자 18·19·20 · 게임 액자 24+i(최대 11개)', () => {
    const f = fameFrames(hof(12), 'fishing')
    expect(f[0]).toEqual({ tx: 16, look: 'mount', species: fish.id, avatar: 'AV', empty: false })
    expect(f.slice(1, 4).map((x) => [x.tx, x.look, x.empty])).toEqual([[18, 'frame', true], [19, 'frame', true], [20, 'frame', true]])
    const games = f.slice(4)
    expect(games).toHaveLength(11)
    expect(games.map((x) => x.tx)).toEqual(Array.from({ length: 11 }, (_, i) => 24 + i))
    expect(games[0]).toEqual({ tx: 24, look: 'frame', species: null, avatar: 'AV2', empty: false })
  })
  it('모르는 어종 이름이면 species null', () => {
    const h = hof(0)
    h.records[1] = board('fishing', 'record', 'biggest', [{ handle: 'kane', text: '1cm', detail: '없는물고기', avatar: null }])
    expect(fameFrames(h, 'fishing')[0].species).toBeNull()
  })
  it('hof가 null이면 낚시 4개만, 모두 empty', () => {
    const f = fameFrames(null, 'fishing')
    expect(f.map((x) => [x.tx, x.look, x.empty])).toEqual([[16, 'mount', true], [18, 'frame', true], [19, 'frame', true], [20, 'frame', true]])
  })
})
