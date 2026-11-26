// 위키백과 Action API 클라이언트 (설계 2026-11-25-football-honours-design.md §3.3). 가짜 fetcher로 네트워크 없이 본다.
import { expect, test } from 'vitest'
import { titlesToQids, wikitext, wikitexts } from './wikipedia.ts'

const fakeFetch = (...bodies: unknown[]) => {
  let i = 0
  return (async () => {
    const b = bodies[Math.min(i++, bodies.length - 1)]
    if (typeof b === 'number') return new Response('You are making too many requests', { status: b, headers: { 'retry-after': '0' } })
    return new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}
const opts = { minIntervalMs: 0 }

test('qids_follow_redirects', async () => {
  const fetcher = fakeFetch({ query: {
    normalized: [{ from: 'ronaldo (Brazilian footballer)', to: 'Ronaldo (Brazilian footballer)' }],
    redirects: [{ from: 'Ronaldo (Brazilian footballer)', to: 'Ronaldo (footballer, born 1976)' }],
    pages: [{ title: 'Ronaldo (footballer, born 1976)', pageprops: { wikibase_item: 'Q529207' } }] } })
  const m = await titlesToQids(['ronaldo (Brazilian footballer)'], null, fetcher, opts)
  expect(m.get('ronaldo (Brazilian footballer)')).toBe('Q529207')
})
test('qids_missing_page', async () => {
  const fetcher = fakeFetch({ query: { pages: [{ title: 'Nobody', missing: true }] } })
  expect((await titlesToQids(['Nobody'], null, fetcher, opts)).has('Nobody')).toBe(false)
})
test('rate_limited_then_ok', async () => {
  const fetcher = fakeFetch(429, { parse: { title: 'X', wikitext: 'hello' } })
  expect(await wikitext('X', null, fetcher, opts)).toEqual({ title: 'X', text: 'hello' })
})
test('wikitext_missing_is_null', async () => {
  const fetcher = fakeFetch({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } })
  expect(await wikitext('Nope', null, fetcher, opts)).toBeNull()
})
test('wikitexts_batch_follows_redirects', async () => {
  const fetcher = fakeFetch({ query: {
    redirects: [{ from: 'Dávinson Sánchez', to: 'Davinson Sánchez' }],
    pages: [
      { title: 'Davinson Sánchez', revisions: [{ slots: { main: { content: 'A' } } }] },
      { title: 'Nobody', missing: true },
    ] } })
  const m = await wikitexts(['Dávinson Sánchez', 'Nobody'], null, fetcher, opts)
  expect([...m]).toEqual([['Dávinson Sánchez', { title: 'Davinson Sánchez', text: 'A' }]])
})
