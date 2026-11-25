// 축구 CSV 형식·참조 검사 (설계 2026-11-01 §9.1). 픽스처와, 있으면 data/football/ 실데이터를 같은 규칙으로 본다.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { checkDataset, checkHistoryClubs, CORE_FILE_NAMES, FILE_NAMES, FILES, HONOUR_FILE_NAMES, sortRows, type Dataset, type FileName } from './schema.ts'
import { parseCsv, toCsv, type Row } from './wikidata.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const FIXTURES = join(ROOT, 'supabase', 'tests', 'fixtures', 'football')
const REAL = join(ROOT, 'data', 'football')

function load(dir: string): Dataset {
  const files = {} as Record<FileName, Row[]>
  const headers = {} as Record<FileName, string[]>
  for (const f of FILE_NAMES) {
    const text = readFileSync(join(dir, `${f}.csv`), 'utf8')
    files[f] = parseCsv(text)
    headers[f] = text.split(/\r?\n/, 1)[0].split(',')
  }
  return { files, headers }
}

/** 픽스처 사본을 고쳐 검사한다 */
function check(edit: (d: Dataset) => void, legends?: Row[]): string[] {
  const d = structuredClone(load(FIXTURES))
  edit(d)
  return checkDataset(d, legends)
}
const row = (d: Dataset, f: FileName, pred: (r: Row) => boolean) => {
  const r = d.files[f].find(pred)
  if (!r) throw new Error(`fixture row not found in ${f}`)
  return r
}
const son = (r: Row) => r.id === 'Q439722' || r.player_id === 'Q439722'

describe('fixtures', () => {
  test('fixtures_pass', () => {
    expect(checkDataset(load(FIXTURES))).toEqual([])
  })

  test('fixtures_cover_search_cases', () => {
    const { files } = load(FIXTURES)
    const names = files.players.map((p) => p.name_en)
    expect(names).toContain('Son Heung-min')
    expect(names).toContain('Kylian Mbappé')
    expect(names.filter((n) => n === 'Kim Min-su')).toHaveLength(2)
    expect(files.players.some((p) => p.birth_precision === 'year')).toBe(true)
    expect(files.players.some((p) => p.name_ko === '')).toBe(true)
    expect(files.aliases.some((a) => a.alias === 'Sonny')).toBe(true)
    expect(files.teams.map((t) => t.name_en)).toContain('Old FC')
  })

  test('fixtures_are_written_in_canonical_form', () => {
    for (const f of FILE_NAMES) {
      const text = readFileSync(join(FIXTURES, `${f}.csv`), 'utf8')
      expect(toCsv(FILES[f].columns, sortRows(f, parseCsv(text))), f).toBe(text)
    }
  })
})

describe('rules', () => {
  test('header_mismatch', () => {
    const e = check((d) => { d.headers.players = ['name_ko', 'id', ...FILES.players.columns.slice(2)] })
    expect(e).toEqual([expect.stringMatching(/^players: 헤더/)])
  })

  test('missing_file_header', () => {
    const e = check((d) => { d.headers.caps = [] })
    expect(e.some((m) => m.startsWith('caps: 헤더'))).toBe(true)
  })

  test('duplicate_key', () => {
    const e = check((d) => { d.files.players.splice(2, 0, { ...row(d, 'players', son) }) })
    expect(e.some((m) => /^players:\d+: 기본 키 중복 \(Q439722\)/.test(m))).toBe(true)
  })

  test('spells_key_is_source_ref', () => {
    const e = check((d) => { d.files.spells[1].source_ref = d.files.spells[0].source_ref })
    expect(e.some((m) => /^spells:\d+: 기본 키 중복/.test(m))).toBe(true)
  })

  test('sort_order', () => {
    const e = check((d) => { d.files.nations.reverse() })
    expect(e.some((m) => /^nations:\d+: 정렬 순서/.test(m))).toBe(true)
  })

  test('unknown_player_reference', () => {
    const e = check((d) => { d.files.spells[0].player_id = 'Q1' })
    expect(e.some((m) => /^spells:2: player_id Q1 없음/.test(m))).toBe(true)
  })

  test('unknown_alias_entity', () => {
    const e = check((d) => { d.files.aliases.push({ entity_id: 'x-zzz', alias: 'Zzz', lang: 'en' }) })
    expect(e.some((m) => /^aliases:\d+: entity_id x-zzz 없음/.test(m))).toBe(true)
  })

  test('caps_team_must_be_national', () => {
    const e = check((d) => { row(d, 'caps', son).team_id = 'Q18741' })
    expect(e.some((m) => /^caps:2: team_id Q18741.*national/.test(m))).toBe(true)
  })

  test('spells_team_must_be_club', () => {
    const e = check((d) => { d.files.spells[0].team_id = 'x-kor-nt' })
    expect(e.some((m) => /^spells:2: team_id x-kor-nt.*club/.test(m))).toBe(true)
  })

  test('invalid_date', () => {
    const e = check((d) => { row(d, 'players', son).birth_date = '2020-13-01' })
    expect(e.some((m) => /^players:\d+: birth_date/.test(m))).toBe(true)
  })

  test('precision_mismatch', () => {
    const e = check((d) => { row(d, 'players', son).birth_precision = 'year' })
    expect(e.some((m) => /^players:\d+: birth_date 1992-07-08.*year/.test(m))).toBe(true)
    const e2 = check((d) => { d.files.spells[0].date_precision = 'year' })
    expect(e2.some((m) => /^spells:2: start_date/.test(m))).toBe(true)
  })

  test('spell_end_before_start', () => {
    const e = check((d) => { d.files.spells[1].end_date = '2009-01-01' })
    expect(e.some((m) => /^spells:3: end_date.*start_date .*보다 앞/.test(m))).toBe(true)
  })

  test('enum_values', () => {
    expect(check((d) => { row(d, 'players', son).position = 'ST' }).some((m) => /position ST/.test(m))).toBe(true)
    expect(check((d) => { d.files.teams[0].kind = 'other' }).some((m) => /^teams:2: kind other/.test(m))).toBe(true)
    expect(check((d) => { d.files.spells[0].loan = 'yes' }).some((m) => /^spells:2: loan yes/.test(m))).toBe(true)
  })

  test('popularity_range', () => {
    expect(check((d) => { row(d, 'players', son).popularity = '101' }).some((m) => /popularity 101/.test(m))).toBe(true)
    expect(check((d) => { row(d, 'players', son).popularity = '' }).some((m) => /popularity/.test(m))).toBe(true)
  })

  test('integer_columns', () => {
    expect(check((d) => { row(d, 'players', son).height_cm = '1.84' }).some((m) => /height_cm 1\.84/.test(m))).toBe(true)
  })

  test('colors_json_array', () => {
    expect(check((d) => { d.files.teams[0].colors = 'red' }).some((m) => /^teams:2: colors/.test(m))).toBe(true)
    expect(check((d) => { d.files.teams[0].colors = '[{"hex":"red","share":1}]' }).some((m) => /^teams:2: colors/.test(m))).toBe(true)
  })

  test('required_names_and_ids', () => {
    expect(check((d) => { row(d, 'players', son).name_en = '' }).some((m) => /name_en 비어/.test(m))).toBe(true)
    expect(check((d) => { d.files.nations[0].id = 'france' }).some((m) => /^nations:2: id france/.test(m))).toBe(true)
  })

  test('honour_shape', () => {
    expect(check((d) => { d.files.honours[0].team_id = '' }).some((m) => /^honours:2: /.test(m))).toBe(true)
    expect(check((d) => { d.files.honours[2].player_id = '' }).some((m) => /^honours:4: /.test(m))).toBe(true) // 개인상 행(픽스처 3번째)
    expect(check((d) => { d.files.honours[0].honour = 'Q1' }).some((m) => /^honours:2: honour Q1/.test(m))).toBe(true)
  })

  test('legends_must_be_collected', () => {
    expect(check(() => {}, [{ player_id: 'Q439722', note: '' }])).toEqual([])
    expect(check(() => {}, [{ player_id: 'Q1487', note: '앙리' }])).toEqual([expect.stringMatching(/^legends:2: Q1487.*players\.csv에 없음/)])
  })
})

describe('competition_eras and manual files (설계 2026-11-25)', () => {
  test('competition_eras_refs', () => {
    const e = check((d) => { d.files.competition_eras[0].competition_id = 'Q1'; d.files.competition_eras[1].nation_id = 'Q2' })
    expect(e.some((m) => /^competition_eras:2: competition_id Q1 없음/.test(m))).toBe(true)
    expect(e.some((m) => /^competition_eras:3: nation_id Q2 없음/.test(m))).toBe(true)
  })

  test('competition_eras_to_before_from', () => {
    const e = check((d) => { d.files.competition_eras[0].to_season = '1980' })
    expect(e.some((m) => /^competition_eras:2: to_season 1980.*from_season/.test(m))).toBe(true)
  })

  test('competition_eras_overlap_in_same_competition', () => {
    const e = check((d) => {
      const first = d.files.competition_eras[0]
      first.to_season = '2000'
      d.files.competition_eras.splice(1, 0, { ...first, from_season: '1995', to_season: '' })
    })
    expect(e.some((m) => /^competition_eras:3: .*겹침/.test(m))).toBe(true)
  })

  test('team_competitions_unknown_team_points_to_history_clubs', () => {
    const e = check((d) => { d.files.team_competitions[0].team_id = 'Q999999' })
    expect(e.some((m) => /^team_competitions:2: team_id Q999999 없음.*manual\/history_clubs\.csv/.test(m))).toBe(true)
  })

  test('history_clubs_rows', () => {
    expect(checkHistoryClubs([{ team_id: 'Q1', from: '', note: '' }, { team_id: 'Q2', from: '1990', note: '' }], 2026)).toEqual([])
    const e = checkHistoryClubs([{ team_id: 'x', from: '', note: '' }, { team_id: 'Q2', from: '1900', note: '' }, { team_id: 'Q2', from: '', note: '' }], 2026)
    expect(e).toEqual([
      expect.stringMatching(/^history_clubs:2: team_id x/),
      expect.stringMatching(/^history_clubs:3: from 1900/),
      expect.stringMatching(/^history_clubs:4: team_id Q2 중복/),
    ])
  })
})

describe('real data', () => {
  const has = existsSync(join(REAL, 'players.csv'))
  test.skipIf(!has)('data_football_passes', () => {
    const legendsFile = join(REAL, 'manual', 'legends.csv')
    const legends = existsSync(legendsFile) ? parseCsv(readFileSync(legendsFile, 'utf8')) : []
    expect(checkDataset(load(REAL), legends)).toEqual([])
    const hcFile = join(REAL, 'manual', 'history_clubs.csv')
    if (existsSync(hcFile)) expect(checkHistoryClubs(parseCsv(readFileSync(hcFile, 'utf8')), new Date().getFullYear())).toEqual([])
  })
})

describe('honours_extra (설계 2026-11-25-football-honours-design.md §3.4)', () => {
  test('extra_honour_unknown_catalog', () => {
    expect(check((d) => { d.files.honours_extra[0].honour = 'award:Q999999' })).toContainEqual(expect.stringMatching(/^honours_extra:2: honour award:Q999999 카탈로그에 없음/))
  })
  test('extra_award_needs_player', () => {
    expect(check((d) => { const r = d.files.honours_extra.find((x) => x.honour.startsWith('award:'))!; r.player_id = '' })).toContainEqual(expect.stringMatching(/^honours_extra:\d+: .*player_id 없음/))
  })
  test('manager_spell_order', () => {
    expect(check((d) => { const r = d.files.manager_spells[0]; r.from_season = '2010'; r.to_season = '2009' })).toContainEqual(expect.stringMatching(/^manager_spells:2: /))
  })
  test('manager_must_be_in_catalog', () => {
    expect(check((d) => { d.files.managers[0].id = 'x-nobody' })).toContainEqual(expect.stringMatching(/^managers:2: id x-nobody 카탈로그 감독이 아님/))
  })
  test('catalog_kind', () => {
    expect(check((d) => { d.files.honour_catalog[0].kind = 'trophy' })).toContainEqual(expect.stringMatching(/^honour_catalog:2: kind trophy 허용 안 됨/))
  })
})

test('wikidata_collector_does_not_write_honour_files', () => {
  // football:fetch가 honours 수집기 출력(honours_extra 등)을 빈 파일로 덮어쓰지 않게, 위키데이터 수집기 파일 목록에서 뺀다
  expect(CORE_FILE_NAMES).not.toContain('honours_extra')
  expect(CORE_FILE_NAMES).not.toContain('honour_catalog')
  expect([...CORE_FILE_NAMES, ...HONOUR_FILE_NAMES].sort()).toEqual([...FILE_NAMES].sort())
})
