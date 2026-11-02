// 밸런스 확인용 봇 (설계 §7). 테스트 전용 — 화면·서버 코드가 import하지 않는다.
// 봇은 실제 상태를 읽고 logic.apply로 끝까지 진행해 최종 점수를 돌려준다.
import { rngFromSeed } from '../../shared/rng.ts'
import type { Ctx } from '../types.ts'
import { CELL, FAST_D2, H, LH, LW, R, TOTAL_TICKS, W, ZONE_COUNT } from './constants.ts'
import { generatePuzzle, type Puzzle } from './generate.ts'
import { isTooth, toothCells, ZONE_SHAPES } from './mask.ts'
import { logic, MAX_SAMPLES, type Action, type State } from './logic.ts'

export type BotKind = 'aim' | 'sweep' | 'scribble' | 'still'

const ctx: Ctx = { now: 0, startedAt: 0, deadline: null }
/** 봇 자신의 난수 시드 (퍼즐 시드와 별개, 고정) */
const BOT_SEED = new Uint8Array(16).fill(0xb0)

const BRUSH: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = []
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) out.push([dx, dy])
  return out
})()

const clampX = (x: number) => Math.min(LW - 1, Math.max(0, x))
const clampY = (y: number) => Math.min(LH - 1, Math.max(0, y))
const center = (i: number): [number, number] => [(i % W) * CELL + 5, Math.floor(i / W) * CELL + 5]

/** 구역 치아 칸의 행·열 범위 [r0, r1, c0, c1] (toothCells에서 구한다) */
function toothBounds(zone: number): [number, number, number, number] {
  let r0 = H, r1 = -1, c0 = W, c1 = -1
  for (const i of toothCells(zone)) {
    const r = Math.floor(i / W), c = i % W
    r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c)
  }
  return [r0, r1, c0, c1]
}

/** 낙서 봇의 틱당 x 이동량: 빠름 기준(√FAST_D2)보다 5 이상 빠르게 */
export const SCRIBBLE_DX = Math.ceil(Math.sqrt(FAST_D2)) + 5

/** 펜 위치. 목표를 향해 축마다 ±min(3, |차이|)씩, 이동이 0이면 x로 ±3 짧은 왕복 */
class Pen {
  x: number
  y: number
  private flip = 1
  constructor(x: number, y: number) { this.x = x; this.y = y }
  stepToward(tx: number, ty: number): void {
    const ddx = Math.sign(tx - this.x) * Math.min(3, Math.abs(tx - this.x))
    const ddy = Math.sign(ty - this.y) * Math.min(3, Math.abs(ty - this.y))
    if (ddx === 0 && ddy === 0) {
      let nx = this.x + 3 * this.flip
      if (nx < 0 || nx >= LW) nx = this.x - 3 * this.flip
      this.x = nx
      this.flip = -this.flip
      return
    }
    this.x = clampX(this.x + ddx)
    this.y = clampY(this.y + ddy)
  }
}

class Runner {
  state: State
  constructor(readonly puzzle: Puzzle) { this.state = logic.initState(puzzle, ctx) }
  get ticksLeft(): number { return TOTAL_TICKS - this.state.ticks }
  do(a: Action): void {
    const r = logic.apply(this.puzzle, this.state, a, ctx)
    if ('error' in r) throw new Error(`bot action rejected: ${r.error}`)
    this.state = r.state
  }
  brush(s: number[]): void { this.do({ type: 'b', s }) }
  switchTo(zone: number): void { if (zone !== this.state.zone) this.do({ type: 'z', zone }) }
  score(): number { return logic.score(this.state, ctx) }
}

/** 칫솔 원 29칸의 남은 두께 합이 가장 큰 치아 칸 (같으면 앞 칸) */
function bestTarget(a: readonly number[], zone: number): number {
  let best = -1, bestSum = -1
  for (const i of toothCells(zone)) {
    const cx = i % W, cy = Math.floor(i / W)
    let sum = 0
    for (const [dx, dy] of BRUSH) {
      const c = cx + dx, r = cy + dy
      if (c < 0 || c >= W || r < 0 || r >= H) continue
      sum += a[r * W + c]
    }
    if (sum > bestSum) { bestSum = sum; best = i }
  }
  return best
}

function playAim(run: Runner): void {
  const pen = new Pen(LW / 2, LH / 2)
  let visited = 0
  while (run.ticksLeft > 0) {
    let zone: number
    if (visited < ZONE_COUNT) zone = visited
    else {
      const clean = logic.publicState(run.state).cleanByZone
      zone = 0
      for (let z = 1; z < ZONE_COUNT; z++) if (clean[z] < clean[zone]) zone = z
    }
    const remainingZones = Math.max(1, ZONE_COUNT - visited)
    let alloc = Math.floor(run.ticksLeft / remainingZones)
    visited++
    if (alloc <= 0) continue
    if (run.state.ticks > 0) run.switchTo(zone)
    while (alloc > 0 && run.ticksLeft > 0) {
      const n = Math.min(MAX_SAMPLES, alloc)
      const [tx, ty] = center(bestTarget(run.state.zones[run.state.zone], run.state.zone))
      const s: number[] = []
      for (let k = 0; k < n; k++) {
        pen.stepToward(tx, ty)
        s.push(pen.x, pen.y)
      }
      run.brush(s)
      alloc -= n
    }
  }
}

/** 치아 칸 행 범위를 7칸 간격 줄로 나눈 왕복 경로 (줄 중심 행, 마지막 줄은 범위 안으로) */
function sweepWaypoints(zone: number): [number, number][] {
  const [r0, r1, c0, c1] = toothBounds(zone)
  const lines = Math.ceil((r1 - r0 + 1) / (2 * R + 1))
  const xl = c0 * CELL + 5, xr = c1 * CELL + 5
  const pts: [number, number][] = []
  for (let k = 0; k < lines; k++) {
    const row = Math.min(r0 + R + (2 * R + 1) * k, r1 - R)
    const y = row * CELL + 5
    if (k % 2 === 0) pts.push([xl, y], [xr, y])
    else pts.push([xr, y], [xl, y])
  }
  // 끝까지 간 뒤에는 거꾸로 되돌아온다 (지그재그 반복)
  const back = pts.slice(0, -1).reverse()
  return pts.concat(back.slice(0, -1))
}

const SWEEP_TICKS = 600

function playSweep(run: Runner): void {
  for (let zone = 0; zone < ZONE_COUNT && run.ticksLeft > 0; zone++) {
    if (run.state.ticks > 0) run.switchTo(zone)
    const pts = sweepWaypoints(zone)
    const pen = new Pen(pts[0][0], pts[0][1])
    let w = 1
    let left = zone === ZONE_COUNT - 1 ? run.ticksLeft : SWEEP_TICKS
    while (left > 0 && run.ticksLeft > 0) {
      const n = Math.min(MAX_SAMPLES, left)
      const s: number[] = []
      for (let k = 0; k < n; k++) {
        if (pen.x === pts[w][0] && pen.y === pts[w][1]) w = (w + 1) % pts.length
        pen.stepToward(pts[w][0], pts[w][1])
        s.push(pen.x, pen.y)
      }
      run.brush(s)
      left -= n
    }
  }
}

function playScribble(run: Runner, rng: () => number): void {
  const [r0, r1] = toothBounds(0)
  const x0 = LW / 2 - Math.floor(SCRIBBLE_DX / 2)
  let flip = 0
  while (run.ticksLeft > 0) {
    const row = r0 + Math.floor(rng() * (r1 - r0 + 1))
    const y = row * CELL + 5
    const s: number[] = []
    for (let k = 0; k < MAX_SAMPLES; k++) {
      s.push(x0 + SCRIBBLE_DX * flip, y)
      flip = 1 - flip
    }
    run.brush(s)
  }
}

/** 가만히 봇이 누르는 점: 구역 0 오른쪽 가운데 앞니의 중심 */
export const STILL_POINT: readonly [number, number] = (() => {
  const teeth = ZONE_SHAPES[0].teeth
  const b = teeth[teeth.length / 2]
  const p: [number, number] = [b[1], b[2]]
  if (!isTooth(0, Math.floor(p[1] / CELL) * W + Math.floor(p[0] / CELL))) throw new Error('still point not on a tooth')
  return p
})()

function playStill(run: Runner): void {
  const s: number[] = []
  for (let k = 0; k < MAX_SAMPLES; k++) s.push(STILL_POINT[0], STILL_POINT[1])
  while (run.ticksLeft > 0) run.brush(s)
}

export function playBot(kind: BotKind, seed: Uint8Array): number {
  const run = new Runner(generatePuzzle(rngFromSeed(seed)))
  const rng = rngFromSeed(BOT_SEED)
  if (kind === 'aim') playAim(run)
  else if (kind === 'sweep') playSweep(run)
  else if (kind === 'scribble') playScribble(run, rng)
  else playStill(run)
  if (!logic.isFinished(run.state, ctx)) throw new Error('bot did not finish')
  return run.score()
}
