// 축구 CSV의 파일별 열·기본 키·정렬 순서와 검사 규칙 (설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §5.2·§9.1).
// 순수 함수만. 수집기(fetch-wikidata.ts)는 열과 정렬을 여기서 가져다 쓰고, data.test.ts가 같은 규칙으로 검사한다.
import { cmp, type Row } from './wikidata.ts'

export const FILE_NAMES = [
  'nations', 'competitions', 'teams', 'team_competitions', 'players', 'aliases', 'external_ids', 'spells', 'caps', 'honours',
] as const
export type FileName = typeof FILE_NAMES[number]

/**
 * columns: CSV 헤더(순서까지 고정). key: 기본 키(중복 금지, DB 기본 키와 같음).
 * order: 파일 안 행 순서. 리뷰하기 쉬운 순서라 key와 다를 수 있다(예: 경력은 선수·시작일 순).
 */
export const FILES: Record<FileName, { columns: string[]; key: string[]; order: string[] }> = {
  nations: { columns: ['id', 'name_ko', 'name_en', 'iso2', 'confederation'], key: ['id'], order: ['id'] },
  competitions: { columns: ['id', 'name_ko', 'name_en', 'kind', 'nation_id', 'tier'], key: ['id'], order: ['id'] },
  teams: { columns: ['id', 'kind', 'name_ko', 'name_en', 'short_name', 'nation_id', 'colors', 'founded', 'retired'], key: ['id'], order: ['id'] },
  team_competitions: { columns: ['team_id', 'competition_id', 'season'], key: ['team_id', 'competition_id', 'season'], order: ['competition_id', 'season', 'team_id'] },
  players: {
    columns: ['id', 'name_ko', 'name_en', 'birth_date', 'birth_precision', 'nation_id', 'position', 'position_detail', 'foot', 'height_cm', 'shirt_number', 'popularity', 'retired'],
    key: ['id'], order: ['id'],
  },
  aliases: { columns: ['entity_id', 'alias', 'lang'], key: ['entity_id', 'alias'], order: ['entity_id', 'alias'] },
  external_ids: { columns: ['entity_id', 'source', 'external_id'], key: ['source', 'external_id'], order: ['entity_id', 'source', 'external_id'] },
  spells: {
    columns: ['player_id', 'team_id', 'start_date', 'end_date', 'date_precision', 'loan', 'apps', 'goals', 'source_ref'],
    key: ['source_ref'], order: ['player_id', 'start_date', 'source_ref'],
  },
  caps: { columns: ['player_id', 'team_id', 'caps', 'goals', 'first_year', 'last_year'], key: ['player_id', 'team_id'], order: ['player_id', 'team_id'] },
  honours: { columns: ['honour', 'season', 'team_id', 'player_id'], key: ['honour', 'season', 'team_id', 'player_id'], order: ['honour', 'season', 'team_id', 'player_id'] },
}

const get = (r: object, c: string) => String((r as Record<string, unknown>)[c] ?? '')

function compareBy(cols: readonly string[]) {
  return (a: object, b: object) => {
    for (const c of cols) { const d = cmp(get(a, c), get(b, c)); if (d) return d }
    return 0
  }
}

/** 파일의 정렬 순서로 정렬한 사본 */
export function sortRows<T extends object>(file: FileName, rows: readonly T[]): T[] {
  return [...rows].sort(compareBy(FILES[file].order))
}

// ---------------------------------------------------------------- 검사

export type Dataset = { files: Record<FileName, Row[]>; headers: Record<FileName, string[]> }

const ENTITY_ID = /^(Q\d+|x-[a-z0-9]+(-[a-z0-9]+)*)$/
const INT = /^\d+$/
const YEAR = /^\d{4}$/
const ENUMS = {
  competitionKind: ['league', 'cup', 'continental', 'international'],
  teamKind: ['club', 'national'],
  position: ['GK', 'DF', 'MF', 'FW'],
  foot: ['left', 'right', 'both'],
  precision: ['day', 'year'],
  bool: ['true', 'false'],
}

function validDay(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/** 정밀도에 맞는 날짜인지: day = 실제 있는 YYYY-MM-DD, year = YYYY */
function dateFits(s: string, precision: string): boolean {
  return precision === 'day' ? validDay(s) : precision === 'year' ? YEAR.test(s) : false
}

function validColors(s: string): boolean {
  try {
    const v: unknown = JSON.parse(s)
    return Array.isArray(v) && v.length > 0 && v.every((c) =>
      typeof c === 'object' && c !== null && /^#[0-9A-Fa-f]{6}$/.test(String((c as { hex?: unknown }).hex)) &&
      typeof (c as { share?: unknown }).share === 'number')
  } catch { return false }
}

/**
 * 데이터 한 벌을 검사해 오류 메시지 목록을 돌려준다(빈 배열이면 통과).
 * 메시지는 `파일:줄: 내용`(줄은 헤더를 1로 센 CSV 줄 번호) 또는 `파일: 내용`.
 * legends(manual/legends.csv)를 주면 그 QID가 모두 players.csv에 있는지도 본다.
 */
export function checkDataset({ files, headers }: Dataset, legends: readonly Row[] = []): string[] {
  const errors: string[] = []

  // 헤더, 기본 키 중복, 정렬 순서
  for (const f of FILE_NAMES) {
    const spec = FILES[f]
    const h = headers[f] ?? []
    if (h.join(',') !== spec.columns.join(',')) errors.push(`${f}: 헤더가 다름 (기대 ${spec.columns.join(',')} / 실제 ${h.join(',')})`)
    const seen = new Set<string>()
    const byOrder = compareBy(spec.order)
    files[f].forEach((r, i) => {
      const k = spec.key.map((c) => get(r, c)).join('|')
      if (seen.has(k)) errors.push(`${f}:${i + 2}: 기본 키 중복 (${k})`)
      seen.add(k)
      if (i > 0 && byOrder(files[f][i - 1], r) > 0) errors.push(`${f}:${i + 2}: 정렬 순서가 틀림 (${spec.order.join(', ')} 순이어야 함)`)
    })
  }

  // 행 단위 규칙
  const ids = (f: FileName) => new Set(files[f].map((r) => r.id))
  const nations = ids('nations'), competitions = ids('competitions'), players = ids('players')
  const teamKind = new Map(files.teams.map((t) => [t.id, t.kind]))

  for (const f of FILE_NAMES) {
    files[f].forEach((r, i) => {
      const at = `${f}:${i + 2}: `
      const err = (m: string) => errors.push(at + m)
      const oneOf = (c: string, allowed: readonly string[], optional = false) => {
        const v = get(r, c)
        if (!(optional && v === '') && !allowed.includes(v)) err(`${c} ${v || '(빈 값)'} 허용 안 됨 (${allowed.join('|')})`)
      }
      const int = (c: string) => { const v = get(r, c); if (v !== '' && !INT.test(v)) err(`${c} ${v} 정수가 아님`) }
      const year = (c: string, optional = true) => { const v = get(r, c); if ((v !== '' || !optional) && !YEAR.test(v)) err(`${c} ${v || '(빈 값)'} 연도(YYYY)가 아님`) }
      const required = (c: string) => { if (get(r, c).trim() === '') err(`${c} 비어 있음`) }
      const entityId = (c: string) => { const v = get(r, c); if (!ENTITY_ID.test(v)) err(`${c} ${v || '(빈 값)'} 형식이 틀림 (Q숫자 또는 x-소문자)`) }
      const ref = (c: string, set: ReadonlySet<string>, optional = true) => {
        const v = get(r, c)
        if (v === '' && optional) return
        if (!set.has(v)) err(`${c} ${v || '(빈 값)'} 없음`)
      }
      const team = (c: string, kind: 'club' | 'national') => {
        const v = get(r, c), k = teamKind.get(v)
        if (k === undefined) err(`${c} ${v || '(빈 값)'} 없음`)
        else if (k !== kind) err(`${c} ${v}는 ${kind} 팀이어야 함 (${k})`)
      }

      switch (f) {
        case 'nations':
          entityId('id'); required('name_en')
          if (r.iso2 !== '' && !/^[a-z]{2}(-[a-z0-9]{1,3})?$/.test(r.iso2)) err(`iso2 ${r.iso2} 형식이 틀림 (소문자 ISO 3166)`)
          break
        case 'competitions':
          entityId('id'); required('name_ko'); required('name_en'); oneOf('kind', ENUMS.competitionKind); ref('nation_id', nations); int('tier')
          break
        case 'teams':
          entityId('id'); oneOf('kind', ENUMS.teamKind); required('name_en'); ref('nation_id', nations); year('founded'); oneOf('retired', ENUMS.bool)
          if (r.colors !== '' && !validColors(r.colors)) err(`colors 형식이 틀림 (JSON 배열 [{"hex":"#RRGGBB","share":숫자}])`)
          break
        case 'team_competitions':
          if (!teamKind.has(r.team_id)) err(`team_id ${r.team_id || '(빈 값)'} 없음`)
          ref('competition_id', competitions, false); year('season', false)
          break
        case 'players':
          entityId('id'); required('name_en'); ref('nation_id', nations)
          oneOf('birth_precision', ENUMS.precision, true)
          if ((r.birth_date === '') !== (r.birth_precision === '')) err(`birth_date와 birth_precision은 함께 있거나 함께 비어야 함`)
          else if (r.birth_date !== '' && !dateFits(r.birth_date, r.birth_precision)) err(`birth_date ${r.birth_date}이(가) 형식이 틀리거나 정밀도 ${r.birth_precision}와 맞지 않음`)
          oneOf('position', ENUMS.position, true); oneOf('foot', ENUMS.foot, true); int('height_cm'); int('shirt_number'); oneOf('retired', ENUMS.bool)
          if (!INT.test(r.popularity) || Number(r.popularity) > 100) err(`popularity ${r.popularity || '(빈 값)'} 범위 밖 (0~100 정수)`)
          break
        case 'aliases':
          if (!players.has(r.entity_id) && !teamKind.has(r.entity_id)) err(`entity_id ${r.entity_id || '(빈 값)'} 없음 (선수·팀)`)
          required('alias')
          if (r.lang !== '' && !/^[a-z]{2,3}$/.test(r.lang)) err(`lang ${r.lang} 형식이 틀림`)
          break
        case 'external_ids':
          if (!players.has(r.entity_id) && !teamKind.has(r.entity_id)) err(`entity_id ${r.entity_id || '(빈 값)'} 없음 (선수·팀)`)
          if (!/^[a-z][a-z-]*$/.test(r.source)) err(`source ${r.source || '(빈 값)'} 형식이 틀림`)
          required('external_id')
          break
        case 'spells': {
          required('source_ref'); ref('player_id', players, false); team('team_id', 'club')
          oneOf('date_precision', ENUMS.precision); oneOf('loan', ENUMS.bool); int('apps'); int('goals')
          const p = r.date_precision
          if (!dateFits(r.start_date, p)) err(`start_date ${r.start_date || '(빈 값)'}이(가) 형식이 틀리거나 정밀도 ${p}와 맞지 않음`)
          if (r.end_date !== '' && !dateFits(r.end_date, p)) err(`end_date ${r.end_date}이(가) 형식이 틀리거나 정밀도 ${p}와 맞지 않음`)
          else if (r.end_date !== '' && cmp(r.end_date, r.start_date) < 0) err(`end_date ${r.end_date}가 start_date ${r.start_date}보다 앞`)
          break
        }
        case 'caps':
          ref('player_id', players, false); team('team_id', 'national'); int('caps'); int('goals'); year('first_year'); year('last_year')
          break
        case 'honours': {
          year('season', false); ref('team_id', new Set(teamKind.keys())); ref('player_id', players)
          if (r.honour.startsWith('award:')) {
            if (!ENTITY_ID.test(r.honour.slice(6))) err(`honour ${r.honour} 형식이 틀림 (award:<QID>)`)
            if (r.player_id === '') err(`개인상(${r.honour})에 player_id 없음`)
          } else {
            if (!competitions.has(r.honour)) err(`honour ${r.honour || '(빈 값)'} 없음 (대회 id 또는 award:<id>)`)
            if (r.team_id === '') err(`대회 우승(${r.honour})에 team_id 없음`)
          }
          break
        }
      }
    })
  }

  // 레전드 명단이 수집에 반영됐는지
  legends.forEach((r, i) => {
    const id = (r.player_id ?? '').trim()
    if (/^Q\d+$/.test(id) && !players.has(id)) errors.push(`legends:${i + 2}: ${id}이(가) players.csv에 없음 (다시 수집하거나 명단 확인)`)
  })

  return errors
}
