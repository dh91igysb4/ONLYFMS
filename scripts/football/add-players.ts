// manual/legends.csv에 있지만 players.csv에 없는 선수를, 전체 수집(football:fetch, 몇 시간) 없이 기존 CSV에 더한다.
//
//   npm run football:add-players -- [--dir data/football] [--no-cache]
//
// 위키데이터에서 그 선수들의 정보·경력·국가대표·수상·별칭·Transfermarkt ID만 받는다. 기존 선수 줄은 건드리지 않는다.
// 경력의 팀이 teams.csv에 없으면 그 구간은 뺀다(전체 수집 때 팀까지 받는다). 인지도는 기존 선수의 지금 위키 문서 수 분포에서의 백분위.
// 날짜가 없거나 빠진 경력은 manual/spells.csv로 채운다. 다음 순서: football:seasons → football:honours → ttt:generate.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeRows, popularityAgainst } from './addPlayers.ts'
import { checkDataset, FILE_NAMES, FILES, type Dataset, type FileName } from './schema.ts'
import { batched, log, type Cache } from './wdqs.ts'
import {
  applyNamesEn, applyNamesKo, buildAliases, buildAwards, buildCaps, buildPlayers, buildSpells, parseCsv, qAliases, qAwards, qOccupation, qPlayerDetails, qSpells, toCsv,
  type Row, type Team,
} from './wikidata.ts'

const a = process.argv.slice(2)
const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined }
const dir = get('dir') ?? 'data/football'
const cache: Cache = { dir: get('cache') ?? '.cache/wikidata', refresh: a.includes('--no-cache') }
mkdirSync(cache.dir, { recursive: true })

const file = (f: string) => join(dir, f.includes('/') ? f : `${f}.csv`)
const read = (f: string) => parseCsv(readFileSync(file(f), 'utf8'))
const write = (f: FileName, rows: readonly object[]) => writeFileSync(file(f), toCsv(FILES[f].columns, rows as Record<string, unknown>[]))

const players = read('players')
const known = new Set(players.map((p) => p.id))
const legends = read('manual/legends.csv')
const wanted = [...new Set(legends.map((r) => r.player_id.trim()).filter((id) => /^Q\d+$/.test(id) && !known.has(id)))].sort()
if (!wanted.length) { log('legends.csv의 선수가 모두 players.csv에 있다. 더할 선수 없음'); process.exit(0) }
log(`players.csv에 없는 legends.csv 선수 ${wanted.length}명`)

const ok = new Set((await batched('축구 선수 확인', wanted, 200, qOccupation, cache)).map((r) => r.p))
for (const id of wanted.filter((x) => !ok.has(x))) log(`  축구 선수가 아님, 뺌: ${id}`)
const ids = wanted.filter((x) => ok.has(x))

const teamMap = new Map(read('teams').map((t) => [t.id, t as unknown as Team]))
const { spells, national, dropped } = buildSpells(await batched('경력', ids, 100, qSpells, cache), teamMap)
const caps = buildCaps(national)
log(`경력 ${spells.length}개, 국가대표 ${caps.length}개 (teams.csv에 없는 팀·유스·날짜 없음으로 뺀 구간 ${dropped}개)`)

const built = buildPlayers(await batched('선수 정보', ids, 100, qPlayerDetails, cache), caps, teamMap)
const added = built.players.filter((p) => p.name_en)
for (const p of built.players.filter((x) => !x.name_en)) log(`  이름 라벨 없음, 뺌: ${p.id}`)
const keep = new Set(added.map((p) => p.id))

// 인지도: 기존 선수의 지금 위키 문서 수와 비교한 백분위
const baseLinks = (await batched('기존 선수 위키 문서 수', [...known], 500, (c) => `SELECT ?p ?links WHERE { VALUES ?p { ${c.map((q) => `wd:${q}`).join(' ')} } ?p wikibase:sitelinks ?links }`, cache)).map((r) => Number(r.links))
const pop = popularityAgainst(baseLinks, new Map([...built.links].filter(([id]) => keep.has(id))))
for (const p of added) p.popularity = String(pop.get(p.id) ?? 0)
applyNamesKo(added, read('manual/names_ko.csv'))
applyNamesEn(added, existsSync(file('manual/names_en.csv')) ? read('manual/names_en.csv') : [])

const awards = buildAwards(await batched('수상', ids, 200, qAwards, cache)).filter((h) => keep.has(h.player_id))
const aliases = buildAliases(added, await batched('별칭', ids, 200, qAliases, cache)).filter((x) => keep.has(x.entity_id))
const external = [...built.transfermarkt].filter(([id]) => keep.has(id)).map(([entity_id, external_id]) => ({ entity_id, source: 'transfermarkt', external_id }))

write('players', mergeRows('players', players, added))
write('spells', mergeRows('spells', read('spells'), spells.filter((s) => keep.has(s.player_id))))
write('caps', mergeRows('caps', read('caps'), caps.filter((c) => keep.has(c.player_id))))
write('honours', mergeRows('honours', read('honours'), awards))
write('aliases', mergeRows('aliases', read('aliases'), aliases))
write('external_ids', mergeRows('external_ids', read('external_ids'), external))

const files = {} as Dataset['files'], headers = {} as Dataset['headers']
for (const f of FILE_NAMES) {
  const text = readFileSync(file(f), 'utf8')
  files[f] = parseCsv(text) as Row[]
  headers[f] = text.split(/\r?\n/, 1)[0].split(',')
}
const problems = checkDataset({ files, headers }, legends)
log(`\n선수 ${added.length}명 더함: ${added.slice(0, 10).map((p) => `${p.name_en}(${p.popularity})`).join(', ')}${added.length > 10 ? ' …' : ''}`)
if (problems.length) {
  log(`CSV 검사 오류 ${problems.length}개 (앞 30개):`)
  for (const m of problems.slice(0, 30)) log(`  ${m}`)
  process.exitCode = 1
} else log('CSV 검사 통과. 다음: npm run football:seasons → npm run football:honours → npm run ttt:generate')
