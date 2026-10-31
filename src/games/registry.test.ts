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

/**
 * 마이그레이션 SQL을 파일 이름순, 파일 안에서는 글 순서대로 적용해 hidden_games 최종 집합을 구한다.
 * `insert into hidden_games … values (...)`는 추가, `delete from hidden_games where game_id = '…'`
 * / `where game_id in ('…', …)`는 제거.
 */
function hiddenGamesFromMigrations(files: Record<string, string>): Set<string> {
  const stmt =
    /insert\s+into\s+(?:public\.)?hidden_games\s*(?:\([^)]*\))?\s*values\s*([^;]+);|delete\s+from\s+(?:public\.)?hidden_games\s+where\s+game_id\s*(?:=|in)\s*([^;]+);/gi
  const result = new Set<string>()
  for (const name of Object.keys(files).sort()) {
    for (const m of files[name].matchAll(stmt)) {
      const ids = [...(m[1] ?? m[2]).matchAll(/'([^']*)'/g)].map((v) => v[1])
      for (const id of ids) {
        if (m[1] !== undefined) result.add(id)
        else result.delete(id)
      }
    }
  }
  return result
}

test('hiddenGamesFromMigrations applies later deletes in filename order', () => {
  const files = {
    '../../supabase/migrations/0009_unhide.sql':
      "delete from public.hidden_games where game_id = 'a-game';\ndelete from hidden_games where game_id in ('c-game', 'x');",
    '../../supabase/migrations/0002_seed.sql':
      "insert into hidden_games (game_id) values ('a-game'), ('b-game');\ninsert into public.hidden_games values ('c-game');",
  }
  expect([...hiddenGamesFromMigrations(files)].sort()).toEqual(['b-game'])
})

test('hidden games match hidden_games seed in migrations', () => {
  // supabase/migrations/*.sql 원문 (Vite glob, node 타입 없이 읽는다)
  const sqlFiles = import.meta.glob('../../supabase/migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  expect(Object.keys(sqlFiles).length).toBeGreaterThan(0)

  const seeded = hiddenGamesFromMigrations(sqlFiles)
  const hidden = games.filter((g) => g.manifest.hidden).map((g) => g.manifest.id)
  expect([...seeded].sort()).toEqual([...hidden].sort())
})
