// 수집 대상 리그 (설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §3.1).
// id는 위키데이터 QID이며 football_competitions.id로 그대로 쓴다. 바꾸지 않는다(원 설계 §4.2).
//
// K리그1 Q2386334: 2026-11-02 위키데이터 질의로 확인(대한민국 리그 중 시즌 항목 P3450이 가장 많음, 37개).
// 옛 통합 항목 'K리그' Q482403(시즌 9개)은 쓰지 않는다. 최근 시즌이 그쪽에 붙어 있으면 커버리지 표에 빈칸으로 드러난다.

export type League = {
  id: string
  name_ko: string
  name_en: string
  /** 리그 소재국 QID (football_nations.id) */
  nation_id: string
  tier: number
  /** 수집할 최근 시즌 수 (현재 시즌 포함) */
  seasons: number
  /** 정규 시즌 참가팀 수. 커버리지 표에서 이보다 적은 시즌을 경고한다 */
  teams: number
}

export const LEAGUES: League[] = [
  { id: 'Q9448', name_ko: '프리미어리그', name_en: 'Premier League', nation_id: 'Q21', tier: 1, seasons: 15, teams: 20 },
  { id: 'Q19510', name_ko: 'EFL 챔피언십', name_en: 'EFL Championship', nation_id: 'Q21', tier: 2, seasons: 10, teams: 24 },
  { id: 'Q324867', name_ko: '라리가', name_en: 'LaLiga', nation_id: 'Q29', tier: 1, seasons: 10, teams: 20 },
  { id: 'Q15804', name_ko: '세리에 A', name_en: 'Serie A', nation_id: 'Q38', tier: 1, seasons: 10, teams: 20 },
  { id: 'Q82595', name_ko: '분데스리가', name_en: 'Bundesliga', nation_id: 'Q183', tier: 1, seasons: 10, teams: 18 },
  { id: 'Q13394', name_ko: '리그 1', name_en: 'Ligue 1', nation_id: 'Q142', tier: 1, seasons: 10, teams: 18 },
  { id: 'Q182994', name_ko: '프리메이라리가', name_en: 'Primeira Liga', nation_id: 'Q45', tier: 1, seasons: 10, teams: 18 },
  { id: 'Q216022', name_ko: '벨기에 프로리그', name_en: 'Belgian Pro League', nation_id: 'Q31', tier: 1, seasons: 10, teams: 16 },
  { id: 'Q167541', name_ko: '에레디비시', name_en: 'Eredivisie', nation_id: 'Q55', tier: 1, seasons: 10, teams: 18 },
  { id: 'Q485568', name_ko: '쉬페르리그', name_en: 'Süper Lig', nation_id: 'Q43', tier: 1, seasons: 10, teams: 18 },
  { id: 'Q2386334', name_ko: 'K리그1', name_en: 'K League 1', nation_id: 'Q884', tier: 1, seasons: 10, teams: 12 },
]
