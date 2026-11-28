import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: { rpc: vi.fn() }, supabaseUrl: 'x', supabaseKey: 'k' }))

import { supabase } from '../../lib/supabase.ts'
import { buildHallOfFame, loadHallOfFame } from './hallOfFame.ts'
import { formatFreeScore } from '../games/score.ts'

const raw = {
  records: [
    { game_id: 'fishing', key: 'biggest', handle: 'kane', value: 48.5, detail: '참돔', avatar: 'AV' },
    { game_id: 'fishing', key: 'biggest', handle: 'son', value: 40, detail: '농어', avatar: null },
    { game_id: 'fishing', key: 'total_earned', handle: 'kane', value: 12345, detail: null, avatar: 'AV' },
    { game_id: 'fishing', key: 'avatar', handle: 'kane', value: 0, detail: 'AV', avatar: 'AV' },
  ],
  free: [
    { game_id: 'ball-run', by: 'best', handle: 'kane', wins: 3, plays: 9, best_score: 7.5, avatar: 'AV' },
    { game_id: 'ball-run', by: 'wins', handle: 'son', wins: 9, plays: 9, best_score: 1, avatar: null },
    { game_id: 'who-are-ya', by: 'wins', handle: 'son', wins: 12, plays: 20, best_score: 10, avatar: null },
    { game_id: 'who-are-ya', by: 'best', handle: 'kane', wins: 1, plays: 1, best_score: 10, avatar: null },
  ],
  duel: [{ game_id: 'yacht', handle: 'kane', rating: 1234, rated_games: 7, avatar: 'AV' }],
}

describe('buildHallOfFame', () => {
  const hof = buildHallOfFame(raw, false)

  it('낚시 기록 게시판은 manifest records 순서, 키 avatar 같은 건 없다', () => {
    expect(hof.records.map((b) => b.key)).toEqual(['total_earned', 'biggest', 'dex', 'challenges', 'isle_cleared', 'house', 'deco'])
    expect(hof.records.every((b) => b.group === 'record' && b.gameId === 'fishing' && b.title === '펨타듀 낚시')).toBe(true)
  })

  it('최대어 text는 값+단위, detail은 어종, avatar 그대로', () => {
    const big = hof.records.find((b) => b.key === 'biggest')!
    expect(big.label).toBe('최대어')
    expect(big.rows).toEqual([
      { handle: 'kane', text: '48.5cm', detail: '참돔', avatar: 'AV' },
      { handle: 'son', text: '40cm', detail: '농어', avatar: null },
    ])
    expect(hof.records.find((b) => b.key === 'total_earned')!.rows[0].text).toBe('12,345 JWD')
    expect(hof.records.find((b) => b.key === 'dex')!.rows).toEqual([])
  })

  it('사이트: 자유 플레이 게임(등록부 순서) 다음 대전', () => {
    expect(hof.site.map((b) => b.gameId)).toEqual(['who-are-ya', 'toothbrush', 'ball-run', 'sneak-exam', 'neon-rider', 'career-quiz', 'yacht', 'tiki-taka-toe'])
    expect(hof.site.map((b) => b.group)).toEqual(['free', 'free', 'free', 'free', 'free', 'free', 'duel', 'duel'])
  })

  it('점수 게임은 best 행·최고 점수, 맞히기 게임은 wins 행·맞힌 수, 대전은 레이팅', () => {
    const ball = hof.site.find((b) => b.gameId === 'ball-run')!
    expect(ball.label).toBe('최고 점수')
    expect(ball.title).toBe('볼 런')
    expect(ball.rows.map((r) => r.handle)).toEqual(['kane'])
    expect(ball.rows[0].text).toBe(`${formatFreeScore('ball-run', 7.5)}점`)
    const wya = hof.site.find((b) => b.gameId === 'who-are-ya')!
    expect(wya.label).toBe('맞힌 수')
    expect(wya.rows).toEqual([{ handle: 'son', text: '12번 · 20판', detail: null, avatar: null }])
    const yacht = hof.site.find((b) => b.gameId === 'yacht')!
    expect(yacht.label).toBe('레이팅')
    expect(yacht.rows).toEqual([{ handle: 'kane', text: '1234', detail: null, avatar: 'AV' }])
  })

  it('모양이 틀린 raw는 게시판은 두고 행만 비운다', () => {
    for (const bad of [null, 'x', { records: 3 }, { records: [{ game_id: 'fishing' }] }]) {
      const h = buildHallOfFame(bad, false)
      expect(h.records).toHaveLength(7)
      expect(h.site).toHaveLength(8)
      expect([...h.records, ...h.site].every((b) => b.rows.length === 0), JSON.stringify(bad)).toBe(true)
    }
  })
})

describe('loadHallOfFame', () => {
  beforeEach(() => vi.mocked(supabase.rpc).mockReset())
  it('rpc hall_of_fame(p_avatar_game) 후 build', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: raw, error: null } as never)
    const h = await loadHallOfFame('fishing', false)
    expect(supabase.rpc).toHaveBeenCalledWith('hall_of_fame', { p_avatar_game: 'fishing' })
    expect(h.records.find((b) => b.key === 'biggest')!.rows).toHaveLength(2)
  })
})
