// 축구 데이터 선수 검색 (DB RPC football_search, 설계 2026-11-01-football-data-layer-design.md §8).
// 한글·영문 별칭, 악센트 무시, 인지도 순 정렬은 DB가 한다. 승인 사용자만 부를 수 있다.
import { supabase } from './supabase.ts'

export type FootballPlayerHit = {
  id: string
  name_ko: string | null
  name_en: string
  nation_id: string | null
  position: string | null
  birth_year: number | null
}

export async function searchFootballPlayers(q: string, limit = 8): Promise<FootballPlayerHit[]> {
  if (q.trim() === '') return []
  const { data, error } = await supabase.rpc('football_search', { p_q: q, p_kind: 'player', p_lim: limit })
  if (error) throw new Error(error.message)
  return (data ?? []) as FootballPlayerHit[]
}
