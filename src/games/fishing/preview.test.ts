import { describe, expect, test } from 'vitest'
import { AVATAR_RECORD_KEY } from '../types.ts'
import type { Conditions } from './clock.ts'
import { DEFAULT_AREAS } from './data.ts'
import { TILE } from './map.ts'
import { VILLAGE } from './maps/village.ts'
import { decodeOutfit } from './outfit.ts'
import { isleArrival, placeKey } from './isle.ts'
import { PREVIEW_RAIN_FRAME_MS, onlineSummary, previewScale, previewState, redrawDelayMs } from './preview.ts'

const center = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 })
const SPAWN = { area: 'village', pos: VILLAGE.spawn.pos, facing: VILLAGE.spawn.facing }
const dock = VILLAGE.docks[0].entry
const ISLAND_SPOT = { area: 'island' as const, pos: center(dock.tx, dock.ty), facing: dock.facing }
const areas = (detail: string | null) => ({ key: 'areas', detail })
const cond = (weather: Conditions['weather']): Conditions => ({ gameMinute: 600, gameDay: 1, season: 'spring', weather })

describe('previewState', () => {
  test('저장 위치·기록이 없으면 마을 시작 위치, 기본 지역, 기본 옷차림, 걷지 않음', () => {
    const s = previewState(null, [])
    expect({ area: s.area, pos: s.player.pos, facing: s.player.facing }).toEqual(SPAWN)
    expect(s.player.moving).toBe(false)
    expect(s.player.walkMs).toBe(0)
    expect([...s.opened].sort()).toEqual([...DEFAULT_AREAS].sort())
    expect(s.outfit).toEqual(decodeOutfit(''))
  })

  test('저장 위치가 잠긴 지역(섬)이고 열린 지역 기록에 없으면 마을 시작 위치', () => {
    const s = previewState(ISLAND_SPOT, [areas('village,river,forest')])
    expect({ area: s.area, pos: s.player.pos, facing: s.player.facing }).toEqual(SPAWN)
  })

  test('섬이 열린 지역 기록에 있으면 저장 위치 그대로', () => {
    const s = previewState(ISLAND_SPOT, [areas('village,river,forest,island')])
    expect({ area: s.area, pos: s.player.pos, facing: s.player.facing }).toEqual(ISLAND_SPOT)
    expect(s.opened.has('island')).toBe(true)
  })

  test('열린 지역 기록의 모르는 id·빈 문자열·null은 무시하고 기본 지역은 항상 들어간다', () => {
    for (const detail of ['', 'atlantis,,', null, 'island,toString']) {
      const s = previewState(null, [areas(detail)])
      for (const a of DEFAULT_AREAS) expect(s.opened.has(a), String(detail)).toBe(true)
      expect(s.opened.has('atlantis' as never)).toBe(false)
      expect(s.opened.has('toString' as never)).toBe(false)
    }
  })

  test('옷차림 기록이 깨진 JSON이면 기본 옷차림, 정상이면 그 옷차림', () => {
    expect(previewState(null, [{ key: AVATAR_RECORD_KEY, detail: '{oops' }]).outfit).toEqual(decodeOutfit(''))
    const worn = decodeOutfit(JSON.stringify({ ...decodeOutfit(''), hair: 'bogus' }))
    expect(previewState(null, [{ key: AVATAR_RECORD_KEY, detail: JSON.stringify(worn) }]).outfit).toEqual(worn)
  })
})

describe('previewScale', () => {
  test('한 변 ÷ 160을 내림, 1~4', () => {
    expect(previewScale(159)).toBe(1)
    expect(previewScale(320)).toBe(2)
    expect(previewScale(480)).toBe(3)
    expect(previewScale(2000)).toBe(4)
    expect(previewScale(0)).toBe(1)
  })
})

describe('redrawDelayMs', () => {
  test('비(겨울엔 눈)면 100ms', () => {
    expect(PREVIEW_RAIN_FRAME_MS).toBe(100)
    expect(redrawDelayMs(cond('rain'), 12345)).toBe(100)
  })
  test('맑으면 다음 실제 10초(게임 10분) 경계까지', () => {
    expect(redrawDelayMs(cond('sun'), 12345)).toBe(7655)
    expect(redrawDelayMs(cond('sun'), 20000)).toBe(10000)
  })
})

describe('onlineSummary', () => {
  const p = (handle: string, area: string, act: 'walk' | 'fish' = 'walk') => ({ id: handle, handle, area, act, tx: 1, ty: 1 })
  test('없으면 null', () => {
    expect(onlineSummary([])).toBeNull()
  })
  test('한 명, 낚시 중', () => {
    expect(onlineSummary([p('son', 'forest', 'fish')])).toBe('접속 중 1명 · son 숲에서 낚시 중')
  })
  test('세 명이면 두 명까지 쓰고 외 n명', () => {
    expect(onlineSummary([p('kim', 'river'), p('son', 'forest', 'fish'), p('zed', 'cave')]))
      .toBe('접속 중 3명 · kim 마을 강, son 숲에서 낚시 중 외 1명')
  })
  test('모르는 지역이면 아이디만', () => {
    expect(onlineSummary([p('son', 'atlantis', 'fish')])).toBe('접속 중 1명 · son')
  })
})

describe('내 섬 미리보기(내 섬 설계 §5.5)', () => {
  const arr = isleArrival('crescent')
  const onIsle = { area: 'isle' as const, pos: center(arr.tx, arr.ty), facing: 'up' as const }
  test('기록 isle이 있으면 그 섬에 서 있고, 없거나 모르는 모양이면 마을', () => {
    const s = previewState(onIsle, [{ key: 'isle', detail: 'crescent' }])
    expect([s.area, s.isle, s.player.pos]).toEqual(['isle', 'crescent', onIsle.pos])
    expect(previewState(onIsle, []).area).toBe('village')
    expect(previewState(onIsle, []).isle).toBeNull()
    expect(previewState(onIsle, [{ key: 'isle', detail: 'zzz' }]).area).toBe('village')
  })
  test('기록 isle 값 "모양:치운 구역"(v23)을 읽고, 옛 값(모양만)은 0', () => {
    expect(previewState(onIsle, [{ key: 'isle', detail: 'crescent:3' }])).toMatchObject({ isle: 'crescent', isleCleared: 3 })
    expect(previewState(onIsle, [{ key: 'isle', detail: 'crescent' }])).toMatchObject({ isle: 'crescent', isleCleared: 0 })
    expect(previewState(onIsle, [{ key: 'isle', detail: 'crescent:99' }]).isleCleared).toBe(8)
    expect(previewState(onIsle, [{ key: 'isle', detail: 'crescent:x' }]).isleCleared).toBe(0)
  })
  test('섬에 있는 친구 요약: 아는 주인은 "{아이디}의 섬", 모르면 "누군가의 섬", 내 섬이면 "내 섬"', () => {
    const me = '00000000-0000-0000-0000-0000000000aa'
    const mj = '00000000-0000-0000-0000-0000000000bb'
    const names = { selfId: me, players: [{ id: mj, handle: 'mj' }] }
    const peer = (handle: string, area: string) => ({ id: handle, handle, area, act: 'walk' as const, tx: 1, ty: 1 })
    expect(onlineSummary([peer('kim', placeKey('isle', mj))], names)).toBe('접속 중 1명 · kim mj의 섬')
    expect(onlineSummary([peer('kim', placeKey('isle', '00000000-0000-0000-0000-0000000000cc'))], names)).toBe('접속 중 1명 · kim 누군가의 섬')
    expect(onlineSummary([peer('kim', placeKey('isle', me))], names)).toBe('접속 중 1명 · kim 내 섬')
    expect(onlineSummary([peer('kim', placeKey('isle', mj))])).toBe('접속 중 1명 · kim 누군가의 섬')
  })
})
