import { describe, expect, it } from 'vitest'
import { buildIndex, combineTeamComps, completeSeasons, matchTeam, nameKeys, parseJsonTeams, parseTxtTeams, readOverrides, seasonFolder, sourceUrls } from './openfootball.ts'

describe('openfootball 파일 위치', () => {
  it('시즌 폴더는 시작 연도-끝 두 자리', () => {
    expect(seasonFolder(2024)).toBe('2024-25')
    expect(seasonFolder(1999)).toBe('1999-00')
  })
  it('json 먼저, txt 대안이 있는 리그는 뒤에', () => {
    expect(sourceUrls('Q485568', 2023).map((s) => s.url)).toEqual([
      'https://raw.githubusercontent.com/openfootball/football.json/master/2023-24/tr.1.json',
      'https://raw.githubusercontent.com/openfootball/europe/master/turkey/2023-24_tr1.txt',
    ])
    expect(sourceUrls('Q9448', 2025).map((s) => s.kind)).toEqual(['json'])
    expect(sourceUrls('Q2386334', 2025)).toEqual([])
  })
})

describe('parseJsonTeams', () => {
  it('경기의 두 팀을 중복 없이 정렬', () => {
    const j = JSON.stringify({ name: 'x', matches: [
      { team1: 'Arsenal FC', team2: 'Fulham FC' }, { team1: 'Fulham FC', team2: 'Arsenal FC' }, { team1: { name: 'Chelsea FC' }, team2: 'Arsenal FC' },
    ] })
    expect(parseJsonTeams(j)).toEqual(['Arsenal FC', 'Chelsea FC', 'Fulham FC'])
  })
})

describe('parseTxtTeams', () => {
  it('옛 형식(홈 v 원정 점수)', () => {
    const t = `= Turkish Süper Lig 2024/25

# Teams      3

▪ Matchday 1
  Fri Aug 9 2024
    21:00  Galatasaray             v Hatayspor                2-1 (0-0)
           Fenerbahçe              v Adana Demirspor          1-0 (1-0)
`
    expect(parseTxtTeams(t)).toEqual({ teams: ['Adana Demirspor', 'Fenerbahçe', 'Galatasaray', 'Hatayspor'], declared: 3 })
  })
  it('새 형식(홈 점수 원정, 아직 안 한 경기는 v), 득점자 줄은 건너뜀', () => {
    const t = `# Teams    18
Fri Aug 14 2026
  21:30   Galatasaray  2-2 (0-0)  Çorum
                  (Victor OSIMHEN 53', 90';
                   Alexandros Kyziridis 59')
          Kasimpasa  1-1 (0-1)  Trabzonspor
  20:00   Beşiktaş   v   BB Erzurumspor
          Amed  3-2 a.e.t. (2-2)  İstanbul Başakşehir
`
    expect(parseTxtTeams(t).teams).toEqual(['Amed', 'BB Erzurumspor', 'Beşiktaş', 'Galatasaray', 'Kasimpasa', 'Trabzonspor', 'Çorum', 'İstanbul Başakşehir'])
  })
})

describe('nameKeys', () => {
  it('악센트·터키 문자·구두점을 지운다', () => {
    expect(nameKeys('Kasımpaşa SK').exact).toBe('kasimpasa sk')
    expect(nameKeys('Bor. Mönchengladbach').exact).toBe('bor monchengladbach')
    expect(nameKeys('Arsenal F.C.').exact).toBe('arsenal fc')
  })
  it('느슨한 키는 흔한 접사와 숫자를 뺀다', () => {
    expect(nameKeys('FC St. Pauli 1910').loose).toBe('st pauli')
    expect(nameKeys('1. FSV Mainz 05').loose).toBe('mainz')
    expect(nameKeys('Kasımpaşa SK').loose).toBe(nameKeys('Kasimpasa').loose)
  })
  it('접사만 있는 이름은 엄격한 키로', () => {
    expect(nameKeys('AC').loose).toBe('ac')
  })
})

describe('matchTeam', () => {
  const PL = { id: 'Q9448', nation_id: 'Q21' }
  const SA = { id: 'Q15804', nation_id: 'Q38' }
  const idx = buildIndex([
    { id: 'Q631', nation_id: 'Q38', names: ['Inter Milan', 'Inter'] },
    { id: 'Q2914786', nation_id: 'Q212', names: ['Inter'] },
    { id: 'Q9617', nation_id: 'Q145', names: ['Arsenal F.C.', 'Arsenal'] },
    { id: 'Q18656', nation_id: 'Q21', names: ['Manchester United'] },
    { id: 'Q1', nation_id: 'Q38', names: ['Twin'] },
    { id: 'Q2', nation_id: 'Q38', names: ['Twin'] },
    { id: 'Q3', nation_id: 'Q29', names: ['Only Spain'] },
  ], new Map([['Q631', 500], ['Q2914786', 3]]), [{ team_id: 'Q18656', competition_id: 'Q9448', season: '2020' }])

  it('같은 이름이 여럿이면 리그 소재국 팀', () => {
    expect(matchTeam('Inter', SA, idx, new Map())).toEqual({ status: 'ok', team_id: 'Q631', via: 'exact' })
  })
  it('잉글랜드 리그의 영국(Q145) 클럽도 받는다, 접사가 달라도 느슨하게', () => {
    expect(matchTeam('Arsenal FC', PL, idx, new Map())).toEqual({ status: 'ok', team_id: 'Q9617', via: 'exact' })
    expect(matchTeam('Manchester United FC', PL, idx, new Map())).toEqual({ status: 'ok', team_id: 'Q18656', via: 'loose' })
  })
  it('점수까지 같으면 애매', () => {
    expect(matchTeam('Twin', SA, idx, new Map())).toEqual({ status: 'ambiguous', candidates: ['Q1', 'Q2'] })
  })
  it('다른 나라 팀만 있으면 쓰지 않는다', () => {
    expect(matchTeam('Only Spain', SA, idx, new Map())).toEqual({ status: 'missing', candidates: ['Q3'] })
    expect(matchTeam('Nobody FC', SA, idx, new Map())).toEqual({ status: 'missing', candidates: [] })
  })
  it('직접 지정이 먼저, 리그를 비우면 모든 리그', () => {
    const o = readOverrides([
      { competition_id: 'Q15804', name: 'Twin', team_id: 'Q2' },
      { competition_id: '', name: 'Nobody FC', team_id: 'Q99' },
    ])
    expect(matchTeam('Twin', SA, idx, o)).toEqual({ status: 'ok', team_id: 'Q2', via: 'manual' })
    expect(matchTeam('twin', PL, idx, o).status).toBe('missing')
    expect(matchTeam('Nobody FC', PL, idx, o)).toEqual({ status: 'ok', team_id: 'Q99', via: 'manual' })
  })
})

describe('combineTeamComps', () => {
  const tc = (team_id: string, competition_id: string, season: string) => ({ team_id, competition_id, season })
  const names: Record<string, string[]> = { Q15789: ['FC Bayern Munich', 'FC Bayern München'], Q97905919: ['FC Bayern München'], Q41420: ['Borussia Dortmund'], Qx: ['Somebody'] }
  const namesOf = (id: string) => names[id] ?? []

  it('명단이 다 이어진 시즌은 openfootball 기준, 위키데이터에만 있는 같은 이름 팀은 옮긴다', () => {
    const wd = [tc('Q97905919', 'Q82595', '2022'), tc('Q41420', 'Q82595', '2022'), tc('Qx', 'Q82595', '2022')]
    const of = [tc('Q15789', 'Q82595', '2022'), tc('Q41420', 'Q82595', '2022')]
    const r = combineTeamComps(wd, of, new Set(['Q82595|2022']), namesOf)
    expect(r.rows).toEqual([tc('Q15789', 'Q82595', '2022'), tc('Q41420', 'Q82595', '2022')])
    expect(r.dropped).toEqual([tc('Q97905919', 'Q82595', '2022'), tc('Qx', 'Q82595', '2022')])
    expect([...r.remap]).toEqual([['Q97905919', 'Q15789']])
  })
  it('다 이어지지 않은 시즌은 합집합', () => {
    const r = combineTeamComps([tc('Qx', 'Q82595', '2019')], [tc('Q41420', 'Q82595', '2019')], new Set(), namesOf)
    expect(r.rows.map((t) => t.team_id)).toEqual(['Q41420', 'Qx'])
    expect(r.dropped).toEqual([])
  })
  it('completeSeasons는 팀 수와 연결 수가 같은 시즌만', () => {
    expect([...completeSeasons([
      { competition_id: 'A', season: '2020', teams: '18', matched: '18' },
      { competition_id: 'A', season: '2021', teams: '18', matched: '17' },
      { competition_id: 'A', season: '2022', teams: '0', matched: '0' },
    ])]).toEqual(['A|2020'])
  })
})

describe('combineTeamComps 이름 비교', () => {
  const tc = (team_id: string, season = '2022') => ({ team_id, competition_id: 'Q82595', season })
  const names: Record<string, string[]> = { A: ['BV Borussia 09 Dortmund'], B: ['Borussia Dortmund'], C: ['Borussia'], D: ['Borussia Mönchengladbach'] }
  const namesOf = (id: string) => names[id] ?? []
  it('단어가 포함되면 같은 팀(작은 쪽 2단어 이상)', () => {
    expect([...combineTeamComps([tc('A')], [tc('B')], new Set(['Q82595|2022']), namesOf).remap]).toEqual([['A', 'B']])
  })
  it('한 단어만 겹치면 옮기지 않는다', () => {
    expect(combineTeamComps([tc('C')], [tc('D')], new Set(['Q82595|2022']), namesOf).remap.size).toBe(0)
  })
  it('후보가 둘이면 옮기지 않는다', () => {
    const n2 = { ...names, E: ['Dortmund Borussia'] }
    expect(combineTeamComps([tc('A')], [tc('B'), tc('E')], new Set(['Q82595|2022']), (id) => n2[id as keyof typeof n2] ?? []).remap.size).toBe(0)
  })
})
