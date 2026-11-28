// 넘어지는 블록. 설계 §7. 정수만.
// 블록은 꼭짓점 4개(질량 BLOCK_MASS, 바퀴 하나 = 1)와 막대 6개(변 4 + 대각선 2)로 묶은 상자다. 차와 같은 이동 단계로 움직인다.
// 보정은 위치 기반(PBD)이다: 이동 단계에서 꼭짓점이 예측 위치에서 옮겨진 양 × SUBSTEPS를 그 꼭짓점 속도(u/틱)에 더한다.
// 그래서 밀린 만큼 속도를 얻고, 땅에 막힌 만큼 속도를 잃는다.
import type { CarDef } from './cars.ts'
import { BLOCK_CORNER_R, BLOCK_FRICTION_PCT, BLOCK_MASS, BLOCK_WAKE, G, GROUND_TOL, SUBSTEPS, V_TERMINAL, WHEEL_R } from './constants.ts'
import { candOf, candVel, chassisOf, collideWheel, divRound, divTrunc, type Body, type Box, type Cand } from './collide.ts'
import type { Course } from './course.ts'
import type { Seg } from './pieces.ts'
import { TRIG_ONE, cosT, isqrt, sinT } from './trig.ts'

/** 너비 w·높이 h(u)의 상자. (x, y) = 바닥 변 가운데, a = 처음 각도(TURN, (x, y) 둘레). */
export type BlockDef = { x: number; y: number; w: number; h: number; a: number }
export type Block = BlockDef & { id: number; endX: number } // 월드 좌표. endX = 자기 구간 끝 x(가운데가 넘으면 끝난다, 설계 §7.3)
/** 16 정수: 꼭짓점 4개 × (x, y, px, py). 반시계 순서, 0번 = 처음 자세의 왼쪽 아래. (px, py)는 Verlet의 직전 틱 위치. */
export type BlockState = { id: number; p: number[] }

// 막대: 변 4(i → i+1) + 대각선 2.
const RODS: readonly (readonly [number, number])[] = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]]
// 블록 변 후보 번호: BLOCK_CAND − id × 4 − 변 번호. 움직이는 길 번호(−1 − id × 1000 − j)보다 훨씬 작다.
const BLOCK_CAND = -1099511627776 // −2^40
// 밀어내기 비율의 분모(접점 위치를 이 단위로 나눈다).
const D = 256

/** 처음 자세의 꼭짓점(course.ts blockRestBox와 같은 계산). */
function restCorners(b: BlockDef): [number, number][] {
  const c = cosT(b.a)
  const s = sinT(b.a)
  const left = -Math.floor(b.w / 2)
  const right = b.w + left
  return [[left, 0], [right, 0], [right, b.h], [left, b.h]].map(([rx, ry]) => [
    b.x + Math.floor((c * rx - s * ry) / TRIG_ONE),
    b.y + Math.floor((s * rx + c * ry) / TRIG_ONE),
  ])
}

export function wakeBlock(b: BlockDef & { id: number }): BlockState {
  return { id: b.id, p: restCorners(b).flatMap(([x, y]) => [x, y, x, y]) }
}

/** 깨어 있는 블록: awake + 차 중심 (cx, cy)에서 처음 위치(바닥 변 가운데)까지 BLOCK_WAKE 안인 새 블록(done 제외). id 오름차순(설계 §7.3). */
export function wakeNear(awake: BlockState[], done: readonly number[], course: Course, cx: number, cy: number): BlockState[] {
  const fresh = course
    .blocksNear({ x0: cx - BLOCK_WAKE, y0: cy - BLOCK_WAKE, x1: cx + BLOCK_WAKE, y1: cy + BLOCK_WAKE })
    .filter((b) => (b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy) <= BLOCK_WAKE * BLOCK_WAKE)
    .filter((b) => !done.includes(b.id) && !awake.some((e) => e.id === b.id))
  if (fresh.length === 0) return awake
  return awake.concat(fresh.map(wakeBlock)).sort((a, b) => a.id - b.id)
}

export function blockBox(bs: BlockState): Box {
  const p = bs.p
  return {
    x0: Math.min(p[0], p[4], p[8], p[12]),
    y0: Math.min(p[1], p[5], p[9], p[13]),
    x1: Math.max(p[0], p[4], p[8], p[12]),
    y1: Math.max(p[1], p[5], p[9], p[13]),
  }
}

// 틱 속도 v로 움직인 마지막 이동 단계의 이동량(이동 단계 분할과 같은 내림).
function lastStep(v: number): number {
  return v - Math.floor((v * (SUBSTEPS - 1)) / SUBSTEPS)
}

// 꼭짓점 좌표(now·prev, 각 [x0, y0, …, x3, y3])로 네 변. 구동 접선이 앞을 향하도록 now 기준 왼쪽 → 오른쪽으로 놓고, prev도 같은 순서로.
function edges(now: readonly number[], prev: readonly number[]): { now: Seg[]; prev: Seg[] } {
  const a: Seg[] = []
  const b: Seg[] = []
  for (let e = 0; e < 4; e++) {
    let i = e
    let j = (e + 1) % 4
    if (now[2 * i] > now[2 * j]) [i, j] = [j, i]
    a.push({ x0: now[2 * i], y0: now[2 * i + 1], x1: now[2 * j], y1: now[2 * j + 1], boost: false })
    b.push({ x0: prev[2 * i], y0: prev[2 * i + 1], x1: prev[2 * j], y1: prev[2 * j + 1], boost: false })
  }
  return { now: a, prev: b }
}

/** 네 변(바퀴 충돌용). prev = 직전 이동 단계 자세(틱 속도의 마지막 이동 단계만큼 뒤). */
export function blockSegs(bs: BlockState): { now: Seg[]; prev: Seg[] } {
  const now: number[] = []
  const prev: number[] = []
  for (let i = 0; i < 4; i++) {
    const x = bs.p[4 * i]
    const y = bs.p[4 * i + 1]
    now.push(x, y)
    prev.push(x - lastStep(x - bs.p[4 * i + 2]), y - lastStep(y - bs.p[4 * i + 3]))
  }
  return edges(now, prev)
}

/** 블록 변 후보 번호인지(움직이는 길·고정 선분과 구별). */
export function isBlockCand(i: number): boolean {
  return i <= BLOCK_CAND
}

/** 블록마다 네 변의 후보(ids[k]가 segs[k]의 블록 id). 바퀴는 움직이는 길과 같은 상대 속도 방식으로 부딪힌다(설계 §7.2). */
export function blockCands(ids: readonly number[], segs: readonly { now: Seg[]; prev: Seg[] }[]): Cand[] {
  const out: Cand[] = []
  for (let k = 0; k < segs.length; k++) {
    for (let e = 0; e < 4; e++) {
      const c = candOf(BLOCK_CAND - ids[k] * 4 - e, segs[k].now[e], segs[k].prev[e])
      if (c) out.push(c)
    }
  }
  return out
}

/** 한 틱 동안의 작업용 블록. */
export type BlockWork = {
  id: number
  c: Body[] // 꼭짓점 4개(속도 u/틱)
  v0: number[] // 틱 시작 속도(중력 전, 8): 실려 감 기록의 앞 자세를 어림한다
  L: number[] // 막대 6개 길이(처음 자세에서 잰 값)
  fixed: Cand[] // 이 블록 근처의 고정 선분(틱마다 한 번)
  terrain: readonly Cand[] // 이번 이동 단계의 고정 선분 + 움직이는 길 선분
  s: number[] // 이동 단계 시작 위치(8)
  o: { x: number; y: number }[] // 이동 단계 시작의 둥근 모서리 원 중심(4, 어느 쪽에서 왔는지 정한다)
  q: number[] // 이동 뒤 예측 위치(8)
  push: number[] // 이번 이동 단계에 지형이 꼭짓점을 민 양(8)
  surf: (Cand | null)[] // 꼭짓점이 닿은 움직이는 길 선분(마찰을 그 길에 대한 상대 이동으로 잰다)
}

/** 상태 → 작업용. 중력과 속도 상한(차와 같다)을 여기서 건다. */
export function blockWork(bs: BlockState, def: BlockDef, fixed: Cand[]): BlockWork {
  const rest = restCorners(def)
  const L = RODS.map(([i, j]) => {
    const dx = rest[j][0] - rest[i][0]
    const dy = rest[j][1] - rest[i][1]
    return isqrt(dx * dx + dy * dy)
  })
  const c: Body[] = []
  const v0: number[] = []
  for (let i = 0; i < 4; i++) {
    const x = bs.p[4 * i]
    const y = bs.p[4 * i + 1]
    const b = { x, y, vx: x - bs.p[4 * i + 2], vy: y - bs.p[4 * i + 3] }
    v0.push(b.vx, b.vy)
    b.vy -= G
    const v2 = b.vx * b.vx + b.vy * b.vy
    if (v2 > V_TERMINAL * V_TERMINAL) {
      const v = isqrt(v2)
      b.vx = divTrunc(b.vx * V_TERMINAL, v)
      b.vy = divTrunc(b.vy * V_TERMINAL, v)
    }
    c.push(b)
  }
  return { id: bs.id, c, v0, L, fixed, terrain: fixed, s: [], o: [], q: [], push: [], surf: [] }
}

export function blockState(bw: BlockWork): BlockState {
  return { id: bw.id, p: bw.c.flatMap((b) => [b.x, b.y, b.x - b.vx, b.y - b.vy]) }
}

function xy(bw: BlockWork): number[] {
  const c = bw.c
  return [c[0].x, c[0].y, c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y]
}

/** 블록마다 지금 자세의 네 변(반시계, 변 i = 꼭짓점 i → i+1). 실려 감(carryOn)에 쓴다. */
export function blockPoses(bws: readonly BlockWork[]): Seg[][] {
  return bws.map((bw) => rawEdges(xy(bw)))
}

/** 틱 시작에서 j 이동 단계 전의 자세(틱 시작 속도로 거꾸로 어림). 실려 감의 첫 기록에 쓴다. */
export function blockPosesBack(bws: readonly BlockWork[], j: number): Seg[][] {
  return bws.map((bw) => rawEdges(bw.c.flatMap((b, i) => [b.x - back(bw.v0[2 * i], j), b.y - back(bw.v0[2 * i + 1], j)])))
}

function back(v: number, j: number): number {
  return v - Math.floor((v * (SUBSTEPS - j)) / SUBSTEPS)
}

function rawEdges(p: readonly number[]): Seg[] {
  const out: Seg[] = []
  for (let e = 0; e < 4; e++) {
    const j = (e + 1) % 4
    out.push({ x0: p[2 * e], y0: p[2 * e + 1], x1: p[2 * j], y1: p[2 * j + 1], boost: false })
  }
  return out
}

/** 이동 단계 k: 틱 속도를 차와 같이 나눠 움직이고, 이번 단계의 지형 후보(고정 + 움직이는 길)를 정한다. */
export function moveBlocks(bws: readonly BlockWork[], k: number, movers: readonly Cand[]): void {
  for (const bw of bws) {
    bw.s = xy(bw)
    bw.o = [0, 1, 2, 3].map((i) => cornerCentre(bw.s, bw.L, i))
    for (const b of bw.c) {
      b.x += Math.floor((b.vx * (k + 1)) / SUBSTEPS) - Math.floor((b.vx * k) / SUBSTEPS)
      b.y += Math.floor((b.vy * (k + 1)) / SUBSTEPS) - Math.floor((b.vy * k) / SUBSTEPS)
    }
    bw.q = xy(bw)
    bw.push = [0, 0, 0, 0, 0, 0, 0, 0]
    bw.surf = [null, null, null, null]
    bw.terrain = movers.length > 0 ? bw.fixed.concat(movers) : bw.fixed
  }
}

/** 한 틱에 블록이 닿을 수 있는 범위(지형·움직이는 길 후보를 고를 상자): 꼭짓점 상자 + 여유. */
export function blockReachBox(bs: BlockState): Box {
  const b = blockBox(bs)
  const m = V_TERMINAL + BLOCK_CORNER_R + GROUND_TOL + WHEEL_R
  return { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m }
}

// isqrt(n)과 같은 값(floor 제곱근)을 g 근처에서 시작하는 정수 뉴턴법으로 구한다. 막대 길이는 늘 제 길이 근처라 한두 번에 끝난다.
// 시작값이 제곱근보다 작으면 한 걸음(산술 ≥ 기하 평균) + 1로 위로 올린 뒤, 줄어드는 동안 내려간다(isqrt와 같은 끝 조건).
function sqrtNear(n: number, g: number): number {
  if (n < 2) return n
  let x = Math.max(1, g)
  if (x * x <= n) x = Math.floor((x + Math.floor(n / x)) / 2) + 1
  for (;;) {
    const y = Math.floor((x + Math.floor(n / x)) / 2)
    if (y >= x) return x
    x = y
  }
}

// 막대 6개(같은 질량이라 반씩).
function rods(bw: BlockWork): void {
  for (let k = 0; k < RODS.length; k++) {
    const a = bw.c[RODS[k][0]]
    const b = bw.c[RODS[k][1]]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = sqrtNear(dx * dx + dy * dy, bw.L[k])
    if (dist === 0) continue
    const err = dist - bw.L[k]
    if (err === 0) continue
    const cx = divTrunc(err * dx, 2 * dist)
    const cy = divTrunc(err * dy, 2 * dist)
    a.x += cx
    a.y += cy
    b.x -= cx
    b.y -= cy
  }
}

// 꼭짓점 i의 둥근 모서리 원 중심: 두 변 방향으로 BLOCK_CORNER_R씩 안쪽. 원이 두 변에 접하므로 선 블록은 뜨지 않는다.
// 변 길이는 막대 길이 L(변 i = 막대 i)로 본다(막대 제약이 길이를 지킨다).
function cornerCentre(p: readonly number[], L: readonly number[], i: number): { x: number; y: number } {
  const ax = p[2 * i]
  const ay = p[2 * i + 1]
  const n = (i + 1) % 4
  const b = (i + 3) % 4
  return {
    x: ax + divRound(BLOCK_CORNER_R * (p[2 * n] - ax), L[i]) + divRound(BLOCK_CORNER_R * (p[2 * b] - ax), L[b]),
    y: ay + divRound(BLOCK_CORNER_R * (p[2 * n + 1] - ay), L[i]) + divRound(BLOCK_CORNER_R * (p[2 * b + 1] - ay), L[b]),
  }
}

// 꼭짓점–지형·움직이는 길: 둥근 모서리 원을 collideWheel로 밀고, 민 양만큼 꼭짓점을 옮긴다(속도는 PBD로).
function terrain(bw: BlockWork): void {
  const p = xy(bw)
  for (let i = 0; i < 4; i++) {
    const ctr = cornerCentre(p, bw.L, i)
    const org = bw.o[i]
    const b = { x: ctr.x, y: ctr.y, vx: bw.c[i].vx, vy: bw.c[i].vy }
    const hits = collideWheel(b, org.x, org.y, BLOCK_CORNER_R, GROUND_TOL, bw.terrain, 0)
    const dx = b.x - ctr.x
    const dy = b.y - ctr.y
    if (dx === 0 && dy === 0) continue
    bw.c[i].x += dx
    bw.c[i].y += dy
    bw.push[2 * i] += dx
    bw.push[2 * i + 1] += dy
    bw.surf[i] = hits.find((h) => h.prev) ?? bw.surf[i]
  }
}

type Pt = { b: Body; w: number } // 접점에 대한 몫(분모 D)

/**
 * 깊이 d 겹침을 단위가 아닌 법선 (nx, ny)/nl 방향으로 푼다. A(질량 ma)는 +n, B(질량 mb)는 −n으로 움직인다.
 * 위치 기반 접촉: λ = d / (Σ_A w²/ma + Σ_B w²/mb), 점 i의 이동 = λ·w_i/m. 접점끼리는 정확히 d만큼 벌어지고 운동량이 보존된다.
 * 바퀴(질량 1)가 블록 꼭짓점(질량 M)에 닿으면 바퀴는 d·M/(1+M), 꼭짓점은 d/(1+M)만큼 움직인다.
 * 돌려주는 값: A 쪽 질량 계수(속도 응답에 쓴다).
 */
function separate(d: number, nx: number, ny: number, nl: number, A: readonly Pt[], ma: number, B: readonly Pt[], mb: number): number {
  let sa = 0
  let sb = 0
  for (const p of A) sa += p.w * p.w
  for (const p of B) sb += p.w * p.w
  const W = mb * sa + ma * sb
  for (const p of A) {
    const m = divRound(d * mb * D * p.w, W)
    p.b.x += divRound(m * nx, nl)
    p.b.y += divRound(m * ny, nl)
  }
  for (const p of B) {
    const m = divRound(d * ma * D * p.w, W)
    p.b.x -= divRound(m * nx, nl)
    p.b.y -= divRound(m * ny, nl)
  }
  return W
}

// 차 쪽 점의 법선 속도가 블록 접점 쪽으로 향하면 그 상대 속도를 질량비대로 없앤다(차는 속도를 직접 들고 있으므로).
// 블록 쪽 속도는 위치 보정(PBD)에서 얻는다.
function carVelocity(nx: number, ny: number, nl: number, A: readonly Pt[], B: readonly Pt[], W: number): void {
  let vx = 0
  let vy = 0
  for (const p of A) {
    vx += p.b.vx * p.w
    vy += p.b.vy * p.w
  }
  for (const p of B) {
    vx -= p.b.vx * p.w
    vy -= p.b.vy * p.w
  }
  const vn = divRound(divRound(vx * nx + vy * ny, nl), D)
  if (vn >= 0) return
  for (const p of A) {
    const m = divRound(-vn * BLOCK_MASS * D * p.w, W)
    p.b.vx += divRound(m * nx, nl)
    p.b.vy += divRound(m * ny, nl)
  }
}

type Hit = { d: number; nx: number; ny: number; nl: number; pts: Pt[] }

// 원 (x, y, r)과 블록 bw(볼록 사각형, 반시계)의 겹침. 법선은 블록 → 원. pts = 블록 접점의 꼭짓점 몫.
// 변 길이는 막대 길이 L로 본다(막대 제약이 1% 안으로 지킨다).
function circleQuad(x: number, y: number, r: number, bw: BlockWork): Hit | null {
  const q = bw.c
  if (outside(q, x, y, r)) return null
  let inside = true
  let inE = -1
  let inD = 0
  let outD2 = -1
  let out: { qx: number; qy: number; e: number; t: number } | null = null
  let inT = 0
  for (let e = 0; e < 4; e++) {
    const a = q[e]
    const b = q[(e + 1) % 4]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const len = bw.L[e]
    const rx = x - a.x
    const ry = y - a.y
    const cross = ex * ry - ey * rx
    const along = Math.min(len, Math.max(0, divRound(ex * rx + ey * ry, len)))
    if (cross < 0) inside = false
    const din = Math.floor(cross / len)
    if (inE < 0 || din < inD) {
      inE = e
      inD = din
      inT = divRound(along * D, len)
    }
    const qx = a.x + divRound(ex * along, len)
    const qy = a.y + divRound(ey * along, len)
    const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy)
    if (outD2 < 0 || d2 < outD2) {
      outD2 = d2
      out = { qx, qy, e, t: divRound(along * D, len) }
    }
  }
  const at = (e: number, t: number): Pt[] => [{ b: q[e], w: D - t }, { b: q[(e + 1) % 4], w: t }].filter((p) => p.w > 0)
  if (inside) {
    const a = q[inE]
    const b = q[(inE + 1) % 4]
    const ex = b.x - a.x
    const ey = b.y - a.y
    return { d: r + inD, nx: ey, ny: -ex, nl: bw.L[inE], pts: at(inE, inT) }
  }
  if (out === null || outD2 >= r * r) return null
  const dist = isqrt(outD2)
  if (dist === 0) return null
  return { d: r - dist, nx: x - out.qx, ny: y - out.qy, nl: dist, pts: at(out.e, out.t) }
}

/**
 * 바퀴 둘·차체 판정원·차대 캡슐(치수는 car)과 블록의 겹침을 질량비대로 나눠 양쪽을 민다(설계 §7.2). 죽음은 판정하지 않는다.
 * 차 쪽 질량: 바퀴 1. 판정원은 두 바퀴가 함께 움직이고(몫 반씩), 캡슐은 접점 위치 비율로 나눈다. 블록 꼭짓점 질량은 BLOCK_MASS.
 */
export function pushCar(r: Body, f: Body, headAt: (r: Body, f: Body) => { x: number; y: number }[], bws: readonly BlockWork[], car: CarDef): void {
  for (const bw of bws) {
    const q = bw.c
    for (const w of [r, f]) {
      const h = circleQuad(w.x, w.y, WHEEL_R, bw)
      if (h) hitCar(h, [{ b: w, w: D }])
    }
    for (const hd of headAt(r, f)) {
      const h = circleQuad(hd.x, hd.y, car.headR, bw)
      if (h) hitCar(h, [{ b: r, w: D / 2 }, { b: f, w: D / 2 }])
    }
    // 차대 캡슐(두 바퀴 중심 선분을 윗방향으로 bodyDY 올린 선분, bodyR) 안에 들어온 꼭짓점.
    const cap = chassisOf(r, f, car.bodyDY)
    for (let i = 0; i < 4; i++) {
      const ax = f.x - r.x
      const ay = f.y - r.y
      const len = Math.max(1, isqrt(ax * ax + ay * ay))
      const v = q[i]
      const along = Math.min(len, Math.max(0, divRound(ax * (v.x - cap.x0) + ay * (v.y - cap.y0), len)))
      const px = cap.x0 + divRound(ax * along, len)
      const py = cap.y0 + divRound(ay * along, len)
      const d2 = (px - v.x) * (px - v.x) + (py - v.y) * (py - v.y)
      if (d2 >= car.bodyR * car.bodyR) continue
      const dist = isqrt(d2)
      let nx = px - v.x
      let ny = py - v.y
      let nl = dist
      if (dist === 0) {
        // 꼭짓점이 축 위: 블록 가운데 반대쪽으로.
        const mx = divTrunc(q[0].x + q[1].x + q[2].x + q[3].x, 4) - px
        const my = divTrunc(q[0].y + q[1].y + q[2].y + q[3].y, 4) - py
        const side = -ay * mx + ax * my > 0 ? -1 : 1
        nx = -ay * side
        ny = ax * side
        nl = len
      }
      const t = divRound(along * D, len)
      hitCar({ d: car.bodyR - dist, nx, ny, nl, pts: [{ b: v, w: D }] }, [{ b: r, w: D - t }, { b: f, w: t }].filter((p) => p.w > 0))
    }
  }
}

function hitCar(h: Hit, car: Pt[]): void {
  if (h.d <= 0) return
  const W = separate(h.d, h.nx, h.ny, h.nl, car, 1, h.pts, BLOCK_MASS)
  carVelocity(h.nx, h.ny, h.nl, car, h.pts, W)
}

// 점 (x, y)가 블록 bw(볼록 사각형, 반시계) 안이면 가장 가까운 변과 그 깊이.
function pointQuad(x: number, y: number, bw: BlockWork): Hit | null {
  const q = bw.c
  if (outside(q, x, y, 0)) return null
  let best: Hit | null = null
  for (let e = 0; e < 4; e++) {
    const a = q[e]
    const b = q[(e + 1) % 4]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const len = bw.L[e]
    const rx = x - a.x
    const ry = y - a.y
    const cross = ex * ry - ey * rx
    if (cross < 0) return null
    const d = Math.floor(cross / len)
    if (best === null || d < best.d) {
      const t = divRound(Math.min(len, Math.max(0, divRound(ex * rx + ey * ry, len))) * D, len)
      best = { d, nx: ey, ny: -ex, nl: len, pts: [{ b: a, w: D - t }, { b: b, w: t }].filter((p) => p.w > 0) }
    }
  }
  return best
}

// (x, y) 둘레 m이 꼭짓점 상자 밖인지(빠른 거름).
function outside(q: readonly Body[], x: number, y: number, m: number): boolean {
  return (
    (x + m < q[0].x && x + m < q[1].x && x + m < q[2].x && x + m < q[3].x) ||
    (x - m > q[0].x && x - m > q[1].x && x - m > q[2].x && x - m > q[3].x) ||
    (y + m < q[0].y && y + m < q[1].y && y + m < q[2].y && y + m < q[3].y) ||
    (y - m > q[0].y && y - m > q[1].y && y - m > q[2].y && y - m > q[3].y)
  )
}

function boxOf(q: readonly Body[]): Box {
  return {
    x0: Math.min(q[0].x, q[1].x, q[2].x, q[3].x),
    y0: Math.min(q[0].y, q[1].y, q[2].y, q[3].y),
    x1: Math.max(q[0].x, q[1].x, q[2].x, q[3].x),
    y1: Math.max(q[0].y, q[1].y, q[2].y, q[3].y),
  }
}

// 블록–블록(같은 질량): 한 블록의 꼭짓점이 다른 블록 안이면 가장 가까운 변 밖으로 민다.
// 높이가 같은 두 블록이 나란히 미끄러져 만나면 꼭짓점이 상대의 위·아래 변 위를 스쳐 안으로 들어가지 않으므로,
// 지형과 같은 둥근 모서리 원(BLOCK_CORNER_R)도 상대 사각형과 겹침을 푼다(면끼리 맞닿는 경우).
function blockPairs(bws: readonly BlockWork[]): void {
  const boxes = bws.map((bw) => boxOf(bw.c))
  for (let i = 0; i < bws.length; i++) {
    for (let j = i + 1; j < bws.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x0 > b.x1 || b.x0 > a.x1 || a.y0 > b.y1 || b.y0 > a.y1) continue
      for (const [p, q] of [[bws[i], bws[j]], [bws[j], bws[i]]]) {
        const xs = xy(p)
        for (let k = 0; k < 4; k++) {
          const ctr = cornerCentre(xs, p.L, k)
          const h = circleQuad(ctr.x, ctr.y, BLOCK_CORNER_R, q)
          if (h && h.d > 0) separate(h.d, h.nx, h.ny, h.nl, [{ b: p.c[k], w: D }], BLOCK_MASS, h.pts, BLOCK_MASS)
        }
        for (const v of p.c) {
          const h = pointQuad(v.x, v.y, q)
          if (h && h.d > 0) separate(h.d, h.nx, h.ny, h.nl, [{ b: v, w: D }], BLOCK_MASS, h.pts, BLOCK_MASS)
        }
      }
    }
  }
}

/**
 * 제약 반복 한 번: 막대 → 꼭짓점–지형 → 블록–블록 → 막대 → 블록–블록.
 * 밀린 뒤 모양을 다시 맞추고(막대 오차), 그 막대 보정이 만든 블록끼리 겹침을 한 번 더 푼다.
 */
export function solveBlocks(bws: readonly BlockWork[]): void {
  for (const bw of bws) {
    rods(bw)
    terrain(bw)
  }
  if (bws.length > 1) blockPairs(bws)
  for (const bw of bws) rods(bw)
  if (bws.length > 1) blockPairs(bws)
}

/**
 * 이동 단계 끝: 마찰과 속도. 지형이 이번 단계에 꼭짓점을 민 양(수직 항력에 비례)의 BLOCK_FRICTION_PCT%까지
 * 접선 방향 상대 이동을 없앤다(쿨롱 마찰, 정지 마찰 포함). 블록끼리 겹침을 한 번 더 풀고, 예측 위치에서 옮겨진 양 × SUBSTEPS를 속도에 더한다.
 */
export function finishBlocks(bws: readonly BlockWork[]): void {
  for (const bw of bws) {
    for (let i = 0; i < 4; i++) {
      const b = bw.c[i]
      const nx = bw.push[2 * i]
      const ny = bw.push[2 * i + 1]
      if (nx !== 0 || ny !== 0) {
        const nl = isqrt(nx * nx + ny * ny)
        let gx = 0
        let gy = 0
        const sf = bw.surf[i]
        if (sf) {
          const g = candVel(sf, b.x, b.y)
          gx = divRound(g.vx, SUBSTEPS)
          gy = divRound(g.vy, SUBSTEPS)
        }
        // 접선 (−ny, nx)/nl 방향의 상대 이동.
        const dt = divTrunc((b.x - bw.s[2 * i] - gx) * -ny + (b.y - bw.s[2 * i + 1] - gy) * nx, Math.max(1, nl))
        const lim = Math.min(Math.abs(dt), Math.floor((nl * BLOCK_FRICTION_PCT) / 100))
        const cut = dt < 0 ? -lim : lim
        if (cut !== 0 && nl > 0) {
          b.x -= divRound(cut * -ny, nl)
          b.y -= divRound(cut * nx, nl)
        }
      }
    }
  }
  if (bws.length > 1) blockPairs(bws) // 마찰이 마지막으로 옮긴 꼭짓점의 블록끼리 겹침
  for (const bw of bws) {
    for (let i = 0; i < 4; i++) {
      const b = bw.c[i]
      b.vx += (b.x - bw.q[2 * i]) * SUBSTEPS
      b.vy += (b.y - bw.q[2 * i + 1]) * SUBSTEPS
    }
  }
}

/** 상자가 점들(바퀴 중심·판정원 중심) 둘레 margin 안에 드는 블록만. 그 밖의 블록은 차와 닿을 수 없다(계산만 줄이고 결과는 같다). */
export function blocksNearCar(bws: readonly BlockWork[], pts: readonly { x: number; y: number }[], margin: number): BlockWork[] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return bws.filter((bw) => {
    const b = boxOf(bw.c)
    return b.x0 <= x1 + margin && b.x1 >= x0 - margin && b.y0 <= y1 + margin && b.y1 >= y0 - margin
  })
}

/** 지금 꼭짓점 자세(now)와 이동 단계 시작 자세(prev)의 변 후보. */
export function blockWorkCands(bws: readonly BlockWork[]): Cand[] {
  return blockCands(
    bws.map((bw) => bw.id),
    bws.map((bw) => edges(xy(bw), bw.s)),
  )
}

/** 상자와 겹치는 고정 선분(시작 평지 + 상자 x 범위의 구간과 그 양옆 구간). from은 찾기 시작할 구간 번호. */
export function terrainNear(course: Course, from: number, box: Box): Cand[] {
  const out: Cand[] = []
  const add = (i: number): void => {
    const g = course.seg(i)
    if (Math.max(g.x0, g.x1) < box.x0 || Math.min(g.x0, g.x1) > box.x1) return
    if (Math.max(g.y0, g.y1) < box.y0 || Math.min(g.y0, g.y1) > box.y1) return
    const c = candOf(i, g)
    if (c) out.push(c)
  }
  add(0)
  let k = from
  while (box.x0 > course.section(k).endX) k++
  while (k > 0 && box.x0 < course.section(k).startX) k--
  k = Math.max(0, k - 1)
  for (let last = false; !last; k++) {
    const sec = course.section(k)
    last = sec.startX > box.x1
    for (let i = sec.firstSeg; i <= sec.lastSeg; i++) add(i)
  }
  return out
}
