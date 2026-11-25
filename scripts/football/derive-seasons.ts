// 경력(spells.csv)에서 시즌 소속(season_memberships.csv)을 계산한다. 설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §3.6.
//
//   npm run football:seasons -- [--as-of 2026-11-05] [--from 1987] [--to 2026] [--dir data/football]
//
// 수집(football:fetch)이나 openfootball 반영 뒤, 또는 manual/spells.csv를 고친 뒤에 돌린다. 네트워크를 쓰지 않는다.
// 먼저 직접 입력 경력(manual/spells.csv, 설계 §5.3)을 spells.csv에 반영해 다시 쓰고(다시 수집하지 않아도 되게), 그다음 계산한다.
// --as-of: 열린 경력을 어디까지로 볼지(기본 오늘). --from/--to: 시즌 범위(기본 HISTORY_FROM(1987) ~ 현재 시즌).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HISTORY_FROM } from './leagues.ts'
import { applyManualSpells } from './manualSpells.ts'
import { FILES, sortRows } from './schema.ts'
import { deriveMemberships, MEMBERSHIP_COLUMNS } from './seasons.ts'
import { currentSeason, parseCsv, toCsv, type Spell } from './wikidata.ts'

const a = process.argv.slice(2)
const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined }
const today = get('as-of') ?? new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`--as-of는 YYYY-MM-DD: ${today}`)
const to = Number(get('to') ?? currentSeason(new Date(`${today}T00:00:00Z`)))
const from = Number(get('from') ?? HISTORY_FROM)
const dir = get('dir') ?? 'data/football'

const read = (f: string) => parseCsv(readFileSync(join(dir, f), 'utf8'))
const teams = read('teams.csv')
const nations = new Map(teams.map((t) => [t.id, t.nation_id]))

// 1. 직접 입력 경력 반영 (여러 번 반영해도 결과가 같다)
const spellsFile = join(dir, 'spells.csv')
const before = readFileSync(spellsFile, 'utf8')
const manualFile = join(dir, 'manual', 'spells.csv')
const manual = applyManualSpells(parseCsv(before) as unknown as Spell[], existsSync(manualFile) ? parseCsv(readFileSync(manualFile, 'utf8')) : [], {
  players: new Set(read('players.csv').map((p) => p.id)),
  teams: new Set(teams.filter((t) => t.kind === 'club').map((t) => t.id)),
})
if (manual.problems.length) {
  console.error(`manual/spells.csv 오류 ${manual.problems.length}개. 고친 뒤 다시 돌린다:`)
  for (const m of manual.problems) console.error(`  ${m}`)
  process.exit(1)
}
const after = toCsv(FILES.spells.columns, sortRows('spells', manual.spells) as unknown as Record<string, unknown>[])
if (after !== before) writeFileSync(spellsFile, after)
console.error(`직접 입력 경력: 추가 ${manual.added}, 수정 ${manual.fixed}, 삭제 ${manual.deleted}${after !== before ? ' → spells.csv 갱신' : ' (spells.csv 변화 없음)'}`)

// 2. 시즌 소속
// 생일: 40세가 넘은 선수의 열린 경력을 닫는 데 쓴다(설계 2026-11-25 §3.4)
const birth = new Map(read('players.csv').filter((p) => p.birth_date).map((p) => [p.id, p.birth_date]))
// 40세가 넘었어도 현역인 선수(manual/active_players.csv: player_id,note)는 열린 경력을 닫지 않는다
const activeFile = join(dir, 'manual', 'active_players.csv')
const active = new Set(existsSync(activeFile) ? parseCsv(readFileSync(activeFile, 'utf8')).map((r) => r.player_id) : [])
const rows = deriveMemberships(manual.spells, nations, { from, to, today, birth, active })
writeFileSync(join(dir, 'season_memberships.csv'), toCsv(MEMBERSHIP_COLUMNS, rows))

const est = rows.filter((r) => r.estimated === 'true').length
console.error(`시즌 ${from}~${to}, 기준일 ${today}: ${rows.length}행 (추정 ${est}행, ${Math.round((est / rows.length) * 100)}%), 선수 ${new Set(rows.map((r) => r.player_id)).size}명`)
console.error(`→ ${join(dir, 'season_memberships.csv')}`)
