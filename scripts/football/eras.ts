// 리그의 전신 대회 찾기용 질의와 정리 (설계 docs/superpowers/specs/2026-11-25-football-history-clubs-design.md §3.7). 순수 함수만.
// 실행은 find-eras.ts (npm run football:eras).
import type { Row } from './wikidata.ts'

const ids = (qs: readonly string[]) => qs.map((q) => `wd:${q}`).join(' ')

/** 대회의 영어 라벨과 이전·다음 대회(P155 follows, P156 followed by, P1365 replaces, P1366 replaced by) */
export function qLineage(comps: readonly string[]): string {
  return `SELECT ?c ?label ?rel ?other ?otherLabel WHERE {
  VALUES ?c { ${ids(comps)} }
  OPTIONAL { ?c rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL {
    { ?c wdt:P155 ?other BIND("P155" AS ?rel) } UNION { ?c wdt:P156 ?other BIND("P156" AS ?rel) }
    UNION { ?c wdt:P1365 ?other BIND("P1365" AS ?rel) } UNION { ?c wdt:P1366 ?other BIND("P1366" AS ?rel) }
    OPTIONAL { ?other rdfs:label ?otherLabel FILTER(LANG(?otherLabel) = "en") }
  }
}`
}

/** 대회별 시즌 항목(P3450)의 시작 연도와 참가팀(P1923) 수 */
export function qSeasonYears(comps: readonly string[]): string {
  return `SELECT ?c ?year (COUNT(DISTINCT ?team) AS ?teams) WHERE {
  VALUES ?c { ${ids(comps)} }
  ?season wdt:P3450 ?c .
  OPTIONAL { ?season wdt:P580 ?s0 }
  OPTIONAL { ?season wdt:P585 ?p0 }
  BIND(YEAR(COALESCE(?s0, ?p0)) AS ?year)
  FILTER(BOUND(?year))
  OPTIONAL { ?season wdt:P1923 ?team }
} GROUP BY ?c ?year`
}

export type SeasonSummary = { first: number; last: number; count: number; withTeams: number }

/** qSeasonYears 결과를 대회별 시즌 연도 범위·시즌 수·참가팀이 있는 시즌 수로 */
export function summarizeSeasons(rows: readonly Row[]): Map<string, SeasonSummary> {
  const m = new Map<string, SeasonSummary>()
  for (const r of rows) {
    const y = Number(r.year)
    if (!r.c || !Number.isFinite(y)) continue
    const s = m.get(r.c) ?? { first: y, last: y, count: 0, withTeams: 0 }
    s.first = Math.min(s.first, y); s.last = Math.max(s.last, y); s.count++
    if (Number(r.teams) > 0) s.withTeams++
    m.set(r.c, s)
  }
  return m
}

/** 영어 라벨이 정확히 같은 항목 중 시즌 항목(P3450)이 붙은 대회와 시즌 수. 전신 대회 QID를 이름으로 찾을 때 쓴다 */
export function qByLabel(label: string): string {
  const lit = JSON.stringify(label)
  return `SELECT ?c (COUNT(DISTINCT ?season) AS ?seasons) (MIN(YEAR(?start)) AS ?first) (MAX(YEAR(?start)) AS ?last) WHERE {
  ?c rdfs:label ${lit}@en .
  ?season wdt:P3450 ?c .
  OPTIONAL { ?season wdt:P580 ?s0 } OPTIONAL { ?season wdt:P585 ?p0 }
  BIND(COALESCE(?s0, ?p0) AS ?start)
} GROUP BY ?c`
}
