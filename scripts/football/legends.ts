// 레전드 명단 만들기의 순수 부분 (입출력 없음, legends.test.ts).
// 원본 manual/ballon_dor_nominees.csv(이름)를 위키데이터 ID로 바꿔 manual/legends.csv에 넣는다. 입출력은 resolve-legends.ts.
// 설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §3.4.
import { cmp, type Row } from './wikidata.ts'

/** 직업: 축구 선수 */
const FOOTBALLER = 'Q937857'
/** legends.csv에서 이 도구가 만든 줄의 note 머리. 다시 돌리면 이 줄들만 새로 만든다(손으로 넣은 줄은 그대로) */
export const BALLON_MARK = '[발롱도르]'

export type Nominee = { name: string; nation_ko: string; years: number[]; best_rank: number | null; player_id: string }

/** ballon_dor_nominees.csv (name,nation_ko,years,best_rank,player_id) 행을 읽는다. years는 공백으로 구분 */
export function parseNominees(rows: readonly Row[]): Nominee[] {
  return rows.filter((r) => (r.name ?? '').trim()).map((r) => ({
    name: r.name.trim(),
    nation_ko: (r.nation_ko ?? '').trim(),
    years: (r.years ?? '').split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger).sort((a, b) => a - b),
    best_rank: /^\d+$/.test((r.best_rank ?? '').trim()) ? Number(r.best_rank) : null,
    player_id: (r.player_id ?? '').trim(),
  }))
}

const lit = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * 이름이 영어·다국어(mul) 라벨이나 별칭과 정확히 같은 축구 선수. ?lit에는 일치한 이름(언어 태그 없는 값)이 온다.
 * 언어 태그를 붙인 값으로 찾아야 색인을 타므로 이름마다 @en·@mul 두 개를 넣는다.
 */
export function qResolveNames(names: readonly string[]): string {
  const values = names.flatMap((n) => [`${lit(n)}@en`, `${lit(n)}@mul`]).join(' ')
  return `SELECT ?lit ?p ?links ?birth WHERE {
  VALUES ?lit { ${values} }
  ?p rdfs:label|skos:altLabel ?lit .
  ?p wdt:P106 wd:${FOOTBALLER} .
  OPTIONAL { ?p wikibase:sitelinks ?links }
  OPTIONAL { ?p wdt:P569 ?birth }
}`
}

export type Status = 'ok' | 'manual' | 'ambiguous' | 'none'
export type Resolution = { name: string; status: Status; player_id: string; birth_year: string; sitelinks: string; others: string }

/**
 * 후보 중 하나를 고른다.
 * - player_id를 직접 적었으면 그것(manual). QID 형식이 아니면 none.
 * - 처음 후보 연도 기준 15~45세가 아닌 후보(생년을 알 때)는 뺀다.
 * - 위키 문서 수(sitelinks)가 가장 많은 후보. 2위의 2배 이상이면 ok, 아니면 ambiguous(사람이 player_id로 정한다).
 */
export function resolveNominees(nominees: readonly Nominee[], rows: readonly Row[]): Resolution[] {
  const byName = new Map<string, Map<string, { links: number; birth: number | null }>>()
  for (const r of rows) {
    if (!r.lit || !r.p) continue
    const m = byName.get(r.lit) ?? new Map()
    const by = /^\+?(\d{4})-/.exec(r.birth ?? '')
    const prev = m.get(r.p)
    const birth = by ? Number(by[1]) : null
    m.set(r.p, {
      links: Math.max(prev?.links ?? 0, Number(r.links) || 0),
      birth: prev?.birth != null && birth != null ? Math.min(prev.birth, birth) : prev?.birth ?? birth,
    })
    byName.set(r.lit, m)
  }
  return nominees.map((n) => {
    const base = { name: n.name, birth_year: '', sitelinks: '', others: '' }
    if (n.player_id) return { ...base, status: /^Q\d+$/.test(n.player_id) ? 'manual' : 'none', player_id: /^Q\d+$/.test(n.player_id) ? n.player_id : '' }
    const first = n.years[0]
    const cands = [...(byName.get(n.name) ?? new Map())]
      .map(([id, c]) => ({ id, ...c }))
      .filter((c) => c.birth == null || first === undefined || (c.birth >= first - 45 && c.birth <= first - 15))
      .sort((a, b) => b.links - a.links || cmp(a.id, b.id))
    if (!cands.length) return { ...base, status: 'none', player_id: '' }
    const [top, second] = cands
    const status: Status = !second || top.links >= 2 * second.links ? 'ok' : 'ambiguous'
    return {
      ...base, status, player_id: top.id, birth_year: top.birth == null ? '' : String(top.birth), sitelinks: String(top.links),
      others: cands.slice(1, 4).map((c) => `${c.id}(${c.links}${c.birth == null ? '' : `, ${c.birth}`})`).join(' '),
    }
  })
}

/** legends.csv note: "[발롱도르] 이름 · 후보 2004~2022 18회 · 최고 1위" */
export function legendNote(n: Nominee): string {
  const span = n.years.length ? (n.years.length === 1 ? `${n.years[0]}` : `${n.years[0]}~${n.years[n.years.length - 1]} ${n.years.length}회`) : ''
  return `${BALLON_MARK} ${n.name} · 후보 ${span} · ${n.best_rank == null ? '무득표' : `최고 ${n.best_rank}위`}`
}

/**
 * legends.csv를 새로 만든다: 손으로 넣은 줄(note가 [발롱도르]로 시작하지 않음)은 그대로 두고,
 * 이 도구가 만든 줄은 지금 확정된(ok·manual) 결과로 바꾼다. 같은 QID는 한 줄(손으로 넣은 줄 우선). player_id 순.
 */
export function mergeLegendRows(existing: readonly Row[], nominees: readonly Nominee[], resolved: readonly Resolution[]): Row[] {
  const out = new Map<string, Row>()
  for (const r of existing) {
    const id = (r.player_id ?? '').trim()
    if (id && !(r.note ?? '').startsWith(BALLON_MARK)) out.set(id, { player_id: id, note: r.note ?? '' })
  }
  const nomineeOf = new Map(nominees.map((n) => [n.name, n]))
  for (const r of resolved) {
    if ((r.status !== 'ok' && r.status !== 'manual') || out.has(r.player_id)) continue
    out.set(r.player_id, { player_id: r.player_id, note: legendNote(nomineeOf.get(r.name)!) })
  }
  return [...out.values()].sort((a, b) => cmp(a.player_id, b.player_id))
}
