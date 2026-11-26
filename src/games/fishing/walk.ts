// 낚시 마을 이동·충돌·카메라. 순수 함수만 (React·DOM 없음).
import { STATIC_DYNAMIC, TILE, edgeHits, isWalkable, type Facing, type MapDef, type MapDynamic, type Opened, type Vec } from './map.ts'
import { SHORE_BLOCK, buildingSolid, footprintAt, isBuildingTile, shoreField, wetness, type ShoreField } from './shore.ts'
import { MAX_DT_MS } from './minigame.ts'

export const WALK_SPEED = 72 // px/s (초당 4.5타일)
export const FEET = { w: 10, h: 6 } // pos 중심의 발 사각형
/** 한 걸음(쪼갠 이동) 최대 거리. 발 높이(6)보다 작아야 얇은 벽을 건너뛰지 않는다. 기본 속도·최대 dt(3.6px)는 쪼개지지 않는다 */
const MAX_SUBSTEP_PX = 4

export type Player = { pos: Vec; facing: Facing; moving: boolean; walkMs: number }
export type MoveInput = { x: number; y: number } // 길이 ≤ 1

const DEAD_ZONE = 0.15
// 사각형 변이 타일 경계에 정확히 닿으면 안쪽 타일만 닿은 것으로 센다.
const EDGE_EPS = 1e-6

export function joystickVector(dx: number, dy: number, radius: number): MoveInput {
  if (radius <= 0) return { x: 0, y: 0 }
  const len = Math.hypot(dx, dy)
  const scale = len > radius ? radius / len : 1
  const x = (dx * scale) / radius
  const y = (dy * scale) / radius
  if (Math.hypot(x, y) < DEAD_ZONE) return { x: 0, y: 0 }
  return { x, y }
}

export function keysVector(k: { up: boolean; down: boolean; left: boolean; right: boolean }): MoveInput {
  const x = (k.right ? 1 : 0) - (k.left ? 1 : 0)
  const y = (k.down ? 1 : 0) - (k.up ? 1 : 0)
  if (x !== 0 && y !== 0) return { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 }
  return { x, y }
}

const inMap = (map: MapDef, tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < map.w && ty < map.h
const inRect = (r: { tx: number; ty: number; w: number; h: number }, tx: number, ty: number): boolean =>
  tx >= r.tx && tx < r.tx + r.w && ty >= r.ty && ty < r.ty + r.h

/** 칸 단위로 막히는가(물가 판정 전): 맵 밖, 잠긴 문·순간이동기, 물이 아닌데 못 걷는 칸(물체 칸은 발밑으로 따로 본다) */
function tileBlocks(map: MapDef, f: ShoreField, tx: number, ty: number, opened: Opened, dyn: MapDynamic): boolean {
  if (!inMap(map, tx, ty)) return true
  if (map.gates.some((g) => !opened.has(g.area) && inRect(g.tiles, tx, ty))) return true
  if (map.teleporter && inRect(map.teleporter.tiles, tx, ty)) return true
  if (isWalkable(map, tx, ty, opened, dyn)) return false
  // 건물 칸은 그림 픽셀로 따로 본다(텐트처럼 칸을 다 채우지 않는 그림)
  if (isBuildingTile(f, tx, ty)) return false
  const cls = f.cls[ty * map.w + tx]
  if (cls === 'water') return false
  return !(cls === 'land' && footprintAt(f, tx, ty))
}

/** 물가 판정을 받는 칸(매끄럽게 하는 물·땅)에 든 점이면 물 정도로 본다 */
function shoreBlocks(f: ShoreField, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE)
  const ty = Math.floor(y / TILE)
  if (!inMap(f.map, tx, ty)) return false
  const cls = f.cls[ty * f.map.w + tx]
  return (cls === 'water' || cls === 'land') && wetness(f, x, y) >= SHORE_BLOCK
}

/** 발 사각형이 건물 칸 (tx, ty) 안에서 건물 그림의 막는 픽셀과 겹치는가 */
function buildingHits(f: ShoreField, tx: number, ty: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const px0 = Math.max(tx * TILE, Math.floor(x0 + EDGE_EPS))
  const px1 = Math.min((tx + 1) * TILE, Math.ceil(x1 - EDGE_EPS))
  const py0 = Math.max(ty * TILE, Math.floor(y0 + EDGE_EPS))
  const py1 = Math.min((ty + 1) * TILE, Math.ceil(y1 - EDGE_EPS))
  for (let py = py0; py < py1; py++) for (let px = px0; px < px1; px++) if (buildingSolid(f, px, py)) return true
  return false
}

/** 한 점이 막혔는가(칸 판정 + 발밑 + 물가선). 시험·그림 비교용 */
export function pointBlocked(map: MapDef, x: number, y: number, opened: Opened, dyn: MapDynamic = STATIC_DYNAMIC): boolean {
  const f = shoreField(map, dyn.tide)
  const tx = Math.floor(x / TILE)
  const ty = Math.floor(y / TILE)
  if (tileBlocks(map, f, tx, ty, opened, dyn)) return true
  if (isBuildingTile(f, tx, ty)) return buildingSolid(f, x, y)
  const fp = f.cls[ty * map.w + tx] !== 'fixed' ? footprintAt(f, tx, ty) : null
  if (fp) {
    const lx = x - tx * TILE
    const ly = y - ty * TILE
    if (lx >= fp.tx && lx < fp.tx + fp.w && ly >= fp.ty && ly < fp.ty + fp.h) return true
  }
  return shoreBlocks(f, x, y)
}

/**
 * 발 사각형(pos 중심의 FEET)이 막혔는가.
 * 1) 걸친 칸(꼭짓점이 든 칸)마다 칸 판정(맵 밖·잠긴 문·순간이동기·못 걷는 칸), 물체 칸은 발밑 사각형과 겹치는지.
 * 2) 9점(꼭짓점·변 가운데·중심) 가운데 매끄럽게 하는 물·땅 칸에 든 점은 물 정도가 SHORE_BLOCK 이상이면 막힘 — 그린 물가선과 같은 선.
 * 3) 칸 사이 벽 모서리.
 */
export function feetBlocked(map: MapDef, x: number, y: number, opened: Opened, dyn: MapDynamic = STATIC_DYNAMIC): boolean {
  const f = shoreField(map, dyn.tide)
  const x0 = x - FEET.w / 2
  const x1 = x + FEET.w / 2
  const y0 = y - FEET.h / 2
  const y1 = y + FEET.h / 2
  const tx0 = Math.floor((x0 + EDGE_EPS) / TILE)
  const tx1 = Math.floor((x1 - EDGE_EPS) / TILE)
  const ty0 = Math.floor((y0 + EDGE_EPS) / TILE)
  const ty1 = Math.floor((y1 - EDGE_EPS) / TILE)
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tileBlocks(map, f, tx, ty, opened, dyn)) return true
      if (isBuildingTile(f, tx, ty) && buildingHits(f, tx, ty, x0, y0, x1, y1)) return true
      const fp = f.cls[ty * map.w + tx] !== 'fixed' ? footprintAt(f, tx, ty) : null
      if (fp) {
        const fx0 = tx * TILE + fp.tx
        const fy0 = ty * TILE + fp.ty
        // 딱 맞닿기만 해도 막는다(발 높이 6px와 같은 틈으로 미끄러져 지나가지 않게)
        if (x0 < fx0 + fp.w + EDGE_EPS && x1 > fx0 - EDGE_EPS && y0 < fy0 + fp.h + EDGE_EPS && y1 > fy0 - EDGE_EPS) return true
      }
    }
  }
  for (const py of [y0 + EDGE_EPS, y, y1 - EDGE_EPS]) for (const px of [x0 + EDGE_EPS, x, x1 - EDGE_EPS]) if (shoreBlocks(f, px, py)) return true
  return edgeHits(map, x0, y0, x1, y1)
}

/** speed: 신발 배율(shoeSpeed, 기본 1) */
export function stepWalk(map: MapDef, p: Player, input: MoveInput, dtMs: number, opened: Opened, dyn: MapDynamic = STATIC_DYNAMIC, speed = 1): Player {
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS)
  if (input.x === 0 && input.y === 0) return { pos: { ...p.pos }, facing: p.facing, moving: false, walkMs: 0 }

  const dist = (WALK_SPEED * speed * dt) / 1000
  // 한 번에 MAX_SUBSTEP_PX보다 멀리 가면 쪼갠다: 얇은 유리벽(칸 사이 모서리)을 발 높이(6px)보다 큰 걸음으로 건너뛰지 않게(빠른 신발)
  const n = Math.max(1, Math.ceil(dist / MAX_SUBSTEP_PX))
  const d = dist / n
  let x = p.pos.x
  let y = p.pos.y
  for (let i = 0; i < n; i++) {
    const nx = x + input.x * d
    if (!feetBlocked(map, nx, y, opened, dyn)) x = nx
    const ny = y + input.y * d
    if (!feetBlocked(map, x, ny, opened, dyn)) y = ny
  }

  const facing: Facing =
    Math.abs(input.x) >= Math.abs(input.y) ? (input.x < 0 ? 'left' : 'right') : input.y < 0 ? 'up' : 'down'
  return { pos: { x, y }, facing, moving: true, walkMs: p.walkMs + dt }
}

function cameraAxis(target: number, view: number, map: number): number {
  if (map < view) return -Math.floor((view - map) / 2)
  const v = Math.round(target - view / 2)
  return Math.min(Math.max(v, 0), map - view)
}

export function cameraFor(map: MapDef, target: Vec, view: { w: number; h: number }): Vec {
  return { x: cameraAxis(target.x, view.w, map.w * TILE), y: cameraAxis(target.y, view.h, map.h * TILE) }
}
