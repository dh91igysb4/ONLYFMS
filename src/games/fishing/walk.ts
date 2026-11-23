// 낚시 마을 이동·충돌·카메라. 순수 함수만 (React·DOM 없음).
import { MAP_H, MAP_W, TILE, isWalkable, type Facing, type Vec } from './map.ts'
import { MAX_DT_MS } from './minigame.ts'

export const WALK_SPEED = 72 // px/s (초당 4.5타일)
export const FEET = { w: 10, h: 6 } // pos 중심의 발 사각형

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

/** 발 사각형(pos 중심의 FEET)이 걸을 수 없는 타일(맵 밖 포함)과 겹치는가 */
export function feetBlocked(x: number, y: number): boolean {
  const tx0 = Math.floor((x - FEET.w / 2 + EDGE_EPS) / TILE)
  const tx1 = Math.floor((x + FEET.w / 2 - EDGE_EPS) / TILE)
  const ty0 = Math.floor((y - FEET.h / 2 + EDGE_EPS) / TILE)
  const ty1 = Math.floor((y + FEET.h / 2 - EDGE_EPS) / TILE)
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!isWalkable(tx, ty)) return true
  return false
}

export function stepWalk(p: Player, input: MoveInput, dtMs: number): Player {
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS)
  if (input.x === 0 && input.y === 0) return { pos: { ...p.pos }, facing: p.facing, moving: false, walkMs: 0 }

  const dist = (WALK_SPEED * dt) / 1000
  let x = p.pos.x
  let y = p.pos.y
  const nx = x + input.x * dist
  if (!feetBlocked(nx, y)) x = nx
  const ny = y + input.y * dist
  if (!feetBlocked(x, ny)) y = ny

  const facing: Facing =
    Math.abs(input.x) >= Math.abs(input.y) ? (input.x < 0 ? 'left' : 'right') : input.y < 0 ? 'up' : 'down'
  return { pos: { x, y }, facing, moving: true, walkMs: p.walkMs + dt }
}

function cameraAxis(target: number, view: number, map: number): number {
  if (map < view) return -Math.floor((view - map) / 2)
  const v = Math.round(target - view / 2)
  return Math.min(Math.max(v, 0), map - view)
}

export function cameraFor(target: Vec, view: { w: number; h: number }): Vec {
  return { x: cameraAxis(target.x, view.w, MAP_W * TILE), y: cameraAxis(target.y, view.h, MAP_H * TILE) }
}
