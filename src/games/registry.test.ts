import { expect, test } from 'vitest'
import { games, getGame } from './index.ts'

test('every game has unique id, valid id format, and options defaults in choices', () => {
  expect(games.length).toBeGreaterThan(0)
  const ids = games.map((g) => g.manifest.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const g of games) {
    expect(g.manifest.id).toMatch(/^[a-z0-9-]+$/)
    expect(getGame(g.manifest.id)).toBe(g)
    for (const o of g.manifest.options) {
      expect(o.choices.map((c) => c.value)).toContain(o.default)
    }
  }
  expect(getGame('nope')).toBeUndefined()
})

test('hidden games match hidden_games seed in migrations', () => {
  // supabase/migrations/*.sql 원문 (Vite glob, node 타입 없이 읽는다)
  const sqlFiles = import.meta.glob('../../supabase/migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  expect(Object.keys(sqlFiles).length).toBeGreaterThan(0)

  const seeded = new Set<string>()
  for (const sql of Object.values(sqlFiles)) {
    for (const m of sql.matchAll(/insert\s+into\s+(?:public\.)?hidden_games\s*(?:\([^)]*\))?\s*values\s*([^;]+);/gi)) {
      for (const v of m[1].matchAll(/'([^']*)'/g)) seeded.add(v[1])
    }
  }
  const hidden = games.filter((g) => g.manifest.hidden).map((g) => g.manifest.id)
  expect([...seeded].sort()).toEqual([...hidden].sort())
})
