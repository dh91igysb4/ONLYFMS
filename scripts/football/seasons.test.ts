// 시즌 소속 판정 (설계 §3.6). 합성 경력으로 규칙을, 있으면 data/football/ 실데이터로 2023/24 빅6 몇 명을 본다.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveMemberships, type Membership, type SpellInput } from './seasons.ts'
import { parseCsv } from './wikidata.ts'

const TODAY = '2026-11-05'
const NATIONS = new Map([['ENG1', 'Q21'], ['ENG2', 'Q21'], ['ITA', 'Q38'], ['KOR', 'Q884'], ['KSA', 'Q851']])

function sp(team: string, start: string, end = '', loan = false): SpellInput {
  const precision = /^\d{4}$/.test(start) || /^\d{4}$/.test(end) ? 'year' : 'day'
  return { player_id: 'P', team_id: team, start_date: start, end_date: end, date_precision: precision, loan: String(loan) }
}
const derive = (spells: SpellInput[]) => deriveMemberships(spells, NATIONS, { from: 2012, to: 2026, today: TODAY })
const teamsIn = (rows: Membership[], season: number) => rows.filter((r) => r.season === String(season)).map((r) => r.team_id).sort()
const primaryIn = (rows: Membership[], season: number) => rows.find((r) => r.season === String(season) && r.primary === 'true')?.team_id

describe('시즌 소속', () => {
  it('개막 전 이적은 새 팀만 (하베르츠형)', () => {
    const r = derive([sp('ENG1', '2020', '2023'), sp('ENG2', '2023-06-28')])
    expect(teamsIn(r, 2022)).toEqual(['ENG1'])
    expect(teamsIn(r, 2023)).toEqual(['ENG2'])
  })

  it('개막 이적시장 안에서 끝난 구간은 그 시즌 소속이 아님 (마흐레즈형, 9/1 포함)', () => {
    expect(teamsIn(derive([sp('ENG1', '2018-07-10', '2023-07-28'), sp('KSA', '2023-07-28')]), 2023)).toEqual(['KSA'])
    expect(teamsIn(derive([sp('ENG1', '2018-07-10', '2023-09-01'), sp('ENG2', '2023-09-01')]), 2023)).toEqual(['ENG2'])
    expect(teamsIn(derive([sp('ENG1', '2018-07-10', '2023-09-02'), sp('ENG2', '2023-09-02')]), 2023)).toEqual(['ENG1', 'ENG2'])
  })

  it('연도 단위 종료는 여름 이적으로 본다 (케인형)', () => {
    const r = derive([sp('ENG1', '2009', '2023')])
    expect(teamsIn(r, 2022)).toEqual(['ENG1'])
    expect(teamsIn(r, 2023)).toEqual([])
    expect(r.every((m) => m.estimated === 'true')).toBe(true)
  })

  it('열린 경력은 다른 팀 완전 이적 시작일로 닫는다 (이헤아나초형)', () => {
    const r = derive([sp('ENG1', '2015'), sp('ENG2', '2017')])
    expect(teamsIn(r, 2016)).toEqual(['ENG1'])
    expect(teamsIn(r, 2017)).toEqual(['ENG2'])
    expect(teamsIn(r, 2023)).toEqual(['ENG2'])
  })

  it('다른 팀 임대는 원 소속 경력을 닫지 않고 그 기간만 뺀다', () => {
    // 개막 이적시장 안에 임대(루카쿠형): 그 시즌은 임대팀만. 임대 복귀일(6/30)의 하루는 소속으로 치지 않는다
    const r = derive([sp('ENG1', '2021-08-12'), sp('ITA', '2023-08-29', '2024-06-30', true)])
    expect(teamsIn(r, 2023)).toEqual(['ITA'])
    expect(teamsIn(r, 2024)).toEqual(['ENG1'])
  })

  it('겨울 임대는 두 팀 모두, 오래 머문 팀이 primary', () => {
    const r = derive([sp('ENG1', '2022-07-01'), sp('ENG2', '2024-01-09', '2024-06-30', true)])
    expect(teamsIn(r, 2023)).toEqual(['ENG1', 'ENG2'])
    expect(primaryIn(r, 2023)).toBe('ENG1')
  })

  it('머문 날이 같으면 늦게 온 팀이 primary', () => {
    // 2023-07-01~2023-12-31, 2023-12-31~2024-07-01: 둘 다 183일
    const r = derive([sp('ENG1', '2020-07-01', '2023-12-31'), sp('ENG2', '2023-12-31', '2024-07-01')])
    expect(r.filter((m) => m.season === '2023').map((m) => m.days)).toEqual(['183', '183'])
    expect(primaryIn(r, 2023)).toBe('ENG2')
  })

  it('가을–봄 팀의 같은 해 시작·종료는 그해 1~6월 (겨울 임대형)', () => {
    const r = derive([sp('ENG2', '2023', '2023', true)])
    expect(teamsIn(r, 2022)).toEqual(['ENG2'])
    expect(teamsIn(r, 2023)).toEqual([])
  })

  it('단일 연도 시즌 나라(K리그)는 달력 연도로', () => {
    const r = derive([sp('KOR', '2020', '2023')])
    expect(r.map((m) => m.season)).toEqual(['2020', '2021', '2022', '2023'])
  })

  it('오늘 뒤 종료일(입력 오류·계약 만료일)은 열린 경력으로', () => {
    const r = derive([sp('ENG1', '2024-07-01', '2078-06-30')])
    expect(teamsIn(r, 2026)).toEqual(['ENG1'])
    expect(r.at(-1)!.days).toBe('127')
  })
})

const REAL = join(import.meta.dirname, '..', '..', 'data', 'football')

describe('real data', () => {
  const has = existsSync(join(REAL, 'spells.csv'))
  it.skipIf(!has)('2023/24 빅6 표본', () => {
    const read = (f: string) => parseCsv(readFileSync(join(REAL, f), 'utf8'))
    const players = read('players.csv')
    const nations = new Map(read('teams.csv').map((t) => [t.id, t.nation_id]))
    const rows = deriveMemberships(read('spells.csv') as unknown as SpellInput[], nations, { from: 2023, to: 2023, today: TODAY })
    const id = (name: string) => {
      const ps = players.filter((p) => p.name_en === name)
      expect(ps, name).toHaveLength(1)
      return ps[0].id
    }
    const at = (team: string) => new Set(rows.filter((r) => r.team_id === team).map((r) => r.player_id))
    const ARSENAL = 'Q9617', SPURS = 'Q18741', CITY = 'Q50602', LIVERPOOL = 'Q1130849'
    for (const n of ['Declan Rice', 'Kai Havertz', 'Bukayo Saka']) expect(at(ARSENAL).has(id(n)), n).toBe(true)
    expect(at(ARSENAL).has(id('Granit Xhaka')), 'Xhaka').toBe(false)
    expect(at(SPURS).has(id('James Maddison')), 'Maddison').toBe(true)
    expect(at(SPURS).has(id('Harry Kane')), 'Kane').toBe(false)
    expect(at(CITY).has(id('Riyad Mahrez')), 'Mahrez').toBe(false)
    // 열린 경력(2015~)이 뒤 이적으로 닫힌 경우. 이헤아나초처럼 뒤 경력이 원본에 아예 없으면 못 닫는다(설계 §3.6 한계)
    expect(at(CITY).has(id('Patrick Roberts')), 'Patrick Roberts').toBe(false)
    expect(at(LIVERPOOL).has(id('Jordan Henderson')), 'Henderson').toBe(false)
  })
})

// 옛 선수의 열린 경력 (설계 2026-11-25 §3.4): 오늘 기준 만 40세가 넘었으면 max(시작 + 1년, 만 38세 해 6/30)에서 닫는다
describe('옛 선수의 열린 경력', () => {
  const NOW = '2026-11-25'
  const old = (spells: SpellInput[], birth?: string) =>
    deriveMemberships(spells, NATIONS, { from: 1990, to: 2026, today: NOW, birth: birth ? new Map([['P', birth]]) : undefined })

  it('은퇴 선수형: 38세 해 6/30에서 닫고 추정으로 표시', () => {
    const r = old([sp('ENG1', '1996-07-01')], '1965-03-01')
    expect(teamsIn(r, 2002)).toEqual(['ENG1'])
    expect(teamsIn(r, 2003)).toEqual([])
    expect(r.filter((m) => Number(m.season) >= 2012)).toEqual([])
    expect(r.find((m) => m.season === '2002')!.estimated).toBe('true')
  })

  it('생일 없음: 지금처럼 오늘까지 열린다', () => {
    const r = old([sp('ENG1', '1996-07-01')])
    expect(teamsIn(r, 2026)).toEqual(['ENG1'])
  })

  it('40세 이하: 그대로 열린다', () => {
    const r = old([sp('ENG1', '2024-07-01')], '1990-05-05')
    expect(teamsIn(r, 2026)).toEqual(['ENG1'])
  })

  it('호날두형: 40세가 넘었어도 최근 5년 안에 시작한 열린 경력은 그대로', () => {
    const r = old([sp('ENG1', '2023-01-01')], '1985-02-05')
    expect(teamsIn(r, 2026)).toEqual(['ENG1'])
  })

  it('노이어형: manual/active_players.csv의 현역은 닫지 않는다', () => {
    const r = deriveMemberships([sp('ENG1', '2011-07-01')], NATIONS, { from: 1990, to: 2026, today: NOW, birth: new Map([['P', '1986-03-27']]), active: new Set(['P']) })
    expect(teamsIn(r, 2026)).toEqual(['ENG1'])
  })

  it('38세 이후 시작: 시작 + 1년에서 닫는다', () => {
    const r = old([sp('ENG1', '2000-07-01')], '1960')
    expect(teamsIn(r, 2000)).toEqual(['ENG1'])
    expect(teamsIn(r, 2001)).toEqual([])
  })
})
