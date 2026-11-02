// 축구 CSV 형식·참조 검사 (설계 2026-11-01 §9.1). 픽스처와, 있으면 data/football/ 실데이터를 같은 규칙으로 본다.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { checkDataset, FILE_NAMES, FILES, sortRows, type Dataset, type FileName } from './schema.ts'
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
    expect(check((d) => { d.files.honours[1].player_id = '' }).some((m) => /^honours:3: /.test(m))).toBe(true)
    expect(check((d) => { d.files.honours[0].honour = 'Q1' }).some((m) => /^honours:2: honour Q1/.test(m))).toBe(true)
  })

  test('legends_must_be_collected', () => {
    expect(check(() => {}, [{ player_id: 'Q439722', note: '' }])).toEqual([])
    expect(check(() => {}, [{ player_id: 'Q1487', note: '앙리' }])).toEqual([expect.stringMatching(/^legends:2: Q1487.*players\.csv에 없음/)])
  })
})

describe('real data', () => {
  const has = existsSync(join(REAL, 'players.csv'))
  test.skipIf(!has)('data_football_passes', () => {
    const legendsFile = join(REAL, 'manual', 'legends.csv')
    const legends = existsSync(legendsFile) ? parseCsv(readFileSync(legendsFile, 'utf8')) : []
    expect(checkDataset(load(REAL), legends)).toEqual([])
  })
})
