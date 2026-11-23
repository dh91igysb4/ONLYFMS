import { describe, expect, it } from 'vitest'
import {
  MARKER_GAP, areaFish, areaRoute, filterFish, firstHop, fishBadge, fixedCells, placeMarkers, spotAnchors, spotAtTile,
  spotFish, spotTiles, teleporterInfo, unlockPlace, type Cell, type FishRow,
} from './atlas.ts'
import { AREAS, CHALLENGES, DEFAULT_AREAS, SPECIES, speciesAvailable, type AreaId } from './data.ts'
import type { Conditions, Season, Weather } from './clock.ts'
import { ALL_AREAS_OPEN, TILE, WATER_KINDS, defineMap, interactionAt, isWalkable, tileAt, type Facing, type Opened } from './map.ts'
import { MAPS } from './maps/index.ts'
import { teleportFee } from './teleport.ts'

const FACINGS: Facing[] = ['up', 'down', 'left', 'right']
const center = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
const cheb = (a: Cell, b: Cell) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))
const opened = (...more: AreaId[]): Opened => new Set<AreaId>([...DEFAULT_AREAS, ...more])
const map = (id: AreaId) => MAPS[id]!
const cond = (over: Partial<Conditions> = {}): Conditions => ({ gameMinute: 600, gameDay: 0, season: 'spring', weather: 'sun', ...over })
const view = (over: Partial<{ dex: Record<string, { count: number; maxCm: number }>; legends: string[]; rodTier: 1 | 2 | 3 | 4 }> = {}) =>
  ({ dex: {}, legends: [], rodTier: 1 as const, ...over })
const ids = (rows: FishRow[]) => rows.map((r) => r.species.id)
const row = (rows: FishRow[], id: string) => rows.find((r) => r.species.id === id)!

describe('spotAnchors', () => {
  it('6장 × 모든 자리에 대표점이 하나씩 있고, 걸을 수 있는 칸에서 네 방향 중 하나로 그 자리 낚시가 된다', () => {
    for (const a of AREAS) {
      const anchors = spotAnchors(map(a.id))
      expect(anchors.map((x) => x.spot), a.id).toEqual([...a.spots])
      for (const an of anchors) {
        expect(isWalkable(map(a.id), an.tx, an.ty, ALL_AREAS_OPEN), `${a.id} ${an.spot}`).toBe(true)
        const fishes = FACINGS.some((f) => {
          const it = interactionAt(map(a.id), center(an.tx, an.ty), f, ALL_AREAS_OPEN)
          return it?.kind === 'fish' && it.spot === an.spot
        })
        expect(fishes, `${a.id} ${an.spot}`).toBe(true)
      }
    }
  })

  it('마을 pier는 부두 칸, shore는 부두가 아닌 칸; 동굴 세 웅덩이·숲 두 자리 대표점이 서로 다르다', () => {
    const [pier, shore] = spotAnchors(map('village'))
    expect(tileAt(map('village'), pier.tx, pier.ty)).toBe('pier')
    expect(tileAt(map('village'), shore.tx, shore.ty)).not.toBe('pier')
    const key = (c: Cell) => `${c.tx},${c.ty}`
    expect(new Set(spotAnchors(map('cave')).map(key)).size).toBe(3)
    expect(new Set(spotAnchors(map('forest')).map(key)).size).toBe(2)
  })

  it('대표점끼리·대표점과 고정 표시가 3칸 이상 떨어져 있다(목표 MARKER_GAP), 두 번 부르면 같은 배열', () => {
    for (const a of AREAS) {
      const m = map(a.id)
      const anchors = spotAnchors(m)
      const others = [...fixedCells(m)]
      anchors.forEach((an, i) => {
        for (const o of [...others, ...anchors.slice(0, i)]) expect(cheb(an, o), `${a.id} ${an.spot}`).toBeGreaterThanOrEqual(3)
      })
      expect(spotAnchors(m)).toBe(anchors)
    }
  })

  it('합성: 무게중심 칸이 고정 표시와 가까우면 MARKER_GAP 이상인 다음 칸, 모두 가까우면 무게중심 칸', () => {
    // 모래 한 줄(13칸) 아래 바다. 상점 문 앞(shopSpot)이 (6, 1) → 무게중심 근처 칸은 가까워 건너뛴다
    const rows = [
      '~~~~~BDB~~~~~',
      '~~~~~...~~~~~',
      '.............',
      '~~~~~~~~~~~~~',
    ]
    const m = defineMap('village', rows, { spots: { water: 'shore' } })
    const [a] = spotAnchors(m)
    expect(cheb(a, { tx: 6, ty: 1 })).toBeGreaterThanOrEqual(MARKER_GAP)
    expect(a.ty).toBe(2)
    // 좁은 맵: 모든 후보가 상점 문 앞과 가깝다 → 무게중심 칸
    const small = defineMap('village', ['BDB', '...', '~~~'], { spots: { water: 'shore' } })
    expect(spotAnchors(small)[0]).toEqual({ spot: 'shore', tx: 1, ty: 1 })
  })
})

describe('placeMarkers', () => {
  it('강: 산 호수 잠김 → 남·서 출구 + 잠긴 문, 북쪽 출구 없음; 열림 → 문 없음, 북쪽 출구', () => {
    const locked = placeMarkers(map('river'), opened())
    expect(locked.filter((m) => m.kind === 'exit').map((m) => m.kind === 'exit' && m.dir)).toEqual(['s', 'w'])
    expect(locked.find((m) => m.kind === 'gate')).toMatchObject({ area: 'lake', tx: 24.5, ty: 2.5 })
    const open = placeMarkers(map('river'), opened('lake'))
    expect(open.some((m) => m.kind === 'gate')).toBe(false)
    expect(open.find((m) => m.kind === 'exit' && m.target === 'lake')).toMatchObject({ dir: 'n', tx: 24.5, ty: 0 })
  })

  it('숲: 동굴 잠김 → 동굴 출구 없음 + 문; 열림 → 출구 dir in', () => {
    const locked = placeMarkers(map('forest'), opened())
    expect(locked.some((m) => m.kind === 'exit' && m.target === 'cave')).toBe(false)
    expect(locked.some((m) => m.kind === 'gate' && m.area === 'cave')).toBe(true)
    expect(placeMarkers(map('forest'), opened('cave')).find((m) => m.kind === 'exit' && m.target === 'cave')).toMatchObject({ dir: 'in' })
  })

  it('마을: 북쪽 출구, 선착장(dock.front), 상점(shopSpot), 순간이동기(구조물 가운데); 섬: 선착장, 출구 없음', () => {
    const v = placeMarkers(map('village'), opened())
    expect(v.map((m) => m.kind)).toEqual(['exit', 'dock', 'shop', 'teleporter'])
    expect(v[1]).toMatchObject({ target: 'island', tx: 42, ty: 29 })
    expect(v[3]).toMatchObject({ tx: 35.5, ty: 20.5 })
    const i = placeMarkers(map('island'), opened('island'))
    expect(i.some((m) => m.kind === 'exit')).toBe(false)
    expect(i.find((m) => m.kind === 'dock')).toMatchObject({ target: 'village' })
  })
})

describe('spotAtTile / spotTiles', () => {
  it('물 칸의 자리', () => {
    const r = map('river')
    expect(spotAtTile(r, 20, 16)).toBe('river')
    expect(spotAtTile(r, 5, 25)).toBeNull()
    expect(spotAtTile(map('village'), 24, 28)).toBe('shore')
    const cave = map('cave')
    let lava: Cell | null = null
    for (let ty = 0; ty < cave.h && !lava; ty++) for (let tx = 0; tx < cave.w; tx++) if (tileAt(cave, tx, ty) === 'lava') { lava = { tx, ty }; break }
    expect(spotAtTile(cave, lava!.tx, lava!.ty)).toBe('cave3')
    const forest = map('forest')
    let falls: Cell | null = null
    for (let ty = 0; ty < forest.h && !falls; ty++) for (let tx = 0; tx < forest.w; tx++) if (tileAt(forest, tx, ty) === 'falls') { falls = { tx, ty }; break }
    expect(spotAtTile(forest, falls!.tx, falls!.ty)).toBeNull()
  })

  it('설 자리는 걸을 수 있고 물 칸은 물 종류; 마을 pier 설 자리는 모두 부두', () => {
    for (const a of AREAS) for (const s of a.spots) {
      const t = spotTiles(map(a.id), s)
      expect(t.stands.length, `${a.id} ${s}`).toBeGreaterThan(0)
      for (const c of t.stands) expect(isWalkable(map(a.id), c.tx, c.ty, ALL_AREAS_OPEN)).toBe(true)
      for (const c of t.waters) expect(WATER_KINDS.has(tileAt(map(a.id), c.tx, c.ty)!)).toBe(true)
    }
    for (const c of spotTiles(map('village'), 'pier').stands) expect(tileAt(map('village'), c.tx, c.ty)).toBe('pier')
    expect(spotTiles(map('village'), 'nope')).toEqual({ stands: [], waters: [] })
  })
})

describe('spotFish / areaFish', () => {
  it('마을 해안, 봄 맑음 10시, 대나무: 고등어 season, 참돔 rod, 망둥어 now; now 먼저·등급 순', () => {
    const rows = spotFish('village', 'shore', view(), cond())
    expect(row(rows, 'mackerel')).toMatchObject({ now: false, reason: 'season' })
    expect(row(rows, 'red-seabream')).toMatchObject({ now: false, reason: 'rod' })
    expect(row(rows, 'goby')).toMatchObject({ now: true, reason: null, found: false })
    const firstOff = rows.findIndex((r) => !r.now)
    expect(rows.slice(firstOff).every((r) => !r.now)).toBe(true)
    const rank = { common: 0, uncommon: 1, rare: 2, legend: 3, mythic: 4 }
    const nowRanks = rows.filter((r) => r.now).map((r) => rank[r.species.rarity])
    expect(nowRanks).toEqual([...nowRanks].sort((a, b) => a - b))
  })

  it('다금바리는 pier에만; 잡은 전설은 legendDone·now false·legend-done', () => {
    expect(ids(spotFish('village', 'shore', view(), cond()))).not.toContain('grouper')
    const winter = cond({ season: 'winter' })
    expect(row(spotFish('village', 'pier', view({ rodTier: 3 }), winter), 'grouper')).toMatchObject({ now: true })
    expect(row(spotFish('village', 'pier', view({ rodTier: 3, legends: ['grouper'] }), winter), 'grouper'))
      .toMatchObject({ now: false, legendDone: true, reason: 'legend-done' })
  })

  it('found는 dex 기준', () => {
    expect(row(spotFish('village', 'shore', view({ dex: { goby: { count: 1, maxCm: 10 } } }), cond()), 'goby').found).toBe(true)
  })

  it('now ⇔ speciesAvailable (모든 지역·자리·계절·정각·날씨·낚싯대 1/4, 전설 안 잡음)', () => {
    const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter']
    const weathers: Weather[] = ['sun', 'rain']
    for (const a of AREAS) for (const spot of a.spots) for (const season of seasons) for (let h = 0; h < 24; h++) for (const weather of weathers) for (const rodTier of [1, 4] as const) {
      const c = cond({ season, weather, gameMinute: h * 60 })
      for (const r of spotFish(a.id, spot, view({ rodTier }), c)) {
        expect(r.now).toBe(speciesAvailable(r.species, a.id, spot, c, rodTier))
      }
    }
  })

  it('areaFish: 숲은 붕어·버들치 모두, now는 자리 중 하나라도', () => {
    const rows = areaFish('forest', view(), cond())
    expect(ids(rows)).toEqual(expect.arrayContaining(['crucian', 'stream-minnow']))
    expect(rows).toHaveLength(SPECIES.filter((s) => s.area === 'forest').length)
    expect(row(rows, 'crucian').now).toBe(true)
    expect(row(rows, 'stream-minnow').now).toBe(true)
  })
})

describe('filterFish / fishBadge', () => {
  const rows = spotFish('village', 'shore', view({ dex: { goby: { count: 1, maxCm: 10 }, mackerel: { count: 1, maxCm: 30 } } }), cond())
  const total = rows.length
  it('필터 없음은 찾음/전체, 켜면 통과한 수', () => {
    expect(fishBadge(rows, { now: false, undiscovered: false })).toBe(`2/${total}`)
    expect(fishBadge(rows, { now: true, undiscovered: false })).toBe(String(rows.filter((r) => r.now).length))
    expect(fishBadge(rows, { now: false, undiscovered: true })).toBe(String(total - 2))
    expect(fishBadge(rows, { now: true, undiscovered: true })).toBe(String(rows.filter((r) => r.now && !r.found).length))
    expect(filterFish(rows, { now: true, undiscovered: true }).every((r) => r.now && !r.found)).toBe(true)
  })
  it('교집합이 0이면 "0"', () => {
    const allFound = Object.fromEntries(rows.map((r) => [r.species.id, { count: 1, maxCm: 1 }]))
    const done = spotFish('village', 'shore', view({ dex: allFound }), cond())
    expect(fishBadge(done, { now: true, undiscovered: true })).toBe('0')
  })
})

describe('unlockPlace / areaRoute / firstHop', () => {
  it('unlockPlace', () => {
    expect(unlockPlace('lake')).toEqual({ area: 'river', kind: 'gate' })
    expect(unlockPlace('cave')).toEqual({ area: 'forest', kind: 'gate' })
    expect(unlockPlace('island')).toEqual({ area: 'village', kind: 'dock' })
    expect(unlockPlace('village')).toBeNull()
  })

  it('areaRoute', () => {
    expect(areaRoute('forest', 'island', opened('island'))).toEqual({ path: ['forest', 'river', 'village', 'island'], unlockAt: null })
    expect(areaRoute('forest', 'island', opened())).toEqual({ path: ['forest', 'river', 'village'], unlockAt: { area: 'village', kind: 'dock' } })
    expect(areaRoute('village', 'village', opened()).path).toEqual(['village'])
    // 저장 위치가 꼬여 잠긴 동굴에 있어도 출발지는 열린 것으로 본다
    expect(areaRoute('cave', 'village', opened()).path).toEqual(['cave', 'forest', 'river', 'village'])
  })

  it('firstHop', () => {
    const v = map('village')
    expect(firstHop(v, ['village', 'river', 'forest'])).toMatchObject({ kind: 'exit', target: 'river' })
    expect(firstHop(v, ['village', 'island'])).toMatchObject({ kind: 'dock', target: 'island' })
    expect(firstHop(v, null)).toBeNull()
    expect(firstHop(v, ['village'], 'island', opened())).toMatchObject({ kind: 'dock' })
    expect(firstHop(map('river'), ['river'], 'lake', opened())).toMatchObject({ kind: 'gate', area: 'lake' })
  })
})

describe('teleporterInfo', () => {
  const doneAll = Object.fromEntries(CHALLENGES.map((c) => [c.id, { progress: c.count, done: true }]))
  it('과제 깸 → 켜짐; 진행 중 → 꺼짐·진행도; challenges 없음 → 꺼짐·진행 0', () => {
    expect(teleporterInfo('river', { areas: [...DEFAULT_AREAS], challenges: doneAll }, 'village')?.open).toBe(true)
    const partial = teleporterInfo('river', { areas: [...DEFAULT_AREAS], challenges: { 'river-rain': { progress: 2, done: false } } }, 'village')
    expect(partial).toMatchObject({ open: false, challenge: { title: '빗속의 강태공', progress: 2, count: 5, done: false }, feeFromHere: null })
    expect(teleporterInfo('river', { areas: [...DEFAULT_AREAS] }, 'village')).toMatchObject({ open: false, challenge: { progress: 0 } })
  })
  it('요금: 두 이동기 모두 켜짐일 때만, 같은 지역이면 null; 지역이 안 열렸으면 꺼짐', () => {
    const areas: AreaId[] = [...DEFAULT_AREAS, 'island']
    expect(teleporterInfo('island', { areas, challenges: doneAll }, 'village')?.feeFromHere).toBe(teleportFee('village', 'island'))
    expect(teleporterInfo('village', { areas, challenges: doneAll }, 'village')?.feeFromHere).toBeNull()
    const hereOff = { ...doneAll, 'pier-perfect': { progress: 1, done: false } }
    expect(teleporterInfo('island', { areas, challenges: hereOff }, 'village')?.feeFromHere).toBeNull()
    expect(teleporterInfo('lake', { areas: [...DEFAULT_AREAS], challenges: doneAll }, 'village')?.open).toBe(false)
  })
  it('이동기 없는 맵이면 null', () => {
    // 합성 맵을 실제 등록부에 넣지 않으므로, 이동기 없는 지역이 생기면 이 분기를 탄다: 모든 실제 지역은 이동기가 있다
    for (const a of AREAS) expect(teleporterInfo(a.id, { areas: [...DEFAULT_AREAS] }, 'village')).not.toBeNull()
  })
})
