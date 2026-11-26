// 커리어 퀴즈 문제 데이터를 만든다. 설계 docs/superpowers/specs/2026-11-25-career-quiz-design.md §6.
//
//   npm run football:career-quiz -- [--dir data/football] [--out src/games/career-quiz/data.ts]
//
// 읽는 파일(data/football/):
//   players.csv · spells.csv · teams.csv
//   manual/career_quiz.csv                 문제 명단 (player_id,tier,name)
//   manual/names_ko.csv                    한글 이름 고침 (entity_id,name_ko)
//   manual/career_quiz_first_teams.csv     이름 규칙에 걸려도 1군인 팀 (team_id,note)
//   manual/career_quiz_reserve_teams.csv   이름 규칙에 안 걸려도 2군인 팀 (team_id,note)
//   manual/career_quiz_hide.csv            뺄 경력 (source_ref,note)
//   manual/career_quiz_player_names.csv    선수 영문 표시 이름 직접 지정 (player_id,name)
//   manual/career_quiz_club_names.csv      클럽 표시 이름 직접 지정 (team_id,name). 없으면 영문 이름에서 FC 등을 뗀 짧은 이름
// 문제마다 1군 경력이 있고, 같은 경력(클럽·시작 연도 순서)의 다른 선수(인지도 50 이상)가 없어야 한다. 아니면 실패한다.
// 결과 data.ts는 직접 고치지 않는다. 바뀌면 career-quiz logic.version을 올리고 play 함수를 다시 배포한다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { careerLines, clubCount, lineKey, MIN_CLUBS, TIERS, type Filters, type Line, type Tier } from './careerQuiz.ts'
import { parseCsv, type Row } from './wikidata.ts'

const a = process.argv.slice(2)
const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined }
const dir = get('dir') ?? 'data/football'
const out = get('out') ?? 'src/games/career-quiz/data.ts'
/** 경력이 같은 다른 선수를 셀 때 보는 인지도 하한 (0~100 백분위) */
const TWIN_MIN_POPULARITY = 50

const read = (f: string) => parseCsv(readFileSync(join(dir, f), 'utf8'))
const readOpt = (f: string) => (existsSync(join(dir, f)) ? read(f) : [])

const players = new Map(read('players.csv').map((p) => [p.id, p]))
const teams = new Map(read('teams.csv').map((t) => [t.id, t]))
const spells = new Map<string, Row[]>()
for (const s of read('spells.csv')) {
  const list = spells.get(s.player_id)
  if (list) list.push(s)
  else spells.set(s.player_id, [s])
}
// 선수 영문 표시 이름 직접 지정 (player_id,name): 위키데이터 영문 라벨이 어색할 때
const playerNames = new Map(readOpt('manual/career_quiz_player_names.csv').map((r) => [r.player_id, r.name]))
const namesKo = new Map(readOpt('manual/names_ko.csv').map((r) => [r.entity_id, r.name_ko]))
const filters: Filters = {
  firstTeams: new Set(readOpt('manual/career_quiz_first_teams.csv').map((r) => r.team_id)),
  reserveTeams: new Set(readOpt('manual/career_quiz_reserve_teams.csv').map((r) => r.team_id)),
  hide: new Set(readOpt('manual/career_quiz_hide.csv').map((r) => r.source_ref)),
  clubNames: new Map(readOpt('manual/career_quiz_club_names.csv').map((r) => [r.team_id, r.name])),
}
for (const [k, v] of namesKo) {
  const t = teams.get(k)
  if (t) teams.set(k, { ...t, name_ko: v })
}

const birthYear = (id: string) => {
  const b = players.get(id)?.birth_date
  return b ? Number(b.slice(0, 4)) : null
}
const linesOf = (id: string) => careerLines(spells.get(id) ?? [], teams, birthYear(id), filters)

// 같은 경력의 다른 선수 찾기: 인지도 TWIN_MIN_POPULARITY 이상 선수의 경력 키.
// 그보다 낮은 선수는 답할 사람이 거의 없고, 데이터 오류(남자 클럽에 붙은 여자 선수 경력 등)가 많다.
const byKey = new Map<string, string[]>()
for (const id of spells.keys()) {
  if (Number(players.get(id)?.popularity ?? 0) < TWIN_MIN_POPULARITY) continue
  const lines = linesOf(id)
  if (lines.length === 0) continue
  const k = lineKey(lines)
  const list = byKey.get(k)
  if (list) list.push(id)
  else byKey.set(k, [id])
}

const problems: string[] = []
const rows: [string, string, string, Tier, Line[]][] = []
const seen = new Set<string>()
for (const [i, r] of read('manual/career_quiz.csv').entries()) {
  const at = `manual/career_quiz:${i + 2} ${r.player_id} ${r.name}`
  const p = players.get(r.player_id)
  if (!p) { problems.push(`${at}: players.csv에 없음`); continue }
  if (!TIERS.includes(r.tier as Tier)) { problems.push(`${at}: tier는 ${TIERS.join('/')}`); continue }
  if (seen.has(p.id)) { problems.push(`${at}: 중복`); continue }
  seen.add(p.id)
  const lines = linesOf(p.id)
  if (clubCount(lines) < MIN_CLUBS) { problems.push(`${at}: 1군 클럽 ${clubCount(lines)}곳 (${MIN_CLUBS}곳 이상이어야 함)`); continue }
  const twins = (byKey.get(lineKey(lines)) ?? []).filter((x) => x !== p.id)
  if (twins.length) { problems.push(`${at}: 경력이 같은 선수 ${twins.join(', ')}`); continue }
  const nameKo = namesKo.get(p.id) || p.name_ko || p.name_en
  rows.push([p.id, nameKo, playerNames.get(p.id) || p.name_en, r.tier as Tier, lines])
}

if (problems.length) {
  console.error(`문제 ${problems.length}개. 명단이나 manual/ 파일을 고친 뒤 다시 돌린다:`)
  for (const m of problems) console.error(`  ${m}`)
  process.exit(1)
}

const count = (t: Tier) => rows.filter((r) => r[3] === t).length
const body = [
  '// 자동 생성: npm run football:career-quiz (scripts/football/build-career-quiz.ts). 직접 고치지 않는다.',
  '// 출처: data/football/ (위키데이터, CC0). 바뀌면 logic.version을 올리고 play 함수를 다시 배포한다.',
  '',
  '/** 경력 한 줄: [시작 연도, 끝 연도(없으면 null), 클럽 영문 짧은 이름, 임대 1/0] */',
  'export type Line = [from: number, to: number | null, team: string, loan: 0 | 1]',
  "export type Tier = 'easy' | 'normal' | 'hard'",
  '/** [위키데이터 QID, 한글 이름, 영문 이름, 난이도, 1군 경력] */',
  'export type QuizRow = [id: string, nameKo: string, nameEn: string, tier: Tier, lines: Line[]]',
  '',
  'export const QUIZ: QuizRow[] = [',
  ...rows.map((r) => `  ${JSON.stringify(r)},`),
  ']',
  '',
].join('\n')
writeFileSync(out, body)
console.error(`${out}: ${rows.length}명 (쉬움 ${count('easy')}, 보통 ${count('normal')}, 어려움 ${count('hard')})`)
