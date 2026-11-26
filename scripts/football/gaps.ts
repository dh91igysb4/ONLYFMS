// 빠진 경력 찾기 (순수 함수). 위키백과 정보상자의 성인 클럽 경력과 spells.csv를 비교해 manual/spells.csv에 넣을 add 줄 후보를 만든다.
// 위키데이터 경력이 날짜 없이 있거나(수집에서 빠짐) 아예 없는 경우를 잡는다. 대상 클럽(pool)만 본다. 자동으로 반영하지 않는다.
// 수집 도구: find-gaps.ts (npm run football:gaps)
import { MANUAL_SPELL_COLUMNS } from './manualSpells.ts'

export type Stint = { team: string; from: number; to: number | null; loan: boolean }
export type ManualRow = Record<typeof MANUAL_SPELL_COLUMNS[number], string>

export function wikiUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/'/g, '%27')}`
}

/**
 * stints: 정보상자 경력(클럽 문서를 QID로 바꾼 것, 못 바꾼 칸은 뺀 상태). spells: 그 선수의 기존 경력.
 * 대상 클럽 경력 중 [from, now]와 겹치고 같은 팀 기존 경력과 한 해도 겹치지 않는 것을 add 줄로 돌려준다(연도 단위).
 */
export function findGaps(i: {
  player: string; name: string; title: string; stints: readonly Stint[]
  spells: readonly { team_id: string; start_date: string; end_date: string }[]
  pool: ReadonlySet<string>; from: number; now: number
}): ManualRow[] {
  const year = (d: string) => Number(d.slice(0, 4))
  const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 <= b1 && b0 <= a1
  const out: ManualRow[] = []
  for (const s of i.stints) {
    const end = s.to ?? i.now
    if (!i.pool.has(s.team) || !overlaps(s.from, end, i.from, i.now)) continue
    if (i.spells.some((x) => x.team_id === s.team && overlaps(s.from, end, year(x.start_date), x.end_date ? year(x.end_date) : i.now))) continue
    out.push({
      action: 'add', player_id: i.player, team_id: s.team, source_ref: '', start_date: String(s.from), end_date: s.to === null ? '' : String(s.to),
      loan: String(s.loan), source_url: wikiUrl(i.title), note: `${i.name} · 위키백과 정보상자`,
    })
  }
  return out
}
