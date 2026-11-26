// 직접 입력 경력 반영 (manualSpells.ts, 설계 §5.3)
import { describe, expect, it } from 'vitest'
import { applyManualSpells } from './manualSpells.ts'
import type { Row, Spell } from './wikidata.ts'

const URL = 'https://example.com/announcement'
const base: Spell[] = [
  { player_id: 'Q1', team_id: 'Q100', start_date: '2015', end_date: '', date_precision: 'year', loan: 'false', apps: '30', goals: '5', source_ref: 'Q1-aaa' },
  { player_id: 'Q1', team_id: 'Q300', start_date: '2016', end_date: '2016', date_precision: 'year', loan: 'false', apps: '', goals: '', source_ref: 'Q1-women' },
  { player_id: 'Q2', team_id: 'Q100', start_date: '2020-07-01', end_date: '', date_precision: 'day', loan: 'false', apps: '', goals: '', source_ref: 'Q2-bbb' },
]
const row = (r: Partial<Row>): Row => ({ action: '', player_id: '', team_id: '', source_ref: '', start_date: '', end_date: '', loan: '', source_url: '', note: '', ...r })
const find = (s: Spell[], ref: string) => s.find((x) => x.source_ref === ref)

describe('직접 입력 경력', () => {
  it('fix: 채운 칸만 바꾸고, 둘 다 일 단위면 day로', () => {
    const r = applyManualSpells(base, [row({ action: 'fix', player_id: 'Q1', source_ref: 'Q1-aaa', start_date: '2015-08-01', end_date: '2017-08-03', source_url: URL })])
    expect(r.problems).toEqual([])
    expect(find(r.spells, 'Q1-aaa')).toMatchObject({ start_date: '2015-08-01', end_date: '2017-08-03', date_precision: 'day', apps: '30', loan: 'false' })
    expect(r.fixed).toBe(1)
  })

  it('fix: 한쪽만 일 단위면 연도로 맞춘다', () => {
    const r = applyManualSpells(base, [row({ action: 'fix', player_id: 'Q1', source_ref: 'Q1-aaa', end_date: '2017-08-03', source_url: URL })])
    expect(find(r.spells, 'Q1-aaa')).toMatchObject({ start_date: '2015', end_date: '2017', date_precision: 'year' })
  })

  it('add: manual: 키로 더하고, 다시 반영해도 한 줄', () => {
    const m = [row({ action: 'add', player_id: 'Q1', team_id: 'Q200', start_date: '2017-08-03', source_url: URL })]
    const once = applyManualSpells(base, m)
    const twice = applyManualSpells(once.spells, m)
    expect(once.problems).toEqual([])
    expect(find(once.spells, 'manual:Q1:Q200:2017-08-03')).toMatchObject({ team_id: 'Q200', date_precision: 'day', end_date: '', loan: 'false' })
    expect(twice.spells).toHaveLength(base.length + 1)
  })

  it('delete: 사유가 있어야 하고, 이미 없으면 문제로 치지 않는다', () => {
    const m = [row({ action: 'delete', player_id: 'Q1', source_ref: 'Q1-women', note: '여자 팀 경력' })]
    const once = applyManualSpells(base, m)
    expect(find(once.spells, 'Q1-women')).toBeUndefined()
    expect(applyManualSpells(once.spells, m).problems).toEqual([])
    expect(applyManualSpells(base, [row({ ...m[0], note: '' })]).problems).toEqual([expect.stringMatching(/^manual\/spells:2: delete에는 사유/)])
  })

  it('delete: 소문자 q로 시작하는 위키데이터 진술 ID도 그 선수의 경력으로 본다', () => {
    const low: Spell[] = [{ ...base[0], source_ref: 'q1-ccc' }]
    const r = applyManualSpells(low, [row({ action: 'delete', player_id: 'Q1', source_ref: 'q1-ccc', note: '틀린 경력' })])
    expect(r.problems).toEqual([])
    expect(r.spells).toEqual([])
    expect(applyManualSpells(low, [row({ action: 'delete', player_id: 'Q2', source_ref: 'q1-ccc', note: '틀린 경력' })]).problems).toHaveLength(1)
  })

  it('잘못된 줄은 건너뛰고 줄 번호와 함께 알린다', () => {
    const r = applyManualSpells(base, [
      row({ action: 'fix', player_id: 'Q1', source_ref: 'Q1-aaa', end_date: '2017' }),
      row({ action: 'fix', player_id: 'Q1', source_ref: 'Q2-bbb', end_date: '2021', source_url: URL }),
      row({ action: 'add', player_id: 'Q1', team_id: 'Q200', start_date: '2018', end_date: '2017', source_url: URL }),
      row({ action: 'fix', player_id: 'Q1', source_ref: 'Q1-zzz', end_date: '2017', source_url: URL }),
      row({ action: 'move', player_id: 'Q1' }),
      row({ action: 'add', player_id: 'Q9', team_id: 'Q200', start_date: '2018', source_url: URL }),
    ], { players: new Set(['Q1', 'Q2']), teams: new Set(['Q100', 'Q200', 'Q300']) })
    expect(r.problems).toEqual([
      expect.stringMatching(/^manual\/spells:2: .*source_url/),
      expect.stringMatching(/^manual\/spells:3: .*Q1의 경력이 아님/),
      expect.stringMatching(/^manual\/spells:4: .*보다 앞/),
      expect.stringMatching(/^manual\/spells:5: .*spells\.csv에 없음/),
      expect.stringMatching(/^manual\/spells:6: action move/),
      expect.stringMatching(/^manual\/spells:7: .*players\.csv에 없음/),
    ])
    expect(r.spells).toEqual(base)
  })
})
