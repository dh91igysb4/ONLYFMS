// 위키데이터 공식 질의 서비스(query.wikidata.org) 호출과 응답 캐시. fetch-wikidata.ts와 resolve-legends.ts가 함께 쓴다.
// 한 번에 한 요청, 요청 사이 1초 간격. 응답은 cacheDir(기본 .cache/wikidata/)에 질의 문장의 SHA-1 이름으로 보관한다.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { flat, type Binding, type Row } from './wikidata.ts'

const ENDPOINT = 'https://query.wikidata.org/sparql'
const UA = process.env.WIKIDATA_UA ?? 'ONLYFMS-data/0.1 (https://github.com/dh91igysb4/ONLYFMS; football quiz for friends)'

export class QueryTimeout extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const log = (...m: unknown[]) => console.error(...m)

export async function query(sparql: string, cacheDir: string | null): Promise<Row[]> {
  const file = cacheDir && join(cacheDir, `${createHash('sha1').update(sparql).digest('hex')}.json`)
  if (file && existsSync(file)) return (JSON.parse(readFileSync(file, 'utf8')) as Binding[]).map(flat)
  for (let attempt = 0; ; attempt++) {
    await sleep(1000)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query: sparql }),
    })
    if (res.ok) {
      const bindings = (await res.json() as { results: { bindings: Binding[] } }).results.bindings
      if (file) writeFileSync(file, JSON.stringify(bindings))
      return bindings.map(flat)
    }
    const body = await res.text()
    // 질의 시간 초과(60초)는 다시 보내도 같으므로 묶음을 나눠 보내게 한다
    if (/TimeoutException|upstream request timeout/i.test(body)) throw new QueryTimeout()
    if (attempt >= 5 || ![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`위키데이터 ${res.status}: ${body.slice(0, 300)}`)
    const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * 2 ** attempt
    log(`  ${res.status}, ${wait / 1000}초 뒤 다시 시도`)
    await sleep(wait)
  }
}

/** 목록을 size개씩 나눠 질의한다. 시간 초과면 그 묶음을 반으로 나눠 다시 보낸다 */
export async function batched(label: string, items: readonly string[], size: number, build: (chunk: string[]) => string, cacheDir: string | null): Promise<Row[]> {
  const out: Row[] = []
  const run = async (chunk: string[]): Promise<void> => {
    try {
      out.push(...await query(build(chunk), cacheDir))
    } catch (e) {
      if (!(e instanceof QueryTimeout)) throw e
      if (chunk.length === 1) { log(`  ${label}: ${chunk[0]} 시간 초과, 건너뜀`); return }
      const mid = chunk.length >> 1
      await run(chunk.slice(0, mid))
      await run(chunk.slice(mid))
    }
  }
  const sorted = [...items].sort()
  for (let i = 0; i < sorted.length; i += size) {
    log(`${label} ${Math.min(i + size, sorted.length)}/${sorted.length}`)
    await run(sorted.slice(i, i + size))
  }
  return out
}
