// 영어 위키백과 Action API 호출과 응답 캐시 (설계 2026-11-25-football-honours-design.md §3.3).
// 위키미디어는 익명 연속 호출에 429(또는 200이 아닌 안내문)를 자주 돌려준다. 요청 사이 간격(기본 5초)을 두고,
// 429·안내문이면 Retry-After(없으면 30초 × 시도 횟수)만큼 기다려 최대 6번 다시 보낸다.
// 응답은 cache.dir에 요청 인자의 SHA-1 이름으로 보관한다(wdqs.ts와 같은 Cache 형식).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log, type Cache } from './wdqs.ts'

const ENDPOINT = 'https://en.wikipedia.org/w/api.php'
const UA = process.env.WIKIPEDIA_UA ?? 'ONLYFMS-data/0.1 (https://github.com/dh91igysb4/ONLYFMS; football quiz for friends)'
export type ApiOpts = { minIntervalMs?: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let last = 0

type Json = Record<string, unknown>

async function api(params: Record<string, string>, cache: Cache, fetcher: typeof fetch, opts: ApiOpts): Promise<Json> {
  const all = { ...params, format: 'json', formatversion: '2' }
  const qs = new URLSearchParams(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1))).toString()
  const file = cache && join(cache.dir, `wp-${createHash('sha1').update(qs).digest('hex')}.json`)
  if (file && !cache.refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Json
  const gap = opts.minIntervalMs ?? 5000
  for (let attempt = 1; ; attempt++) {
    const wait = last + gap - Date.now()
    if (wait > 0) await sleep(wait)
    last = Date.now()
    const res = await fetcher(`${ENDPOINT}?${qs}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    const body = await res.text()
    if (res.ok && body.trimStart().startsWith('{')) {
      if (file) writeFileSync(file, body)
      return JSON.parse(body) as Json
    }
    if (attempt >= 6) throw new Error(`위키백과 ${res.status}: ${body.slice(0, 200)}`)
    const ra = Number(res.headers.get('retry-after'))
    const ms = Number.isFinite(ra) && res.headers.get('retry-after') !== null ? ra * 1000 : 30000 * attempt
    log(`  위키백과 ${res.status}, ${ms / 1000}초 뒤 다시 (${attempt}/6)`)
    await sleep(ms)
  }
}

/** 문서 위키텍스트. 리다이렉트를 따라가고, 문서가 없으면 null */
export async function wikitext(title: string, cache: Cache, fetcher: typeof fetch = fetch, opts: ApiOpts = {}): Promise<{ title: string; text: string } | null> {
  const r = await api({ action: 'parse', page: title, prop: 'wikitext', redirects: '1' }, cache, fetcher, opts)
  const p = r.parse as { title: string; wikitext: string } | undefined
  if (!p) {
    const code = (r.error as { code?: string } | undefined)?.code
    if (code === 'missingtitle' || code === 'invalidtitle') return null
    throw new Error(`위키백과 parse 실패 ${title}: ${JSON.stringify(r.error ?? r).slice(0, 200)}`)
  }
  return { title: p.title, text: p.wikitext }
}

/** 문서 제목 → 위키데이터 QID (정규화·리다이렉트를 따라감). 없는 문서·항목 없는 문서는 맵에 없다 */
export async function titlesToQids(titles: readonly string[], cache: Cache, fetcher: typeof fetch = fetch, opts: ApiOpts = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const uniq = [...new Set(titles)].sort()
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50)
    const r = await api({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: chunk.join('|') }, cache, fetcher, opts)
    const q = (r.query ?? {}) as { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: { title: string; missing?: boolean; pageprops?: { wikibase_item?: string } }[] }
    const norm = new Map((q.normalized ?? []).map((x) => [x.from, x.to]))
    const red = new Map((q.redirects ?? []).map((x) => [x.from, x.to]))
    const qid = new Map((q.pages ?? []).filter((p) => !p.missing && p.pageprops?.wikibase_item).map((p) => [p.title, p.pageprops!.wikibase_item!]))
    for (const t of chunk) {
      const n = norm.get(t) ?? t
      const id = qid.get(red.get(n) ?? n)
      if (id) out.set(t, id)
    }
  }
  return out
}
