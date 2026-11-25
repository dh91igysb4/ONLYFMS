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

// 전신 대회: npm run football:eras 결과(2026-11-25). 잉글랜드만 1992년에 대회 QID가 바뀌었다.
// 풋볼리그 1부(Q754839)는 1991년까지 1부, 1992~2003년 2부라 프리미어리그·챔피언십 양쪽의 전신이다.
// 챔피언십의 1987~1991 전신은 풋볼리그 2부(Q769744, football:eras --find로 확인 2026-11-25). 나머지 리그는 QID 하나로 1987년 전부터 이어진다.
const FL_FIRST = { id: 'Q754839', name_ko: '풋볼리그 1부', name_en: 'Football League First Division' } as const

// 정원(teams)은 커버리지 표의 "정원 미만 !" 경고용이다. 영어 위키백과 리그 문서 기준 근사값이라, 틀리면 경고만 달라진다.
export const LEAGUES: League[] = [
  { id: 'Q9448', name_ko: '프리미어리그', name_en: 'Premier League', nation_id: 'Q21', tier: 1, seasons: 15, teams: [[1992, 22], [1995, 20]], since: 1992,
    eras: [{ ...FL_FIRST, from: 1888, to: 1991, tier: 1, teams: [[1987, 21], [1988, 20], [1991, 22]] }] },
  { id: 'Q19510', name_ko: 'EFL 챔피언십', name_en: 'EFL Championship', nation_id: 'Q21', tier: 2, seasons: 10, teams: 24, since: 2004,
    eras: [
      { id: 'Q769744', name_ko: '풋볼리그 2부', name_en: 'Football League Second Division', from: 1892, to: 1991, tier: 2, teams: [[1987, 23], [1988, 24]] },
      { ...FL_FIRST, from: 1992, to: 2003, tier: 2, teams: 24 },
    ] },
  { id: 'Q324867', name_ko: '라리가', name_en: 'LaLiga', nation_id: 'Q29', tier: 1, seasons: 10, teams: [[1987, 20], [1995, 22], [1997, 20]] },
  { id: 'Q15804', name_ko: '세리에 A', name_en: 'Serie A', nation_id: 'Q38', tier: 1, seasons: 10, teams: [[1987, 16], [1988, 18], [2004, 20]] },
  { id: 'Q82595', name_ko: '분데스리가', name_en: 'Bundesliga', nation_id: 'Q183', tier: 1, seasons: 10, teams: [[1987, 18], [1991, 20], [1992, 18]] },
  { id: 'Q13394', name_ko: '리그 1', name_en: 'Ligue 1', nation_id: 'Q142', tier: 1, seasons: 10, teams: [[1987, 20], [1997, 18], [2002, 20], [2023, 18]] },
  { id: 'Q182994', name_ko: '프리메이라리가', name_en: 'Primeira Liga', nation_id: 'Q45', tier: 1, seasons: 10, teams: [[1987, 20], [1989, 18], [2006, 16], [2014, 18]] },
  { id: 'Q216022', name_ko: '벨기에 프로리그', name_en: 'Belgian Pro League', nation_id: 'Q31', tier: 1, seasons: 10, teams: [[1987, 18], [2009, 16], [2020, 18], [2023, 16]] },
  { id: 'Q167541', name_ko: '에레디비시', name_en: 'Eredivisie', nation_id: 'Q55', tier: 1, seasons: 10, teams: 18 },
  { id: 'Q485568', name_ko: '쉬페르리그', name_en: 'Süper Lig', nation_id: 'Q43', tier: 1, seasons: 10, teams: [[1987, 18], [2020, 21], [2021, 20], [2022, 19], [2023, 20], [2024, 19], [2025, 18]] },
  { id: 'Q2386334', name_ko: 'K리그1', name_en: 'K League 1', nation_id: 'Q884', tier: 1, seasons: 10,
    teams: [[1987, 5], [1989, 6], [1994, 7], [1995, 8], [1996, 9], [1997, 10], [2003, 12], [2004, 13], [2006, 14], [2010, 15], [2012, 16], [2013, 14], [2014, 12]] },
]

/**
 * 단일 연도(1~12월) 시즌으로 치르는 나라 QID. 이 나라 팀의 시즌 소속은 달력 연도로 판정한다(설계 §3.6).
 * 한국·일본·미국·캐나다·중국·브라질·노르웨이·스웨덴·핀란드·아일랜드. 나머지는 가을–봄 시즌.
 */
export const CALENDAR_YEAR_NATIONS: readonly string[] = ['Q884', 'Q17', 'Q30', 'Q16', 'Q148', 'Q155', 'Q20', 'Q34', 'Q33', 'Q27']
