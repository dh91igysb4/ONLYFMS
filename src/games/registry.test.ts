import { expect, test } from 'vitest'
import { FREE_DAILY_CAP } from './economy.ts'
import { duels, games, getDuel, getGame, getWorld, worlds } from './index.ts'
import { AVATAR_RECORD_KEY, FREE_BONUS_RECORD_KEY } from './types.ts'

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
  const hidden = [...games, ...duels, ...worlds].filter((g) => g.manifest.hidden).map((g) => g.manifest.id)
  expect([...seeded].sort()).toEqual([...hidden].sort())
})

test('duel modules: category duel, all solo modes off, turnSeconds default in choices, ids unique across games and duels', () => {
  for (const d of duels) {
    expect(d.manifest.category).toBe('duel')
    expect(d.manifest.id).toMatch(/^[a-z0-9-]+$/)
    expect(getDuel(d.manifest.id)).toBe(d)
    expect(d.manifest.modes).toEqual({ daily: false, contest: false, free: false })
    const ts = d.manifest.duel?.turnSeconds
    expect(ts).toBeDefined()
    expect(ts!.choices).toContain(ts!.default)
    expect(getGame(d.manifest.id)).toBeUndefined()
  }
  const ids = [...games, ...duels].map((g) => g.manifest.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(getDuel('nope')).toBeUndefined()
})

test('world modules: category world, all modes off, ids unique across all registries', () => {
  for (const w of worlds) {
    expect(w.manifest.category).toBe('world')
    expect(w.manifest.modes).toEqual({ daily: false, contest: false, free: false })
    expect(getWorld(w.manifest.id)).toBe(w)
    expect(getGame(w.manifest.id)).toBeUndefined()
    expect(getDuel(w.manifest.id)).toBeUndefined()
  }
  const ids = [...games, ...duels, ...worlds].map((g) => g.manifest.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(getWorld('nope')).toBeUndefined()
})

test('world modules: 지갑 계약 — legacyGold는 wallet 게임만 (설계 §6)', () => {
  for (const w of worlds) {
    expect([undefined, true, false]).toContain(w.logic.wallet)
    if (w.logic.legacyGold) expect(w.logic.wallet, `${w.manifest.id}: legacyGold에는 wallet: true가 필요하다`).toBe(true)
  }
})

test('manifest records keys are unique per game', () => {
  for (const { manifest: m } of [...games, ...duels, ...worlds]) {
    const keys = (m.records ?? []).map((r) => r.key)
    expect(new Set(keys).size, m.id).toBe(keys.length)
  }
})

test('world avatar: manifest avatar ⇔ logic.avatar, avatar key is not a record key', () => {
  for (const w of worlds) {
    expect(!!w.manifest.avatar, w.manifest.id).toBe(typeof w.logic.avatar === 'function')
    expect((w.manifest.records ?? []).map((r) => r.key)).not.toContain(AVATAR_RECORD_KEY)
  }
  for (const g of [...games, ...duels]) expect(g.manifest.avatar).toBeUndefined()
})

test('free_bonus key (도전과제 보너스 원천) is not a record key', () => {
  for (const w of worlds) expect((w.manifest.records ?? []).map((r) => r.key)).not.toContain(FREE_BONUS_RECORD_KEY)
})

test('solo modules have no duel category', () => {
  for (const g of games) expect(g.manifest.category ?? 'solo').toBe('solo')
})

type Modes = { daily: boolean; contest: boolean; free: boolean }
type Gold = { perPoint: number; playCap: number; dailyCap: number }
type ModeRow = Modes & { scoreMax: number; gold: Gold }
const NO_GOLD: Gold = { perPoint: 0, playCap: 0, dailyCap: 0 }

/**
 * 마이그레이션 SQL을 파일 이름순으로 적용해 game_modes 최종 내용을 구한다.
 * `insert into game_modes (game_id, daily, contest, free[, score_max]) values ('id', true, true, true[, 99999]), …`는
 * 추가(같은 id면 덮어씀), `delete from game_modes where game_id = '…'` / `in ('…', …)`는 제거.
 * 열 순서는 (game_id, daily, contest, free, score_max)로 고정하고, score_max가 없으면 열 기본값 10이다.
 * 자유 플레이 골드(지갑 설계 §7.1)는 고정 형식 한 문장만 읽는다:
 * `update (public.)game_modes set gold_per_point = X, gold_play_cap = Y, gold_daily_cap = Z where game_id = 'id';`
 * insert는 골드 0/0/0(열 기본값)으로 덮어쓴다. 그 밖의 `update game_modes …`는 읽지 않는다 — 쓰게 되면 여기도 고친다.
 */
function gameModesFromMigrations(files: Record<string, string>): Map<string, ModeRow> {
  const stmt =
    /insert\s+into\s+(?:public\.)?game_modes\s*(?:\(\s*game_id\s*,\s*daily\s*,\s*contest\s*,\s*free\s*(?:,\s*score_max\s*)?\))?\s*values\s*([^;]+);|delete\s+from\s+(?:public\.)?game_modes\s+where\s+game_id\s*(?:=|in)\s*([^;]+);|update\s+(?:public\.)?game_modes\s+set\s+gold_per_point\s*=\s*([0-9.]+)\s*,\s*gold_play_cap\s*=\s*([0-9]+)\s*,\s*gold_daily_cap\s*=\s*([0-9]+)\s+where\s+game_id\s*=\s*'([^']*)'\s*;/gi
  const row =
    /\(\s*'([^']*)'\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*(?:,\s*([0-9]+(?:\.[0-9]+)?)\s*)?\)/gi
  const result = new Map<string, ModeRow>()
  for (const name of Object.keys(files).sort()) {
    for (const m of files[name].matchAll(stmt)) {
      if (m[1] !== undefined) {
        for (const r of m[1].matchAll(row)) {
          result.set(r[1], {
            daily: r[2].toLowerCase() === 'true',
            contest: r[3].toLowerCase() === 'true',
            free: r[4].toLowerCase() === 'true',
            scoreMax: r[5] === undefined ? 10 : Number(r[5]),
            gold: { ...NO_GOLD },
          })
        }
      } else if (m[6] !== undefined) {
        const cur = result.get(m[6])
        if (cur) cur.gold = { perPoint: Number(m[3]), playCap: Number(m[4]), dailyCap: Number(m[5]) }
      } else {
        for (const v of m[2].matchAll(/'([^']*)'/g)) result.delete(v[1])
      }
    }
  }
  return result
}

test('gameModesFromMigrations applies inserts and later deletes in filename order', () => {
  const files = {
    '../../supabase/migrations/0009_drop.sql': "delete from public.game_modes where game_id = 'b-game';",
    '../../supabase/migrations/0003_seed.sql':
      "insert into game_modes (game_id, daily, contest, free) values ('a-game', true, false, true), ('b-game', false, true, false);",
    '../../supabase/migrations/0010_score.sql':
      "insert into game_modes (game_id, daily, contest, free, score_max) values ('c-game', false, false, true, 99999);",
    '../../supabase/migrations/0011_gold.sql':
      "update public.game_modes set gold_per_point = 0.62, gold_play_cap = 2860, gold_daily_cap = 20500 where game_id = 'c-game';\n" +
      "update game_modes set gold_per_point = 9, gold_play_cap = 9, gold_daily_cap = 9 where game_id = 'zz-missing';",
  }
  expect(Object.fromEntries(gameModesFromMigrations(files))).toEqual({
    'a-game': { daily: true, contest: false, free: true, scoreMax: 10, gold: NO_GOLD },
    'c-game': { daily: false, contest: false, free: true, scoreMax: 99999, gold: { perPoint: 0.62, playCap: 2860, dailyCap: 20500 } },
  })
})

function seededGameModes(): Map<string, ModeRow> {
  const sqlFiles = import.meta.glob('../../supabase/migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  return gameModesFromMigrations(sqlFiles)
}

test('game_modes match registry manifests', () => {
  const seeded = new Map(
    [...seededGameModes()].map(([id, { daily, contest, free }]) => [id, { daily, contest, free }]),
  )
  const fromRegistry = new Map([...games, ...duels, ...worlds].map((g) => [g.manifest.id, { ...g.manifest.modes }]))
  expect(Object.fromEntries(seeded)).toEqual(Object.fromEntries(fromRegistry))
})

test('game_modes.score_max matches manifest scoreMax (default 10)', () => {
  const seeded = seededGameModes()
  for (const { manifest: m } of [...games, ...duels, ...worlds]) {
    expect(seeded.get(m.id)?.scoreMax, m.id).toBe(m.scoreMax ?? 10)
  }
})

test('scoreMax other than 10 requires a free-only score game', () => {
  for (const { manifest: m } of games) {
    if ((m.scoreMax ?? 10) !== 10) {
      expect(m.freeStats, m.id).toBe('score')
      expect(m.modes.daily, m.id).toBe(false)
      expect(m.modes.contest, m.id).toBe(false)
    }
    if (m.scoreMax !== undefined) expect(Number.isFinite(m.scoreMax) && m.scoreMax > 0, m.id).toBe(true)
    if (m.scoreDecimals !== undefined) expect([0, 1, 2], m.id).toContain(m.scoreDecimals)
  }
})

test('game_modes gold_* matches manifest gold (없으면 0/0/0, 지갑 설계 §7.1)', () => {
  const seeded = seededGameModes()
  for (const { manifest: m } of [...games, ...duels, ...worlds]) {
    expect(seeded.get(m.id)?.gold, m.id).toEqual(m.gold ?? NO_GOLD)
  }
})

test('manifest gold는 자유 플레이 게임에만, dailyCap = FREE_DAILY_CAP (설계 §7.3)', () => {
  for (const { manifest: m } of [...games, ...duels, ...worlds]) {
    if (!m.gold) continue
    expect(m.modes.free, m.id).toBe(true)
    expect(m.gold.dailyCap, m.id).toBe(FREE_DAILY_CAP)
    expect(m.gold.perPoint, m.id).toBeGreaterThan(0)
    expect(Number.isInteger(m.gold.playCap) && m.gold.playCap > 0, m.id).toBe(true)
    // numeric(10,4)에 그대로 들어가는 값
    expect(Math.round(m.gold.perPoint * 10000) / 10000, m.id).toBe(m.gold.perPoint)
  }
})

test('world previewData keys are not record, avatar or free_bonus keys', () => {
  for (const w of worlds) {
    const keys = Object.keys(w.logic.previewData?.(w.logic.init()) ?? {})
    const taken = [...(w.manifest.records ?? []).map((r) => r.key), AVATAR_RECORD_KEY, FREE_BONUS_RECORD_KEY]
    for (const k of keys) expect(taken, `${w.manifest.id}:${k}`).not.toContain(k)
  }
})

test('solo and duel modules have no preview', () => {
  for (const g of [...games, ...duels]) expect(g.manifest.preview).toBeUndefined()
})
