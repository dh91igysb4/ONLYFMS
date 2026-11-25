// 대상 리그의 전신 대회와 시즌 커버리지를 찍는다 (설계 docs/superpowers/specs/2026-11-25-football-history-clubs-design.md §3.7).
//
//   npm run football:eras
//   npm run football:eras -- --find "Football League Second Division"   (영어 라벨로 대회 QID 찾기)
//
// 리그 QID에서 이전 대회(P155·P1365)를 1987년 이전에 닿을 때까지 최대 3단계 따라가며, QID마다 영어 라벨,
// 시즌 항목 연도 범위, 참가팀(P1923)이 있는 시즌 수를 표로 출력한다. 출력은 leagues.ts의 since·eras를 채우는 데 쓴다.
import { mkdirSync } from 'node:fs'
import { HISTORY_FROM, LEAGUES } from './leagues.ts'
import { qByLabel, qLineage, qSeasonYears, summarizeSeasons } from './eras.ts'
import { query } from './wdqs.ts'

const cache = { dir: '.cache/wikidata', refresh: process.argv.includes('--no-cache') }
mkdirSync(cache.dir, { recursive: true })
const out = (s: string) => console.log(s)

const fi = process.argv.indexOf('--find')
if (fi >= 0) {
  const label = process.argv[fi + 1] ?? ''
  const rows = await query(qByLabel(label), cache)
  out(`"${label}" 시즌 항목이 있는 대회 ${rows.length}개`)
  for (const r of rows) out(`  ${r.c}: 시즌 ${r.seasons}개 (${r.first ?? '?'}~${r.last ?? '?'})`)
  process.exit(0)
}

for (const league of LEAGUES) {
  out(`\n== ${league.name_en} (${league.id})`)
  let frontier = [league.id]
  const seen = new Set<string>()
  for (let depth = 0; depth <= 3 && frontier.length; depth++) {
    const lineage = await query(qLineage(frontier), cache)
    const seasons = summarizeSeasons(await query(qSeasonYears(frontier), cache))
    const next: string[] = []
    for (const c of frontier) {
      seen.add(c)
      const rows = lineage.filter((r) => r.c === c)
      const label = rows.find((r) => r.label)?.label ?? '?'
      const s = seasons.get(c)
      out(`  ${'  '.repeat(depth)}${c} ${label}: 시즌 ${s ? `${s.first}~${s.last} ${s.count}개, 참가팀 있음 ${s.withTeams}` : '없음'}`)
      for (const r of rows.filter((x) => x.other)) {
        out(`  ${'  '.repeat(depth)}  ${r.rel} → ${r.other} ${r.otherLabel ?? ''}`)
        const older = r.rel === 'P155' || r.rel === 'P1365'
        if (older && !seen.has(r.other) && (!s || s.first > HISTORY_FROM)) next.push(r.other)
      }
    }
    frontier = [...new Set(next)]
  }
}
