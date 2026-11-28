// 마을회관 2층 전시관 맵·덧그림 좌표.
import { describe, expect, it } from 'vitest'
import { ALL_AREAS_OPEN, exitAt, interactionAt, isWalkable } from '../map.ts'
import { HALL, HALL_ELEVATOR_ENTRY, HALL_STAIRS } from './hall.ts'
import { HALL2, HALL2_DESK, HALL2_PEDESTALS, HALL2_THEME_FLOOR, HALL2_WINGS } from './hall2.ts'
import { SPECIAL_IDS, THEMES, THEME_LOOK, themeLook } from '../gallery.ts'
import { SPECIES } from '../data.ts'
import { galleryScene, themeParticles } from '../scene.ts'
import { HALL_GALLERY } from '../hallArt.ts'
import { MAPS } from './index.ts'

const tileCenter = (tx: number, ty: number) => ({ x: tx * 16 + 8, y: ty * 16 + 8 })
const walk = (m: typeof HALL, tx: number, ty: number) => isWalkable(m, tx, ty, ALL_AREAS_OPEN)

describe('마을회관 2층(hall2)', () => {
  it('등록부에 있고, 1층과 같은 42×18칸이며 배경 그림이 맵 크기와 같다', () => {
    expect(MAPS.hall2).toBe(HALL2)
    expect([HALL2.w, HALL2.h]).toEqual([HALL.w, HALL.h])
    expect([HALL_GALLERY.w, HALL_GALLERY.h]).toEqual([HALL2.w * 16, HALL2.h * 16])
  })
  it('13종 받침대: 신화 3은 위 단상, 모두 못 걷는 칸이고 앞(아래) 칸에서 위를 보면 전시관 창', () => {
    expect(Object.keys(HALL2_PEDESTALS).sort()).toEqual([...SPECIAL_IDS].sort())
    for (const [id, p] of Object.entries(HALL2_PEDESTALS)) {
      expect(walk(HALL2, p.tx, p.ty), id).toBe(false)
      expect(walk(HALL2, p.tx, p.ty + 1), id).toBe(true)
      expect(HALL2.fixtures.some((f) => f.front.tx === p.tx && f.front.ty === p.ty + 1 && f.front.facing === 'up' && f.act.kind === 'gallery'), id).toBe(true)
    }
    const top = Object.entries(HALL2_PEDESTALS).filter(([, p]) => p.ty === 3).map(([id]) => id)
    expect(top.sort()).toEqual(SPECIES.filter((s) => s.rarity === 'mythic').map((s) => s.id).sort())
  })
  it('엘리베이터·계단 구역(x35~41)은 1층과 칸·벽이 같다', () => {
    for (let ty = 0; ty < HALL.h; ty++) expect(HALL2.rows[ty].slice(35), `row ${ty}`).toBe(HALL.rows[ty].slice(35))
    for (const k of HALL.walls) if (Number(k.slice(2).split(',')[0]) >= 35) expect(HALL2.walls.has(k), k).toBe(true)
    for (const ty of [3, 4, 5]) expect(interactionAt(HALL2, tileCenter(37, ty), 'right', ALL_AREAS_OPEN)).toEqual({ kind: 'elevator' })
    expect(walk(HALL2, HALL_ELEVATOR_ENTRY.tx, HALL_ELEVATOR_ENTRY.ty)).toBe(true)
  })
  it('계단: 두 층 모두 같은 입구 칸이 출구이고, 서로의 계단 앞(걷는 칸, 출구 아님)으로 간다', () => {
    const { at, entry } = HALL_STAIRS
    for (let ty = at.ty; ty < at.ty + at.h; ty++) {
      expect(exitAt(HALL, tileCenter(at.tx, ty))).toMatchObject({ target: 'hall2', entry })
      expect(exitAt(HALL2, tileCenter(at.tx, ty))).toMatchObject({ target: 'hall', entry })
    }
    for (const m of [HALL, HALL2]) {
      expect(walk(m, entry.tx, entry.ty)).toBe(true)
      expect(exitAt(m, tileCenter(entry.tx, entry.ty))).toBeNull()
      // 계단 위쪽은 벽: 위 칸에서 아래로 들어가지 못한다
      expect(m.walls.has(`h:${at.tx},${at.ty}`)).toBe(true)
    }
    expect(HALL.fixtures.some((f) => (f.act.kind as string) === 'stairs')).toBe(false)
  })
  it('전시관 창: 데스크 앞에서 위를 본다', () => {
    expect(walk(HALL2, HALL2_DESK.tx, HALL2_DESK.ty)).toBe(false)
    expect(interactionAt(HALL2, tileCenter(HALL2_DESK.tx, HALL2_DESK.ty + 1), 'up', ALL_AREAS_OPEN)).toEqual({ kind: 'gallery' })
  })
  it('확장 구역 5개는 걷는 칸이고, 덧그림 입력은 전시한 어종 받침대와 확장 단계 뒤 구역', () => {
    for (const w of HALL2_WINGS) for (let x = w.tx; x < w.tx + w.w; x++) for (let y = w.ty; y < w.ty + w.h; y++) expect(walk(HALL2, x, y)).toBe(true)
    expect(galleryScene({ exhibits: [], expansions: 0, theme: null, projects: [] }).tape).toHaveLength(5)
    const g = galleryScene({ exhibits: ['grouper', 'nope'], expansions: 2, theme: null, projects: [] })
    expect(g.exhibits).toEqual([{ ...HALL2_PEDESTALS.grouper, species: 'grouper' }])
    expect(g.tape).toEqual(HALL2_WINGS.slice(2))
  })
  it('테마 외형은 배경을 산 적용 테마만, 바닥·조명은 그 테마에서 산 것만', () => {
    expect(themeLook({ theme: null, projects: ['sea-bg'] })).toBeNull()
    expect(themeLook({ theme: 'sea', projects: ['sea-floor', 'sea-light'] })).toBeNull()
    expect(themeLook({ theme: 'sea', projects: ['sea-bg', 'forest-floor'] })).toEqual({ id: 'sea', floor: false, light: false })
    expect(themeLook({ theme: 'forest', projects: ['forest-bg', 'forest-floor', 'forest-light'] })).toEqual({ id: 'forest', floor: true, light: true })
    expect(galleryScene({ exhibits: [], expansions: 0, theme: 'snow', projects: ['snow-bg', 'snow-light'] }).theme).toEqual({ id: 'snow', floor: false, light: true })
    for (const t of THEMES) expect(THEME_LOOK[t.id]).toBeDefined()
  })
  it('테마 바닥 칸은 모두 걷는 칸이고 카펫·확장 구역·계단 앞·받침대를 덮지 않는다', () => {
    expect(HALL2_THEME_FLOOR.length).toBeGreaterThan(100)
    const key = (tx: number, ty: number) => `${tx},${ty}`
    const set = new Set(HALL2_THEME_FLOOR.map((f) => key(f.tx, f.ty)))
    expect(set.size).toBe(HALL2_THEME_FLOOR.length)
    for (const f of HALL2_THEME_FLOOR) expect(walk(HALL2, f.tx, f.ty)).toBe(true)
    for (const w of HALL2_WINGS) for (let x = w.tx; x < w.tx + w.w; x++) for (let y = w.ty; y < w.ty + w.h; y++) expect(set.has(key(x, y))).toBe(false)
    for (const p of Object.values(HALL2_PEDESTALS)) expect(set.has(key(p.tx, p.ty))).toBe(false)
    expect(set.has(key(17, 8))).toBe(false)
    for (const f of HALL2_THEME_FLOOR) expect(f.tx).toBeLessThanOrEqual(34)
    expect(set.has(key(37, 12))).toBe(false)
  })
  it('테마 연출 입자는 같은 시각이면 같고, 늘 실내(벽 안) 안에 있다', () => {
    for (const t of THEMES) {
      for (const ms of [0, 1234, 98765, 3_600_000]) {
        const a = themeParticles(t.id, ms)
        expect(a).toEqual(themeParticles(t.id, ms))
        for (const p of a) {
          expect(p.x).toBeGreaterThanOrEqual(8)
          expect(p.x).toBeLessThan(35 * 16 - 4)
          expect(p.y).toBeGreaterThanOrEqual(16)
          expect(p.y).toBeLessThan(17 * 16)
        }
      }
    }
  })
})
