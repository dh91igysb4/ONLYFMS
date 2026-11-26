// 티키타카토 조건별 선수 집합 (설계 2026-11-26-tiki-taka-toe-design.md §3.4·§4)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseCsv, type Row } from '../football/wikidata.ts'
import { buildConditions, clubLabel, CONTINENTS, mergeHonours, readFootballData, surname, type FootballData } from './conditions.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const REAL = join(ROOT, 'data', 'football')

const rows = (header: string, ...lines: string[]): Row[] => parseCsv([header, ...lines].join('\n'))

// 작은 인메모리 데이터: 잉글랜드(Q21)·이탈리아(Q38)·브라질(Q155)
function data(over: Partial<FootballData> = {}): FootballData {
  return {
    players: rows('id,name_ko,name_en,nation_id,popularity',
      'P1,즐라탄 이브라히모비치,Zlatan Ibrahimović,Q34,100',
      'P2,선수 둘,Player Two,Q155,50',
      'P3,선수 셋,Player Three,Q38,50',
      'P4,선수 넷,Player Four,Q21,50',
      'P5,선수 다섯,Player Five,Q21,50'),
    teams: rows('id,kind,name_ko,name_en,short_name,nation_id',
      'CA,club,아스널,Arsenal FC,Arsenal,Q21',
      'CJ,club,유벤투스,Juventus FC,Juventus,Q38',
      'CC,club,첼시,Chelsea FC,Chelsea,Q21',
      'CX,club,,Nowhere FC,,Q999',
      'NB,national,브라질 축구 국가대표팀,Brazil national football team,,Q155'),
    nations: rows('id,name_ko,name_en',
      'Q21,잉글랜드,England', 'Q38,이탈리아,Italy', 'Q155,브라질,Brazil', 'Q34,스웨덴,Sweden'),
    competitions: rows('id,name_ko,name_en,kind,nation_id,tier',
      'Q9448,프리미어리그,Premier League,league,Q21,1',
      'Q754839,풋볼리그 1부,Football League First Division,league,Q21,2',
      'Q15804,세리에 A,Serie A,league,Q38,1'),
    competition_eras: rows('competition_id,from_season,to_season,nation_id,tier',
      'Q9448,1992,,Q21,1',
      'Q754839,1888,1991,Q21,1',
      'Q754839,1992,2003,Q21,2',
      'Q15804,1987,,Q38,1'),
    team_competitions: rows('team_id,competition_id,season',
      'CA,Q9448,1995', 'CC,Q9448,1995', 'CJ,Q15804,1995', 'CA,Q754839,1990', 'CC,Q754839,1995'),
    season_memberships: rows('player_id,season,team_id,primary,days,estimated'),
    honours: rows('honour,season,team_id,player_id'),
    honour_catalog: rows('id,kind,name_en,name_ko,nation_id,source,page,from',
      'Q166177,award,Ballon d\'Or,발롱도르,,wikipedia,x,1987',
      'Q794775,award,Premier League Golden Boot,프리미어리그 득점왕,Q21,wikipedia,x,1987',
      'Q18756,continental,UEFA Champions League,UEFA 챔피언스리그,,wikidata,x,1987',
      'Q19317,international,FIFA World Cup,FIFA 월드컵,,wikipedia,x,1990',
      'Q9448,league,Premier League,프리미어리그,Q21,wikidata,x,1987',
      'Q754839,league,Football League First Division,풋볼리그 1부,Q21,wikidata,x,1987',
      'Q15804,league,Serie A,세리에 A,Q38,wikidata,x,1987',
      'Q47576,manager,Arsène Wenger,아르센 벵거,,wikipedia,x,1987',
      'Q11151,cup,FA Cup,FA컵,Q21,wikidata,x,1987'),
    manager_spells: rows('manager_id,team_id,from_season,to_season'),
    nation_continents: rows('nation_id,continent', 'Q21,europe', 'Q38,europe', 'Q155,south_america', 'Q34,europe'),
    ...over,
  }
}

const ms = (...l: string[]) => rows('player_id,season,team_id,primary,days,estimated', ...l.map((x) => `${x},true,365,true`))
const hs = (...l: string[]) => rows('honour,season,team_id,player_id', ...l)

function setOf(d: FootballData, id: string): Set<string> {
  return buildConditions(d).players.get(id) ?? new Set()
}

describe('buildConditions', () => {
  test('club_any_season', () => {
    const d = data({ season_memberships: ms('P2,1987,CA', 'P3,1986,CA', 'P3,1987,CJ') })
    const s = setOf(d, 'club:CA')
    expect(s.has('P2')).toBe(true)
    expect(s.has('P3')).toBe(false)
    const c = buildConditions(d).conditions.find((x) => x.id === 'club:CA')!
    expect(c).toMatchObject({ kind: 'club', label_ko: '아스널', ref: 'CA' })
  })

  test('league_via_team_competitions', () => {
    // CA 1995 PL 참가, 1996은 참가 기록 없음. CC는 1995 풋볼리그 1부(이 시기 2부)
    const d = data({ season_memberships: ms('P2,1995,CA', 'P3,1996,CA', 'P4,1995,CC', 'P5,1995,CJ') })
    const r = buildConditions(d)
    expect([...r.players.get('league:Q9448')!].sort()).toEqual(['P2', 'P4'])
    expect([...r.players.get('league:Q15804')!]).toEqual(['P5'])
    expect(r.conditions.find((c) => c.id === 'league:Q15804')!.label_ko).toBe('세리에 A')
  })

  test('league_eng_top_combines_eras', () => {
    const d = data({ season_memberships: ms('P2,1990,CA', 'P4,1995,CC', 'P5,1995,CJ') })
    const r = buildConditions(d)
    expect([...r.players.get('league:eng-top')!].sort()).toEqual(['P2', 'P4'])
    expect(r.conditions.find((c) => c.id === 'league:eng-top')!.label_ko).toBe('잉글랜드 1부')
  })

  test('teammate_same_season_single_club', () => {
    const d = data({
      season_memberships: ms(
        'P1,2000,CA', 'P1,2001,CJ', 'P1,2001,CC', // 2001에는 즐라탄이 두 클럽 → 그 시즌 안 셈
        'P2,2000,CA', // 같은 시즌 같은 클럽
        'P3,2000,CA', 'P3,2000,CC', // P3는 그 시즌 클럽 둘 → 제외
        'P4,2001,CJ', // 즐라탄이 클럽 둘인 시즌 → 제외
        'P5,2000,NB', 'P5,2000,CA', // 대표팀은 클럽 수에 안 셈 → 포함
      ),
    })
    const r = buildConditions(d)
    expect([...r.players.get('teammate:P1')!].sort()).toEqual(['P2', 'P5'])
    expect(r.conditions.find((c) => c.id === 'teammate:P1')!.label_ko).toBe('Ibrahimović의 동료')
    expect(r.conditions.find((c) => c.id === 'teammate:P1')!.label_en).toBe('Played with Ibrahimović')
  })

  test('teammate_label_english_surname', () => {
    const d = data({
      players: rows('id,name_ko,name_en,nation_id,popularity',
        'P1,데이비드 베컴,David Beckham,Q21,100', 'P2,네이마르,Neymar,Q155,100', 'P3,로빈 판 페르시,Robin van Persie,Q55,100', 'P4,선수 넷,Player Four,Q21,50'),
      season_memberships: ms('P1,2000,CA', 'P2,2000,CA', 'P3,2000,CA', 'P4,2000,CA'),
    })
    const label = (id: string) => buildConditions(d).conditions.find((c) => c.id === id)?.label_ko
    expect(label('teammate:P1')).toBe('Beckham의 동료') // 선수 이름은 영어
    expect(label('teammate:P2')).toBe('Neymar의 동료') // 한 단어 이름은 그대로
    expect(label('teammate:P3')).toBe('van Persie의 동료') // 감독과 같은 성 규칙
    expect(surname('마르크안드레 테어 슈테겐')).toBe('테어 슈테겐')
    expect(surname('Marc-André ter Stegen')).toBe('ter Stegen')
  })

  test('teammate_label_family_name_first_and_clash', () => {
    const d = data({
      players: rows('id,name_ko,name_en,nation_id,popularity',
        'P1,가가와 신지,Shinji Kagawa,Q17,100', 'P2,오카자키 신지,Shinji Okazaki,Q17,100',
        'P3,다비드 실바,David Silva,Q29,100', 'P5,치아구 실바,Thiago Silva,Q155,100', 'P4,선수 넷,Player Four,Q21,50'),
      season_memberships: ms('P1,2000,CA', 'P2,2000,CA', 'P3,2000,CA', 'P5,2000,CA', 'P4,2000,CA'),
    })
    const label = (id: string) => buildConditions(d).conditions.find((c) => c.id === id)?.label_ko
    expect(label('teammate:P1')).toBe('Kagawa의 동료') // 일본 이름은 영어로 이름이 앞
    expect(label('teammate:P2')).toBe('Okazaki의 동료')
    expect(label('teammate:P3')).toBe('David Silva의 동료') // 성이 겹치면 전체 이름
    expect(label('teammate:P5')).toBe('Thiago Silva의 동료')
  })

  test('teammate_anchors_popularity_then_club_seasons', () => {
    const d = data({
      players: rows('id,name_ko,name_en,nation_id,popularity',
        'P1,즐라탄 이브라히모비치,Zlatan Ibrahimović,Q34,88',
        'P2,선수 둘,Player Two,Q155,79',
        'P3,선수 셋,Player Three,Q38,88',
        'P4,선수 넷,Player Four,Q21,50'),
      season_memberships: ms('P1,2000,CA', 'P1,2001,CA', 'P2,2000,CA', 'P2,2001,CA', 'P2,2002,CA', 'P3,2000,CA', 'P3,2010,NB', 'P3,2011,NB', 'P3,2012,NB', 'P4,2000,CA'),
    })
    // 인지도 80 이상만, 같은 인지도면 클럽 시즌 수가 많은 쪽(P3의 대표팀 시즌은 안 셈)
    expect(buildConditions(d).conditions.filter((c) => c.kind === 'teammate').map((c) => c.ref).sort()).toEqual(['P1', 'P3'])
    expect(buildConditions(d, { teammateAnchors: 1 }).conditions.filter((c) => c.kind === 'teammate').map((c) => c.ref)).toEqual(['P1'])
  })

  test('short_name_override', () => {
    const d = data({
      players: rows('id,name_ko,name_en,nation_id,popularity', 'P1,라울 곤살레스,Raúl,Q29,100', 'P2,선수 둘,Player Two,Q155,50'),
      season_memberships: ms('P1,1996,CA', 'P2,1996,CA'),
      manager_spells: rows('manager_id,team_id,from_season,to_season', 'Q47576,CA,1996,1996'),
      short_names: rows('player_id,short_ko,short_en', 'P1,라울,Raúl González', 'Q47576,아르센,'),
    })
    const label = (id: string) => buildConditions(d).conditions.find((c) => c.id === id)?.label_ko
    expect(label('teammate:P1')).toBe('Raúl González의 동료') // short_en이 먼저
    expect(label('manager:Q47576')).toBe('아르센 감독')
  })

  test('manager_club_and_national', () => {
    const d = data({
      manager_spells: rows('manager_id,team_id,from_season,to_season', 'Q47576,CA,1996,1997', 'Q47576,NB,2001,2002'),
      season_memberships: ms('P2,1996,CA', 'P3,1998,CA', 'P4,1997,CA', 'P4,1997,CC'),
      honours: hs('squad:Q19317,2002,NB,P5', 'squad:Q19317,2006,NB,P1'),
    })
    const r = buildConditions(d)
    expect([...r.players.get('manager:Q47576')!].sort()).toEqual(['P2', 'P5'])
    expect(r.conditions.find((c) => c.id === 'manager:Q47576')!.label_ko).toBe('벵거 감독')
  })

  test('manager_national_excludes_tournament_before_takeover', () => {
    // 대표팀 감독 기간이 2002~2006이면 2002 대회는 부임 직전에 끝난 대회 → 빼고, 2006은 넣는다
    const d = data({
      manager_spells: rows('manager_id,team_id,from_season,to_season', 'Q47576,NB,2002,2006'),
      honours: hs('squad:Q19317,2002,NB,P2', 'squad:Q19317,2006,NB,P3', 'squad:Q19317,2010,NB,P4'),
    })
    expect([...setOf(d, 'manager:Q47576')].sort()).toEqual(['P3'])
  })

  test('title_threshold', () => {
    const d = data({
      honours: hs('Q9448,1995,CA,P2', 'Q9448,1996,CA,P2', 'Q9448,1997,CA,P2', 'Q9448,1995,CA,P3', 'Q9448,1996,CA,P3', 'Q9448,1995,CA,'),
    })
    const r = buildConditions(d)
    expect([...r.players.get('title:Q9448:3')!]).toEqual(['P2'])
    expect([...r.players.get('title:Q9448:1')!].sort()).toEqual(['P2', 'P3'])
    expect(r.conditions.find((c) => c.id === 'title:Q9448:3')!.label_ko).toBe('PL 3회 이상 우승')
  })

  test('eng_top_combines_eras', () => {
    const d = data({ honours: hs('Q754839,1990,CA,P2', 'Q9448,1995,CA,P2', 'Q9448,1996,CA,P2') })
    const r = buildConditions(d)
    expect(r.players.get('title:eng-top:3')?.has('P2')).toBe(true)
    expect(r.players.get('title:Q9448:3')?.has('P2') ?? false).toBe(false)
  })

  test('cup_titles_squads_awards_final_goal', () => {
    const d = data({
      honours: hs('Q18756,1999,CA,P2', 'Q18756,1999,CA,', 'Q19317,2002,NB,P2', 'squad:Q19317,2002,NB,P3',
        'award:Q166177,2005,,P4', 'award:Q311830,2005,,P4', 'final_goal:Q19317,2002,NB,P5'),
    })
    const r = buildConditions(d)
    const label = (id: string) => r.conditions.find((c) => c.id === id)?.label_ko
    expect([...r.players.get('title:Q18756:1')!]).toEqual(['P2'])
    expect(label('title:Q18756:1')).toBe('UCL 우승')
    expect(r.players.has('title:Q18756:3')).toBe(false)
    expect(label('title:Q19317:1')).toBe('월드컵 우승')
    expect([...r.players.get('squad:Q19317')!]).toEqual(['P3'])
    expect(label('squad:Q19317')).toBe('월드컵 출전')
    expect([...r.players.get('award:Q166177')!]).toEqual(['P4'])
    expect(label('award:Q166177')).toBe('발롱도르')
    expect(r.players.has('award:Q311830')).toBe(false) // 카탈로그 밖 상은 이름이 없어 뺀다
    expect([...r.players.get('final_goal:Q19317')!]).toEqual(['P5'])
    expect(label('final_goal:Q19317')).toBe('월드컵 결승 득점')
  })

  test('continent_from_table', () => {
    const r = buildConditions(data())
    expect(r.players.get('continent:south_america')?.has('P2')).toBe(true)
    expect(r.players.get('continent:europe')?.has('P2') ?? false).toBe(false)
    expect(r.conditions.find((c) => c.id === 'continent:south_america')!.label_ko).toBe('남미')
    expect(r.players.get('nation:Q155')?.has('P2')).toBe(true)
    expect(r.conditions.find((c) => c.id === 'nation:Q155')!.label_ko).toBe('브라질')
  })

  test('club_themes', () => {
    const d = data({
      season_memberships: ms('P2,1995,CJ', 'P3,1995,CA', 'P4,1995,CX'),
      honours: hs('award:Q794775,1995,,P3', 'award:Q166177,1995,,P3', 'Q11151,1995,CA,P3', 'Q18756,1995,CA,P3'),
    })
    const r = buildConditions(d)
    const themes = (id: string) => r.conditions.find((c) => c.id === id)?.themes
    expect(themes('club:CJ')).toEqual(['ita', 'eur'])
    expect(themes('club:CA')).toEqual(['eng', 'eur'])
    expect(themes('club:CX')).toBeUndefined() // 대상 리그 1부에 없던 클럽은 조건이 아니다
    expect(themes('league:Q15804')).toEqual(['ita', 'eur'])
    expect(themes('award:Q794775')).toEqual(['eng', 'eur'])
    expect(themes('award:Q166177')).toEqual(['eng', 'esp', 'ita', 'ger', 'eur'])
    expect(themes('title:Q11151:1')).toEqual(['eng', 'eur']) // 국내 컵은 그 나라 리그 테마 + eur
    expect(themes('title:Q18756:1')).toEqual(['eng', 'esp', 'ita', 'ger', 'eur']) // 대륙 대회는 모든 테마
    expect(themes('nation:Q155')).toEqual(['eng', 'esp', 'ita', 'ger', 'eur'])
  })

  test('club_pool_limits_themes', () => {
    // 클럽 명단(data/tiki-taka-toe/manual/clubs.csv): 명단에 있는 클럽만, eur는 eur=1인 클럽만
    const d = data({
      season_memberships: ms('P2,1995,CJ', 'P3,1995,CA', 'P4,1995,CX'),
      club_pool: [{ team_id: 'CJ', eur: '1' }, { team_id: 'CA', eur: '0' }],
    })
    const themes = (id: string) => buildConditions(d).conditions.find((c) => c.id === id)?.themes
    expect(themes('club:CJ')).toEqual(['ita', 'eur'])
    expect(themes('club:CA')).toEqual(['eng'])
    expect(themes('club:CX')).toBeUndefined()
  })
  test('club_pool_real_data', () => {
    const pool = parseCsv(readFileSync(join(import.meta.dirname, '..', '..', 'data', 'tiki-taka-toe', 'manual', 'clubs.csv'), 'utf8'))
    expect(pool.length).toBe(116)
    expect(pool.filter((r) => r.eur === '1').length).toBe(43)
    expect(pool.some((r) => r.nation_id === 'Q31')).toBe(false) // 벨기에 클럽 없음 (2026-11-26 사용자 결정)
  })
  test('belgian_league_conditions_have_no_theme', () => {
    // 벨기에 리그·리그 우승·컵·득점왕·클럽은 어느 테마에도 나오지 않는다(국적 벨기에는 그대로, 2026-11-26 사용자 결정)
    const r = buildConditions(readFootballData(REAL))
    const ids = new Set(r.conditions.map((c) => c.id))
    expect([...ids].filter((id) => /Q216022|Q736856|x-belgian-top-scorer/.test(id))).toEqual([])
    expect(ids.has('club:Q187528')).toBe(false) // 안데를레흐트
    expect(ids.has('club:Q19603')).toBe(false) // 트벤터
    expect(ids.has('nation:Q31')).toBe(true)
  })
  test('empty_sets_are_dropped_and_ids_unique', () => {
    const r = buildConditions(data())
    const ids = r.conditions.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of r.conditions) expect(r.players.get(c.id)?.size ?? 0).toBeGreaterThan(0)
    expect(r.players.has('club:CA')).toBe(false)
  })
})

describe('clubLabel', () => {
  test('약칭·창단 연도 토큰을 뗀다', () => {
    expect(clubLabel('아스널 FC')).toBe('아스널')
    expect(clubLabel('1. FC 하이덴하임 1846')).toBe('하이덴하임')
    expect(clubLabel('헤르타 BSC 베를린')).toBe('헤르타 베를린')
    expect(clubLabel('FC 샬케 04')).toBe('샬케 04')
    expect(clubLabel('하노버 96')).toBe('하노버 96')
    expect(clubLabel('Arsenal F.C.')).toBe('Arsenal')
    expect(clubLabel('SPAL')).toBe('SPAL') // 다 떼면 원래 이름
    expect(clubLabel('TSV 1860 뮌헨')).toBe('1860 뮌헨') // 가운데 연도는 이름
    expect(clubLabel('AVS Futebol SAD')).toBe('AVS Futebol SAD') // 영문은 끝의 FC류만
  })

  test('떼면 다른 클럽 이름의 앞부분이 되는 이름은 그대로', () => {
    const d = data({
      teams: rows('id,kind,name_ko,name_en,short_name,nation_id', 'CP,club,파리 FC,Paris FC,,Q142', 'CG,club,파리 생제르맹 FC,Paris Saint-Germain F.C.,,Q142'),
      competitions: rows('id,name_ko,name_en,kind,nation_id,tier', 'Q13394,리그 1,Ligue 1,league,Q142,1'),
      competition_eras: rows('competition_id,from_season,to_season,nation_id,tier', 'Q13394,1987,,Q142,1'),
      team_competitions: rows('team_id,competition_id,season', 'CP,Q13394,1990', 'CG,Q13394,1990'),
      season_memberships: ms('P2,1990,CP', 'P3,1990,CG'),
    })
    const label = (id: string) => buildConditions(d).conditions.find((c) => c.id === id)?.label_ko
    expect(label('club:CP')).toBe('파리 FC')
    expect(label('club:CG')).toBe('파리 생제르맹')
  })
})

describe('mergeHonours', () => {
  test('load.sql 규칙', () => {
    const catalog = rows('id,kind,name_en,name_ko,nation_id,source,page,from', 'Q166177,award,B,발롱도르,,w,x,1987')
    const base = hs('award:Q166177,1990,,P1', 'award:Q999,1990,,P1', 'Q9448,1995,CA,', 'Q9448,1996,CA,', 'Q9448,1995,CA,P1')
    const extra = hs('Q9448,1995,CC,', 'award:Q166177,1991,,P2', 'Q9448,1996,CA,')
    const key = (r: Row) => `${r.honour}|${r.season}|${r.team_id}|${r.player_id}`
    expect(mergeHonours(base, extra, catalog).map(key).sort()).toEqual([
      'Q9448|1995|CA|P1', 'Q9448|1995|CC|', 'Q9448|1996|CA|', 'award:Q166177|1991||P2', 'award:Q999|1990||P1',
    ])
  })
})

describe.runIf(existsSync(join(REAL, 'nations.csv')))('실데이터', () => {
  test('zlatan_is_teammate_anchor', () => {
    const r = buildConditions(readFootballData(REAL))
    expect(r.conditions.find((c) => c.id === 'teammate:Q46896')?.label_ko).toBe('Zlatan의 동료')
    expect(r.conditions.find((c) => c.id === 'teammate:Q11576')?.label_ko).toBe('Raúl의 동료')
    expect(r.conditions.find((c) => c.id === 'teammate:Q17500')?.label_ko).toBe('Xavi의 동료')
    // 짧은 이름 표의 id는 모두 팀 동료 기준 선수나 감독이고, 라벨은 겹치지 않는다
    const refs = new Set(r.conditions.filter((c) => c.kind === 'teammate' || c.kind === 'manager').map((c) => c.ref))
    const table = parseCsv(readFileSync(join(ROOT, 'data', 'tiki-taka-toe', 'manual', 'short_names.csv'), 'utf8'))
    for (const t of table) expect(refs, t.player_id).toContain(t.player_id)
    const labels = r.conditions.map((c) => c.label_ko)
    expect(new Set(labels).size).toBe(labels.length)
    expect(r.conditions.filter((c) => c.kind === 'teammate')).toHaveLength(150)
  }, 60_000)

  test('national_manager_excludes_predecessor_tournament', () => {
    const r = buildConditions(readFootballData(REAL))
    // 뢰브(2006~)는 2006 월드컵(클린스만) 엔트리 칸을 빼고, 데샹(2012~)은 유로 2012(블랑) 엔트리 나스리를 뺀다
    expect(r.players.get('manager:Q4462')?.has('Q131261')).toBe(false)
    expect(r.players.get('manager:Q508711')?.has('Q1920')).toBe(false)
    expect(r.players.get('manager:Q4462')?.size).toBeGreaterThan(0)
  }, 60_000)

  test('continent_table_complete', () => {
    const nations = parseCsv(readFileSync(join(REAL, 'nations.csv'), 'utf8'))
    const table = parseCsv(readFileSync(join(REAL, 'manual', 'nation_continents.csv'), 'utf8'))
    const m = new Map(table.map((r) => [r.nation_id, r.continent]))
    expect(m.size).toBe(table.length)
    for (const n of nations) expect(CONTINENTS, n.id).toContain(m.get(n.id))
  })
})
