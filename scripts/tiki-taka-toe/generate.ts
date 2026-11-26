// 티키타카토 문제 은행 생성 (`npm run ttt:generate`, 설계 docs/superpowers/specs/2026-11-26-tiki-taka-toe-design.md §5.1).
// data/football/ CSV → data/tiki-taka-toe/{conditions,condition_players,puzzles}.csv.
// 같은 데이터면 같은 결과(테마마다 고정 시드). condition_players.csv는 판에 쓰인 조건만 쓴다.
// 테마가 시도 상한 안에 PER_THEME판을 못 채우면 만든 만큼 쓰고 경고를 낸다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cmp, toCsv } from '../football/wikidata.ts'
import { buildConditions, readFootballData, THEMES } from './conditions.ts'
import { cellStats, generatePuzzles, type Puzzle } from './puzzles.ts'

const PER_THEME = 1000
const SEED = 20261126
const SAMPLES = 3

const ROOT = join(import.meta.dirname, '..', '..')
const OUT = join(ROOT, 'data', 'tiki-taka-toe')

const t0 = Date.now()
const data = readFootballData(join(ROOT, 'data', 'football'))
const { conditions, players: sets } = buildConditions(data)
const popularity = new Map(data.players.map((p) => [p.id, Number(p.popularity) || 0]))
const playerName = new Map(data.players.map((p) => [p.id, p.name_ko || p.name_en]))
const byId = new Map(conditions.map((c) => [c.id, c]))
console.log(`조건 ${conditions.length}개 (${((Date.now() - t0) / 1000).toFixed(1)}초)`)

const cellAnswers = (r: string, c: string) => [...sets.get(r)!].filter((p) => sets.get(c)!.has(p))
const quantiles = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return `최소 ${s[0]} · 중앙 ${s[Math.floor(s.length / 2)]} · 최대 ${s[s.length - 1]}`
}

const puzzles: Puzzle[] = []
const warnings: string[] = []
THEMES.forEach((theme, k) => {
  const t = Date.now()
  const got = generatePuzzles(theme, PER_THEME, conditions, sets, popularity, SEED + k)
  puzzles.push(...got)
  const counts = got.flatMap((p) => p.rows.flatMap((r) => p.cols.map((c) => cellStats(sets.get(r)!, sets.get(c)!, popularity).n)))
  console.log(`\n[${theme}] 판 ${got.length} (${((Date.now() - t) / 1000).toFixed(1)}초)  칸 정답 수 ${got.length ? quantiles(counts) : '-'}`)
  if (got.length < PER_THEME) warnings.push(`${theme}: ${PER_THEME}판 중 ${got.length}판만 만들었다`)
  const kinds = new Map<string, number>()
  for (const p of got) for (const id of [...p.rows, ...p.cols]) kinds.set(byId.get(id)!.kind, (kinds.get(byId.get(id)!.kind) ?? 0) + 1)
  console.log('  종류별 머리칸 수: ' + [...kinds].sort((a, b) => b[1] - a[1]).map(([kd, v]) => `${kd} ${v}`).join(', '))
  const distinct = new Set(got.flatMap((p) => [...p.rows, ...p.cols]))
  console.log(`  쓰인 조건 ${distinct.size}개`)
  for (const p of got.slice(0, SAMPLES)) {
    console.log(`  ${p.id}  열: ${p.cols.map((c) => byId.get(c)!.label_ko).join(' | ')}`)
    for (const r of p.rows) {
      const cells = p.cols.map((c) => {
        const ans = cellAnswers(r, c).sort((a, b) => (popularity.get(b) ?? 0) - (popularity.get(a) ?? 0) || cmp(a, b))
        return `${ans.length}명(${ans.slice(0, 3).map((a) => playerName.get(a)).join(', ')})`
      })
      console.log(`    ${byId.get(r)!.label_ko}: ${cells.join(' | ')}`)
    }
  }
})

const used = new Set(puzzles.flatMap((p) => [...p.rows, ...p.cols]))
const usedConditions = conditions.filter((c) => used.has(c.id)).sort((a, b) => cmp(a.id, b.id))
const pairs = usedConditions.flatMap((c) => [...sets.get(c.id)!].sort(cmp).map((player_id) => ({ condition_id: c.id, player_id })))

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'conditions.csv'), toCsv(['id', 'kind', 'label_ko', 'label_en', 'ref'], [...conditions].sort((a, b) => cmp(a.id, b.id))))
writeFileSync(join(OUT, 'condition_players.csv'), toCsv(['condition_id', 'player_id'], pairs))
writeFileSync(join(OUT, 'puzzles.csv'), toCsv(['id', 'theme', 'r1', 'r2', 'r3', 'c1', 'c2', 'c3'],
  puzzles.map((p) => ({ id: p.id, theme: p.theme, r1: p.rows[0], r2: p.rows[1], r3: p.rows[2], c1: p.cols[0], c2: p.cols[1], c3: p.cols[2] }))))

console.log(`\n쓴 파일: conditions.csv ${conditions.length}행, condition_players.csv ${pairs.length}행(조건 ${usedConditions.length}개), puzzles.csv ${puzzles.length}행`)
for (const w of warnings) console.warn(`경고: ${w}`)
console.log(`전체 ${((Date.now() - t0) / 1000).toFixed(1)}초`)
