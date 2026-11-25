// 수집 대상 리그 (설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §3.1).
// id는 위키데이터 QID이며 football_competitions.id로 그대로 쓴다. 바꾸지 않는다(원 설계 §4.2).
//
// K리그1 Q2386334: 2026-11-02 위키데이터 질의로 확인(대한민국 리그 중 시즌 항목 P3450이 가장 많음, 37개).
// 옛 통합 항목 'K리그' Q482403(시즌 9개)은 쓰지 않는다. 최근 시즌이 그쪽에 붙어 있으면 커버리지 표에 빈칸으로 드러난다.

/** 옛 선수·옛 시즌 참가팀 수집 시작 연도(시즌 시작 연도). 설계 2026-11-25-football-history-clubs-design.md */
export const HISTORY_FROM = 1987

/** 정규 시즌 참가팀 수. 숫자 하나, 또는 [그 시즌부터, 팀 수] 계단(오래된 순) */
export type TeamCount = number | readonly (readonly [fromSeason: number, n: number])[]

/** 리그의 전신 대회 한 시기. id는 그 시기 위키데이터 대회 QID(다른 리그의 전신과 같은 QID일 수 있다) */
export type Era = { id: string; name_ko: string; name_en: string; from: number; to: number; tier: number; teams: TeamCount }

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
  teams: TeamCount
  /** 이 QID의 첫 시즌. 그 전은 eras(전신 대회)가 맡는다. 없으면 제한 없음 */
  since?: number
  /** 전신 대회 시기, 오래된 순. 1987 이후로 since까지 빈 해 없이 이어져야 한다(leagues.test.ts) */
  eras?: readonly Era[]
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

/**
 * 단일 연도(1~12월) 시즌으로 치르는 나라 QID. 이 나라 팀의 시즌 소속은 달력 연도로 판정한다(설계 §3.6).
 * 한국·일본·미국·캐나다·중국·브라질·노르웨이·스웨덴·핀란드·아일랜드. 나머지는 가을–봄 시즌.
 */
export const CALENDAR_YEAR_NATIONS: readonly string[] = ['Q884', 'Q17', 'Q30', 'Q16', 'Q148', 'Q155', 'Q20', 'Q34', 'Q33', 'Q27']
