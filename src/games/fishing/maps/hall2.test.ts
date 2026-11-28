// 마을회관 2층 전시관 맵·덧그림 좌표.
import { describe, expect, it } from 'vitest'
import { ALL_AREAS_OPEN, interactionAt, isWalkable } from '../map.ts'
import { HALL } from './hall.ts'
import { HALL2, HALL2_ARRIVAL, HALL2_PEDESTALS, HALL2_THEME_FLOOR, HALL2_WINGS } from './hall2.ts'
import { SPECIAL_IDS, THEMES, THEME_LOOK, themeLook } from '../gallery.ts'
import { SPECIES } from '../data.ts'
import { galleryScene, themeParticles } from '../scene.ts'
import { HALL_GALLERY } from '../hallArt.ts'
import { MAPS } from './index.ts'

const walk = (m: typeof HALL, tx: number, ty: number) => isWalkable(m, tx, ty, ALL_AREAS_OPEN)

describe('마을회관 2층(hall2)', () => {
  it('등록부에 있고, 배경 그림이 맵 크기(26×16칸)와 같다', () => {
    expect(MAPS.hall2).toBe(HALL2)
    expect([HALL_GALLERY.w, HALL_GALLERY.h]).toEqual([HALL2.w * 16, HALL2.h * 16])
  })
  it('13종 받침대: 신화 3은 위 단상, 모두 못 걷는 칸이고 앞(아래) 칸에서 위를 보면 전시관 창', () => {
    expect(Object.keys(HALL2_PEDESTALS).sort()).toEqual([...SPECIAL_IDS].sort())
    for (const [id, p] of Object.entries(HALL2_PEDESTALS)) {
      expect(walk(HALL2, p.tx, p.ty), id).toBe(false)
      expect(walk(HALL2, p.tx, p.ty + 1), id).toBe(true)
      expect(HALL2.fixtures.some((f) => f.front.tx === p.tx && f.front.ty === p.ty + 1 && f.front.facing === 'up' && f.act.kind === 'gallery'), id).toBe(true)
    }
    const top = Object.entries(HALL2_PEDESTALS).filter(([, p]) => p.ty === 2).map(([id]) => id)
    expect(top.sort()).toEqual(SPECIES.filter((s) => s.rarity === 'mythic').map((s) => s.id).sort())
  })
  it('계단: 1층 계단 앞 → 2층 도착 칸(걷는 칸), 2층 계단 앞 → 1층 계단 앞(걷는 칸)', () => {
    const up = HALL.fixtures.filter((f) => f.act.kind === 'stairs')
    expect(up.length).toBe(5)
    for (const f of up) expect(f.act).toEqual({ kind: 'stairs', target: 'hall2', entry: HALL2_ARRIVAL })
    expect(walk(HALL2, HALL2_ARRIVAL.tx, HALL2_ARRIVAL.ty)).toBe(true)
    const down = HALL2.fixtures.filter((f) => f.act.kind === 'stairs')
    expect(down.length).toBe(2)
    for (const f of down) {
      const a = f.act as { entry: { tx: number; ty: number } }
      expect(walk(HALL, a.entry.tx, a.entry.ty)).toBe(true)
    }
  })
  it('확장 구역 5개는 걷는 칸이고, 덧그림 입력은 전시한 어종 받침대와 확장 단계 뒤 구역', () => {
    for (const w of HALL2_WINGS) for (let x = w.tx; x < w.tx + w.w; x++) for (let y = w.ty; y < w.ty + w.h; y++) expect(walk(HALL2, x, y)).toBe(true)
    expect(galleryScene({ exhibits: [], expansions: 0, theme: null, projects: [] }).tape).toHaveLength(5)
    const g = galleryScene({ exhibits: ['grouper', 'nope'], expansions: 2, theme: null, projects: [] })
    expect(g.exhibits).toEqual([{ ...HALL2_PEDESTALS.grouper, species: 'grouper' }])
    expect(g.tape).toEqual(HALL2_WINGS.slice(2))
  })
  it('도착 칸 앞에서 왼쪽을 보면 아무것도 없고, 계단 앞에서 오른쪽을 보면 계단', () => {
    expect(interactionAt(HALL2, { x: 21 * 16 + 8, y: 12 * 16 + 8 }, 'right', new Set(['hall', 'hall2']))?.kind).toBe('stairs')
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
    expect(set.has(key(12, 8))).toBe(false)
    expect(set.has(key(23, 12))).toBe(false)
  })
  it('테마 연출 입자는 같은 시각이면 같고, 늘 실내(벽 안) 안에 있다', () => {
    for (const t of THEMES) {
      for (const ms of [0, 1234, 98765, 3_600_000]) {
        const a = themeParticles(t.id, ms)
        expect(a).toEqual(themeParticles(t.id, ms))
        for (const p of a) {
          expect(p.x).toBeGreaterThanOrEqual(8)
          expect(p.x).toBeLessThan(26 * 16 - 8)
          expect(p.y).toBeGreaterThanOrEqual(16)
          expect(p.y).toBeLessThan(15 * 16)
        }
      }
    }
  })
})
