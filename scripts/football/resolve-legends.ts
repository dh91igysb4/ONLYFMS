// 발롱도르 후보 명단(manual/ballon_dor_nominees.csv, 이름)을 위키데이터 ID로 바꿔 manual/legends.csv에 넣는다.
// 설계 docs/superpowers/specs/2026-11-01-football-data-layer-design.md §3.4. 순수 부분은 legends.ts.
//
//   npm run football:legends -- [--dir data/football] [--no-cache]
//
// 결과:
//   manual/ballon_dor_resolved.csv  이름별 판정(ok·manual·ambiguous·none), 고른 ID, 생년, 위키 문서 수, 다른 후보
//   manual/legends.csv              ok·manual만 넣는다. 손으로 넣은 줄([발롱도르]로 시작하지 않는 note)은 그대로 둔다
// ambiguous·none은 nominees.csv의 player_id 칸에 ID를 적고 다시 돌린다. 그다음 npm run football:fetch.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeLegendRows, parseNominees, qResolveNames, resolveNominees } from './legends.ts'
import { batched, log } from './wdqs.ts'
import { parseCsv, toCsv } from './wikidata.ts'

function args() {
  const a = process.argv.slice(2)
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined }
  return { dir: get('dir') ?? 'data/football', cacheDir: a.includes('--no-cache') ? null : (get('cache') ?? '.cache/wikidata') }
}

async function main() {
  const o = args()
  if (o.cacheDir) mkdirSync(o.cacheDir, { recursive: true })
  const manual = join(o.dir, 'manual')
  const nominees = parseNominees(parseCsv(readFileSync(join(manual, 'ballon_dor_nominees.csv'), 'utf8')))
  log(`발롱도르 후보 ${nominees.length}명`)

  const toQuery = nominees.filter((n) => !n.player_id).map((n) => n.name)
  const rows = await batched('이름 찾기', toQuery, 40, qResolveNames, o.cacheDir)
  const resolved = resolveNominees(nominees, rows)

  writeFileSync(join(manual, 'ballon_dor_resolved.csv'),
    toCsv(['name', 'status', 'player_id', 'birth_year', 'sitelinks', 'others'], resolved))
  const legendsFile = join(manual, 'legends.csv')
  const existing = existsSync(legendsFile) ? parseCsv(readFileSync(legendsFile, 'utf8')) : []
  const legends = mergeLegendRows(existing, nominees, resolved)
  writeFileSync(legendsFile, toCsv(['player_id', 'note'], legends))

  const count = (s: string) => resolved.filter((r) => r.status === s).length
  log(`\n확정 ${count('ok')}명, 직접 지정 ${count('manual')}명, 확인 필요 ${count('ambiguous')}명, 못 찾음 ${count('none')}명`)
  log(`legends.csv ${legends.length}줄 (손으로 넣은 줄 포함)`)
  const show = (s: string, title: string) => {
    const list = resolved.filter((r) => r.status === s)
    if (!list.length) return
    log(`\n${title} (ballon_dor_nominees.csv의 player_id 칸에 ID를 적고 다시 돌린다):`)
    for (const r of list) log(`  ${r.name}${r.player_id ? ` → ${r.player_id}(${r.sitelinks})` : ''}${r.others ? ` / 다른 후보 ${r.others}` : ''}`)
  }
  // 서로 다른 이름이 같은 ID로 바뀌면 하나만 들어가므로 알린다
  const byId = new Map<string, string[]>()
  for (const r of resolved) if (r.player_id && (r.status === 'ok' || r.status === 'manual')) byId.set(r.player_id, [...(byId.get(r.player_id) ?? []), r.name])
  const dup = [...byId].filter(([, names]) => names.length > 1)
  if (dup.length) {
    log('\n같은 ID로 바뀐 이름 (하나는 잘못 찾은 것일 수 있다. player_id 칸으로 바로잡는다):')
    for (const [id, names] of dup) log(`  ${id}: ${names.join(', ')}`)
  }
  show('ambiguous', '확인 필요')
  show('none', '못 찾음')
}

main().catch((e) => { console.error(e); process.exit(1) })
