// 내 섬 집 안(C단계, 설계 docs/superpowers/specs/2026-11-26-my-isle-c-design.md §4.3). 순수 모듈.
// 집 단계마다 방 하나가 넓어진다(오른쪽·아래로). 가구는 1칸, 놓인 칸은 못 걷는다.
import type { IsleLayoutId } from './data.ts'
import { defineMap, type MapDef, type TileFacing } from './map.ts'
import { ISLE_CRESCENT } from './maps/isle-crescent.ts'
import { ISLE_TWIN } from './maps/isle-twin.ts'
import type { Mats } from './isleEcon.ts'

/** 단계 1~4 방 바닥 칸 수 [가로, 세로] */
export const HOME_ROOMS: readonly (readonly [number, number])[] = [[6, 4], [8, 5], [10, 6], [12, 7]]
/** 방 하나에 놓을 수 있는 가구 수 */
export const ROOM_MAX = 40

export type FurnId = 'bed' | 'chair' | 'table' | 'shelf' | 'plant' | 'lamp' | 'stove' | 'wardrobe' | 'clock' | 'chest'
export type Furniture = { id: FurnId; name: string; cost: Mats & { gold: number } }
/** 가구 10종(작업대에서 만든다). 골드 합 ≈ REF × 0.9 */
export const FURNITURE: readonly Furniture[] = [
  { id: 'bed', name: '침대', cost: { wood: 12, stone: 0, iron: 2, gold: 3000 } },
  { id: 'chair', name: '의자', cost: { wood: 4, stone: 0, iron: 0, gold: 500 } },
  { id: 'table', name: '탁자', cost: { wood: 8, stone: 0, iron: 0, gold: 1000 } },
  { id: 'shelf', name: '책장', cost: { wood: 10, stone: 0, iron: 0, gold: 1500 } },
  { id: 'plant', name: '화분', cost: { wood: 0, stone: 3, iron: 0, gold: 500 } },
  { id: 'lamp', name: '램프', cost: { wood: 0, stone: 0, iron: 3, gold: 1500 } },
  { id: 'stove', name: '난로', cost: { wood: 0, stone: 10, iron: 5, gold: 5000 } },
  { id: 'wardrobe', name: '옷장', cost: { wood: 14, stone: 0, iron: 0, gold: 2500 } },
  { id: 'clock', name: '시계', cost: { wood: 2, stone: 0, iron: 2, gold: 2000 } },
  { id: 'chest', name: '상자', cost: { wood: 6, stone: 0, iron: 0, gold: 800 } },
]
export const isFurnId = (v: unknown): v is FurnId => typeof v === 'string' && FURNITURE.some((f) => f.id === v)

export type Placed = { id: FurnId; tx: number; ty: number }

/** 방 칸: 바닥은 x 1..fw, y 2..fh+1. 아래 벽 줄의 문(열린 바닥 칸)은 x = 1 + floor(fw/2) */
function room(level: number) {
  const [fw, fh] = HOME_ROOMS[level - 1]
  const door = { tx: 1 + Math.floor(fw / 2), ty: fh + 2 }
  return { fw, fh, w: fw + 2, h: fh + 3, door }
}
const inFloor = (level: number, tx: number, ty: number) => {
  const r = room(level)
  return tx >= 1 && tx <= r.fw && ty >= 2 && ty <= r.fh + 1
}

/** 집 안에 들어와 서는 칸: 문 바로 위, 위를 본다 */
export function homeArrival(level: number): TileFacing {
  const { door } = room(level)
  return { tx: door.tx, ty: door.ty - 1, facing: 'up' }
}

const DOOR_FRONT: Readonly<Record<IsleLayoutId, TileFacing>> = (() => {
  const front = (m: MapDef): TileFacing => ({ tx: m.building!.doorTx, ty: m.building!.ty + m.building!.h, facing: 'down' })
  return { crescent: front(ISLE_CRESCENT), twin: front(ISLE_TWIN) }
})()

/**
 * 놓을 수 있는가(서버·화면 같은 규칙): 방 바닥, 비어 있음, 문 칸·도착 칸 아님, 놓은 뒤에도 남은 빈 바닥이
 * 모두 도착 칸에서 이어진다(가구로 방이 끊기거나 문이 막히지 않게).
 */
export function canPlace(level: number, placed: readonly Placed[], tx: number, ty: number): boolean {
  if (level < 1 || level > HOME_ROOMS.length || !inFloor(level, tx, ty)) return false
  const a = homeArrival(level)
  if (tx === a.tx && ty === a.ty) return false
  const taken = new Set(placed.map((p) => `${p.tx},${p.ty}`))
  if (taken.has(`${tx},${ty}`)) return false
  taken.add(`${tx},${ty}`)
  const r = room(level)
  const empty = r.fw * r.fh - [...taken].filter((k) => { const [x, y] = k.split(',').map(Number); return inFloor(level, x, y) }).length
  const seen = new Set([`${a.tx},${a.ty}`])
  const q = [[a.tx, a.ty]]
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i]
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`
      if (!seen.has(k) && !taken.has(k) && inFloor(level, x + dx, y + dy)) {
        seen.add(k)
        q.push([x + dx, y + dy])
      }
    }
  }
  return seen.size === empty
}

const MAPS = new Map<string, MapDef>()
/** 집 안 맵(섬 모양은 나가는 문 앞 칸에만 쓴다). 0단계면 null. 같은 값이면 같은 객체 */
export function homeMap(layout: IsleLayoutId, level: number, placed: readonly Placed[] = []): MapDef | null {
  if (level < 1 || level > HOME_ROOMS.length) return null
  const ok = placed.filter((p) => inFloor(level, p.tx, p.ty))
  const k = `${layout}:${level}:${ok.map((p) => `${p.id}@${p.tx},${p.ty}`).join(';')}`
  const hit = MAPS.get(k)
  if (hit) return hit
  const r = room(level)
  const taken = new Set(ok.map((p) => `${p.tx},${p.ty}`))
  const rows: string[] = []
  for (let y = 0; y < r.h; y++) {
    let row = ''
    for (let x = 0; x < r.w; x++) {
      const floor = inFloor(level, x, y) || (x === r.door.tx && y === r.door.ty)
      row += floor && !taken.has(`${x},${y}`) ? 'F' : 'Y'
    }
    rows.push(row)
  }
  const map = defineMap('home', rows, {
    indoor: true,
    onWorldMap: false,
    placeable: true,
    exits: [{ at: { tx: r.door.tx, ty: r.door.ty, w: 1, h: 1 }, target: 'isle', entry: DOOR_FRONT[layout] }],
    props: ok.map((p) => ({ tx: p.tx, ty: p.ty, sprite: `furn-${p.id}`, id: p.id })),
  })
  if (MAPS.size > 64) MAPS.clear()
  MAPS.set(k, map)
  return map
}
