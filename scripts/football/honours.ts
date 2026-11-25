// 선수 단위 우승·대표팀 대회 우승·감독 재임 시즌 계산 (설계 2026-11-25-football-honours-design.md §3.1·§3.5). 순수 함수만.
import type { Calendar, Membership } from './seasons.ts'
import { cmp, type Honour } from './wikidata.ts'

/**
 * 팀 우승(player_id 빈칸) × 시즌 소속 → 선수 우승. 한 시즌 클럽 소속이 둘 이상인 선수의 그 시즌은 만들지 않는다
 * (시즌 중간 이적·반 시즌 임대 제외, §3.1). clubIds에 없는 팀(대표팀)은 소속 수를 셀 때 뺀다.
 */
export function playerTitles(teamWins: readonly Honour[], memberships: readonly Membership[], clubIds: ReadonlySet<string>): Honour[] {
  const wins = new Map<string, string[]>() // season|team → 대회들
  for (const w of teamWins) {
    if (w.player_id !== '' || w.team_id === '') continue
    const k = `${w.season}|${w.team_id}`
    const l = wins.get(k)
    if (l) l.push(w.honour); else wins.set(k, [w.honour])
  }
  const clubsOf = new Map<string, string[]>() // player|season → 클럽들
  for (const m of memberships) {
    if (!clubIds.has(m.team_id)) continue
    const k = `${m.player_id}|${m.season}`
    const l = clubsOf.get(k)
    if (l) l.push(m.team_id); else clubsOf.set(k, [m.team_id])
  }
  const out: Honour[] = []
  for (const [k, teams] of clubsOf) {
    if (teams.length !== 1) continue
    const [player, season] = k.split('|')
    for (const honour of wins.get(`${season}|${teams[0]}`) ?? []) out.push({ honour, season, team_id: teams[0], player_id: player })
  }
  return out.sort((a, b) => cmp(a.honour, b.honour) || cmp(a.season, b.season) || cmp(a.team_id, b.team_id) || cmp(a.player_id, b.player_id))
}

/** 대표팀 엔트리(squad:<대회>) 중 같은 시즌 그 대회 우승팀 엔트리 전원 → 선수 우승 */
export function nationalTitles(squads: readonly Honour[], winners: readonly Honour[]): Honour[] {
  const won = new Set(winners.filter((w) => w.player_id === '').map((w) => `${w.honour}|${w.season}|${w.team_id}`))
  const out: Honour[] = []
  for (const s of squads) {
    if (!s.honour.startsWith('squad:')) continue
    const comp = s.honour.slice('squad:'.length)
    if (won.has(`${comp}|${s.season}|${s.team_id}`)) out.push({ honour: comp, season: s.season, team_id: s.team_id, player_id: s.player_id })
  }
  return out
}

/**
 * 정보상자 감독 기간(연도) → 시즌 범위(§3.5). 가을–봄은 Y1~Y2−1, 한 해 달력은 Y1~Y2.
 * 가을–봄의 같은 해 시작·끝은 직전 시즌 하나(봄 대행), 한 해 달력은 그 해. 진행 중(null)은 현재 시즌까지.
 */
export function managerSeasons(from: number, to: number | null, cal: Calendar, current: number): { from_season: number; to_season: number } {
  if (to === null) return { from_season: from, to_season: Math.max(from, current) }
  if (cal === 'year') return { from_season: from, to_season: Math.max(from, to) }
  // 가을–봄 클럽의 같은 해 짧은 재임(대행)은 대개 봄이라 직전 시즌으로 본다(히딩크 첼시 2009 → 2008–09)
  if (to <= from) return { from_season: from - 1, to_season: from - 1 }
  return { from_season: from, to_season: to - 1 }
}

/**
 * 직접 고친 우승팀(manual/honour_winners.csv: honour,season,team_id,source_url)을 대회 comp의 팀 우승에 덮어쓴다.
 * 위키데이터 우승팀이 틀리거나 둘 이상이거나 빠졌을 때 쓴다(예: 유로 2004에 포르투갈·그리스가 함께 적힘).
 */
export function applyWinnerFixes(wins: readonly Honour[], fixes: readonly { honour: string; season: string; team_id: string }[], comp: string): Honour[] {
  const mine = fixes.filter((f) => f.honour === comp)
  const fixed = new Set(mine.map((f) => f.season))
  const out = [...wins.filter((w) => !(w.honour === comp && fixed.has(w.season))), ...mine.map((f) => ({ honour: comp, season: f.season, team_id: f.team_id, player_id: '' }))]
  return out.sort((a, b) => cmp(a.honour, b.honour) || cmp(a.season, b.season) || cmp(a.team_id, b.team_id))
}

/**
 * 엔트리 문서 나라 절 제목("Sweden") → 우리 대표팀 id. teams.csv 대표팀 영문 이름에서 "men's national … team"을 떼어 맞춘다.
 * ("Sweden national football team" 같은 위키백과 제목은 남녀 대표팀 동음이의 문서라 QID로 찾으면 틀린다.)
 */
export function nationalTeamFinder(teams: readonly { id: string; kind: string; name_en: string }[]): (heading: string) => string | undefined {
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const m = new Map<string, string>()
  for (const t of teams) {
    if (t.kind !== 'national') continue
    const country = t.name_en.replace(/\s+(men's\s+)?national\s+(association\s+)?(football|soccer)\s+team$/i, '')
    if (country !== t.name_en && !m.has(key(country))) m.set(key(country), t.id)
  }
  return (heading) => m.get(key(heading))
}

/** 같은 시즌 위키데이터 우승팀과 위키백과 결승 표 우승팀이 다른 시즌 (수집 출력에 알려 manual/honour_winners.csv로 고치게) */
export function winnerMismatches(wikidata: readonly Honour[], page: readonly Honour[]): { season: string; wikidata: string; page: string }[] {
  const pg = new Map(page.map((h) => [h.season, h.team_id]))
  return wikidata.filter((w) => pg.has(w.season) && pg.get(w.season) !== w.team_id).map((w) => ({ season: w.season, wikidata: w.team_id, page: pg.get(w.season)! }))
}

/**
 * 대회 시기표(competition_eras.csv)로 "그 시즌 그 대회가 1부였나". 리그 우승을 위키백과 역대 우승 표로 채울 때,
 * 2부로 내려간 시기(풋볼리그 1부 1992~2003)에 1부(PL) 우승팀이 들어가지 않게 한다.
 */
export function topTierSeason(eras: readonly { competition_id: string; from_season: string; to_season: string; tier: string }[]): (comp: string, season: number) => boolean {
  return (comp, season) => eras.some((e) => e.competition_id === comp && e.tier === '1' && Number(e.from_season) <= season && (e.to_season === '' || season <= Number(e.to_season)))
}
