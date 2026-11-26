// 선수 자동완성 (화면 전용). football_search RPC + 국적 이름 조회(football_nations, 승인 사용자 읽기).
import { rpc } from '../../lib/api.ts'
import { supabase } from '../../lib/supabase.ts'

export type PlayerHit = { id: string; name: string; nation: string | null; birthYear: number | null }

type Row = { id: string; name_ko: string | null; name_en: string; nation_id: string | null; birth_year: number | null }

// 국적 이름은 바뀌지 않으므로 페이지 수명 동안 기억한다
const nationNames = new Map<string, string>()

async function loadNations(ids: string[]): Promise<void> {
  const need = ids.filter((id) => !nationNames.has(id))
  if (need.length === 0) return
  try {
    const { data } = await supabase.from('football_nations').select('id, name_ko, name_en').in('id', need)
    for (const n of (data ?? []) as { id: string; name_ko: string | null; name_en: string }[]) nationNames.set(n.id, n.name_ko || n.name_en)
  } catch {
    // 국적은 구분용 보조 정보라 못 불러와도 결과는 보여 준다
  }
}

export async function searchPlayers(q: string): Promise<PlayerHit[]> {
  const rows = (await rpc<Row[] | null>('football_search', { p_q: q, p_kind: 'player', p_lim: 8 })) ?? []
  await loadNations([...new Set(rows.map((r) => r.nation_id).filter((x): x is string => !!x))])
  return rows.map((r) => ({
    id: r.id,
    name: r.name_ko || r.name_en,
    nation: r.nation_id ? nationNames.get(r.nation_id) ?? null : null,
    birthYear: r.birth_year ?? null,
  }))
}
