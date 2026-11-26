// 빠진 경력 점검 보고서. 네트워크(위키데이터·영어 위키백과)를 쓰고, 데이터 파일은 바꾸지 않는다.
//
//   npm run football:gaps -- [--min-pop 70] [--min-links 20] [--pool data/tiki-taka-toe/manual/clubs.csv] [--out .cache/football-gaps.csv]
//
// 대상: (가) players.csv의 인지도 min-pop 이상 선수, (나) 대상 클럽(pool)에 날짜 없는 위키데이터 경력이 있는 남자 축구 선수
// (1960년 이후 출생, 위키 문서 수 min-links 이상. DB에 없는 선수 포함). 이들의 영어 위키백과 정보상자 성인 클럽 경력 중
// 대상 클럽인데 spells.csv에 겹치는 경력이 없는 것을 manual/spells.csv add 줄 모양으로 out에 쓴다(위키 문서 수 순).
// 사람이 보고 manual/spells.csv에 옮긴다. DB에 없는 선수는 manual/legends.csv에도 넣고 football:add-players를 돌린다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findGaps, type ManualRow, type Stint } from './gaps.ts'
import { parsePlayerInfobox } from './honourParsers.ts'
import { MANUAL_SPELL_COLUMNS } from './manualSpells.ts'
import { batched, log, query, type Cache } from './wdqs.ts'
import { currentSeason, IS_FOOTBALLER, parseCsv, toCsv, type Row } from './wikidata.ts'
import { titlesToQids, wikitexts } from './wikipedia.ts'

const a = process.argv.slice(2)
const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined }
const dir = get('dir') ?? 'data/football'
const poolFile = get('pool') ?? 'data/tiki-taka-toe/manual/clubs.csv'
const minPop = Number(get('min-pop') ?? 70)
const minLinks = Number(get('min-links') ?? 20)
const outFile = get('out') ?? '.cache/football-gaps.csv'
const FROM = 1987
const now = currentSeason(new Date()) + 1
const wd: Cache = { dir: '.cache/wikidata', refresh: a.includes('--no-cache') }
const wp: Cache = { dir: '.cache/honours', refresh: a.includes('--no-cache') }
for (const c of [wd, wp]) mkdirSync(c!.dir, { recursive: true })
const wpOpts = { minIntervalMs: 2000 }

const read = (f: string) => parseCsv(readFileSync(f, 'utf8'))
const players = new Map(read(join(dir, 'players.csv')).map((p) => [p.id, p]))
const pool = new Set(read(poolFile).map((r) => r.team_id))
const spellsBy = new Map<string, Row[]>()
for (const s of read(join(dir, 'spells.csv'))) spellsBy.set(s.player_id, [...(spellsBy.get(s.player_id) ?? []), s])
const ids = (qs: readonly string[]) => qs.map((q) => `wd:${q}`).join(' ')

// (나) 대상 클럽에 날짜(시작) 없는 경력이 있는 선수
const undated = await batched('날짜 없는 경력', [...pool], 20, (c) => `SELECT DISTINCT ?p ?links WHERE {
  VALUES ?team { ${ids(c)} }
  ?p p:P54 ?st . ?st ps:P54 ?team . FILTER NOT EXISTS { ?st pq:P580 ?s }
  ${IS_FOOTBALLER}
  ?p wdt:P21 wd:Q6581097 ; wdt:P569 ?b . FILTER(?b >= "1960-01-01T00:00:00Z"^^xsd:dateTime)
  ?p wikibase:sitelinks ?links . FILTER(?links >= ${minLinks})
}`, wd)
const candidates = new Set([...[...players.values()].filter((p) => Number(p.popularity) >= minPop).map((p) => p.id), ...undated.map((r) => r.p)])
log(`대상 선수 ${candidates.size}명 (인지도 ${minPop} 이상 + 날짜 없는 경력 ${new Set(undated.map((r) => r.p)).size}명)`)

// 영어 위키백과 제목·위키 문서 수
const titled = await batched('위키백과 제목', [...candidates], 300, (c) => `SELECT ?p ?t ?links ?en WHERE {
  VALUES ?p { ${ids(c)} }
  ?a schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t .
  OPTIONAL { ?p wikibase:sitelinks ?links }
  OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
}`, wd)
log(`위키백과 문서 있는 선수 ${titled.length}명. 정보상자 받는 중 (50개씩)`)
const pages = await wikitexts(titled.map((r) => r.t), wp, fetch, wpOpts)

// 정보상자 클럽 문서 → QID: 위키데이터 sitelink 먼저, 못 찾은 것만 위키백과(리다이렉트)
const stintsOf = new Map<string, { club: string; from: number; to: number | null; loan: boolean }[]>()
for (const r of titled) { const p = pages.get(r.t); if (p) stintsOf.set(r.p, parsePlayerInfobox(p.text)) }
const clubTitles = [...new Set([...stintsOf.values()].flat().map((s) => s.club))]
const clubQid = new Map<string, string>()
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
for (let i = 0; i < clubTitles.length; i += 200) {
  const chunk = clubTitles.slice(i, i + 200)
  for (const r of await query(`SELECT ?t ?item WHERE { VALUES ?t { ${chunk.map((t) => `"${esc(t)}"@en`).join(' ')} } ?a schema:name ?t ; schema:isPartOf <https://en.wikipedia.org/> ; schema:about ?item . }`, wd)) clubQid.set(r.t, r.item)
}
const rest = clubTitles.filter((t) => !clubQid.has(t))
log(`클럽 문서 ${clubTitles.length}개 중 sitelink로 못 찾은 ${rest.length}개는 위키백과 리다이렉트로`)
for (const [t, q] of await titlesToQids(rest, wp, fetch, wpOpts)) clubQid.set(t, q)

const rows: (ManualRow & { links: string; in_db: string })[] = []
for (const r of titled) {
  const st = stintsOf.get(r.p)
  if (!st) continue
  const stints: Stint[] = st.flatMap((s) => (clubQid.has(s.club) ? [{ team: clubQid.get(s.club)!, from: s.from, to: s.to, loan: s.loan }] : []))
  const name = players.get(r.p)?.name_en || r.en || r.t
  for (const g of findGaps({ player: r.p, name, title: pages.get(r.t)!.title, stints, spells: (spellsBy.get(r.p) ?? []) as unknown as { team_id: string; start_date: string; end_date: string }[], pool, from: FROM, now })) {
    rows.push({ links: r.links ?? '0', in_db: players.has(r.p) ? '1' : '0', ...g })
  }
}
rows.sort((x, y) => Number(y.links) - Number(x.links) || (x.player_id < y.player_id ? -1 : 1))
if (!existsSync('.cache')) mkdirSync('.cache')
writeFileSync(outFile, toCsv(['links', 'in_db', ...MANUAL_SPELL_COLUMNS], rows))
log(`\n빠진 경력 후보 ${rows.length}줄 (DB에 없는 선수 ${new Set(rows.filter((r) => r.in_db === '0').map((r) => r.player_id)).size}명) → ${outFile}`)
for (const r of rows.slice(0, 40)) log(`  ${r.links.padStart(3)} ${r.in_db === '1' ? '  ' : '새'} ${r.note.split(' · ')[0]} ${r.team_id} ${r.start_date}–${r.end_date}${r.loan === 'true' ? ' (임대)' : ''}`)
