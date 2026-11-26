// 커리어 퀴즈 경력 줄 만들기 (careerQuiz.ts)
import { describe, expect, it } from 'vitest'
import { careerLines, clubCount, isReserveName, isYouth, lineKey, shortClubName } from './careerQuiz.ts'
import type { Row } from './wikidata.ts'

const team = (id: string, name_en: string, name_ko = ''): Row => ({ id, kind: 'club', name_en, name_ko })
const teams = new Map<string, Row>([
  ['T1', team('T1', 'FC Barcelona', 'FC 바르셀로나')],
  ['T2', team('T2', 'FC Barcelona Atlètic', 'FC 바르셀로나 아틀레틱')],
  ['T3', team('T3', 'Paris Saint-Germain F.C.', '파리 생제르맹 FC')],
  ['T4', team('T4', 'Inter Miami CF')],
  ['T5', team('T5', 'CF Andorinha', '안도리냐')],
  ['T6', team('T6', 'Willem II', '빌럼 II')],
  ['T7', { id: 'T7', kind: 'national', name_en: 'Argentina national football team', name_ko: '' }],
])
const sp = (team_id: string, start_date: string, end_date: string, r: Partial<Row> = {}): Row =>
  ({ player_id: 'Q1', team_id, start_date, end_date, loan: 'false', apps: '10', goals: '1', source_ref: `${team_id}-${start_date}`, ...r })
const none = { firstTeams: new Set<string>(), reserveTeams: new Set<string>(), hide: new Set<string>() }

describe('커리어 퀴즈 경력 줄', () => {
  it('2·3군 이름 규칙', () => {
    expect(isReserveName('Real Madrid Castilla')).toBe(true)
    expect(isReserveName('FC Barcelona Atlètic')).toBe(true)
    expect(isReserveName('FC Barcelona C')).toBe(true)
    expect(isReserveName('Borussia Dortmund II')).toBe(true)
    expect(isReserveName('Jong Ajax')).toBe(true)
    expect(isReserveName('Atletico Roma F.C.')).toBe(false)
    expect(isReserveName('Real Madrid CF')).toBe(false)
  })

  it('클럽 짧은 이름: 앞뒤 약어·연도를 떼고, 직접 지정이 먼저', () => {
    expect(shortClubName('Manchester United F.C.')).toBe('Manchester United')
    expect(shortClubName('FC Bayern Munich')).toBe('Bayern Munich')
    expect(shortClubName('AS Monaco FC')).toBe('Monaco')
    expect(shortClubName('Parma Calcio 1913')).toBe('Parma')
    expect(shortClubName('Club Atlético River Plate')).toBe('River Plate')
    expect(shortClubName('1. FC Union Berlin')).toBe('Union Berlin')
    expect(shortClubName('Swansea City A.F.C.')).toBe('Swansea City')
    expect(shortClubName('RB Leipzig')).toBe('RB Leipzig')
    expect(shortClubName('FC')).toBe('FC')
    const r = careerLines([sp('T1', '2004', '2021')], teams, 1987, { ...none, clubNames: new Map([['T1', 'Barça']]) })
    expect(r).toEqual([[2004, 2021, 'Barça', 0]])
  })

  it('유스: 경기 수가 없고 만 18세가 되는 해까지 끝난 구간', () => {
    expect(isYouth(sp('T5', '1992', '1995', { apps: '' }), 1985)).toBe(true)
    expect(isYouth(sp('T5', '2001', '2003', { apps: '' }), 1985)).toBe(true)
    expect(isYouth(sp('T5', '2001', '2004', { apps: '' }), 1985)).toBe(false)
    expect(isYouth(sp('T5', '1992', '1995'), 1985)).toBe(false)
    expect(isYouth(sp('T5', '1992', '', { apps: '' }), 1985)).toBe(false)
  })

  it('2군·유스·국가대표·숨김을 빼고 정렬한다', () => {
    const lines = careerLines([
      sp('T4', '2023-07-15', ''),
      sp('T1', '2004', '2021'),
      sp('T2', '2003', '2004'),
      sp('T5', '1995', '2000', { apps: '' }),
      sp('T3', '2021', '2023'),
      sp('T7', '2005', ''),
      sp('T6', '2000', '2001', { source_ref: 'hide-me' }),
    ], teams, 1987, { ...none, hide: new Set(['hide-me']) })
    expect(lines).toEqual([
      [2004, 2021, 'Barcelona', 0],
      [2021, 2023, 'Paris Saint-Germain', 0],
      [2023, null, 'Inter Miami', 0],
    ])
    expect(clubCount(lines)).toBe(3)
  })

  it('직접 명단: 1군으로 살리기, 2군으로 빼기', () => {
    const t = new Map(teams).set('T8', team('T8', 'Jong PSV'))
    const r = careerLines([sp('T8', '2010', '2011'), sp('T1', '2011', '2012')], t, 1990, { ...none, firstTeams: new Set(['T8']), reserveTeams: new Set(['T1']) })
    expect(r).toEqual([[2010, 2011, 'Jong PSV', 0]])
  })

  it('열린 구간: 같은 해면 닫힌 구간 먼저, 임대는 다음 구간으로 닫고, 임대 중인 소속 클럽은 열어 둔다', () => {
    const t = new Map(teams).set('A', team('A', 'A')).set('B', team('B', 'B')).set('C', team('C', 'C')).set('D', team('D', 'D'))
    const r = careerLines([
      sp('A', '2018', ''),
      sp('B', '2018', '2018'),
      sp('C', '2019', '', { loan: 'true' }),
      sp('D', '2020', '2021', { loan: 'true' }),
    ], t, 1990, none)
    expect(r).toEqual([
      [2018, 2018, 'B', 0],
      [2018, null, 'A', 0],
      [2019, 2020, 'C', 1],
      [2020, 2021, 'D', 1],
    ])
    const r2 = careerLines([sp('A', '2015', ''), sp('B', '2018', '')], t, 1990, none)
    expect(r2).toEqual([[2015, 2018, 'A', 0], [2018, null, 'B', 0]])
  })

  it('같은 클럽·같은 임대 여부의 겹치는 구간은 합치고, 떨어진 구간은 둔다', () => {
    const t = new Map(teams).set('A', team('A', 'A')).set('B', team('B', 'B'))
    const r = careerLines([
      sp('A', '2013', '2013', { loan: 'true' }),
      sp('A', '2013', '2013', { loan: 'true', source_ref: 'dup' }),
      sp('A', '2014', '2014'),
      sp('A', '2015', '2018'),
      sp('A', '2015', '2019', { source_ref: 'dup2' }),
      sp('B', '2019', ''),
      sp('A', '2021', '2022'),
    ], t, 1990, none)
    expect(r).toEqual([
      [2013, 2013, 'A', 1],
      [2014, 2014, 'A', 0],
      [2015, 2019, 'A', 0],
      [2019, 2021, 'B', 0],
      [2021, 2022, 'A', 0],
    ])
  })

  it('lineKey는 클럽과 시작 연도 순서', () => {
    expect(lineKey([[2004, 2021, 'X', 0], [2021, null, 'Y', 1]])).toBe('X@2004|Y@2021')
  })
})
