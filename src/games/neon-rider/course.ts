// 시드 → 템플릿 이어붙이기. 구간·선분 조회는 게으르게 무한히 생성한다 (설계 §6). 순수 정수 TS.
// 위험물·움직이는 길·블록은 구간을 만들 때 월드로 옮겨 종류마다 전역 번호를 붙인다 (움직임 설계 §4.4).
import type { Block, BlockDef } from './blocks.ts'
import type { Box } from './collide.ts'
import { REST_LEN, START_BACK, START_LEN, TIER_WEIGHTS } from './constants.ts'
import { hazardBox, type Hazard } from './hazards.ts'
import { moverBox, type Mover } from './movers.ts'
import { TEMPLATES, buildTemplate, shiftBlock, shiftHazard, shiftMover } from './pieces.ts'
import type { Built, Seg, Template } from './pieces.ts'
import { TRIG_ONE, cosT, sinT } from './trig.ts'

export type Section = { index: number; templateId: string; startX: number; endX: number; firstSeg: number; lastSeg: number; minY: number }
export type Gem = { id: number; x: number; y: number }
export type Course = {
  seg(i: number): Seg // 필요하면 i까지 생성
  section(k: number): Section // 필요하면 k까지 생성
  gemsBetween(segFrom: number, segTo: number): readonly Gem[]
  // 상자와 "움직임 전체를 덮는 상자"(블록은 처음 자세, pass 길은 pass.x까지 넓힌 상자)가 겹치는 것, id 오름차순. 필요한 구간까지 만든다(x 범위로 찾는다).
  hazardsNear(box: Box): readonly Hazard[]
  moversNear(box: Box): readonly Mover[]
  blocksNear(box: Box): readonly Block[]
  moverById(id: number): Mover // 이미 만든 구간의 길만(상태에 남은 id로 다시 찾기)
}

// 최근 몇 개 구간의 템플릿을 피하는지, 캐시에 몇 개 seed를 두는지 (조정 수치가 아니라 구조 값).
const RECENT = 3
const CACHE_MAX = 4

function fnv(h: number, v: number): number {
  return Math.imul(h ^ v, 0x01000193) >>> 0
}

// ball-run/course.ts와 같은 방식: 시드 앞 16바이트 + salt를 FNV-1a로 섞어 sfc32 상태를 만든다. 출력은 [0, 2^32) 정수.
function u32Stream(seed: string, salt: string): () => number {
  const bytes: number[] = []
  for (let i = 0; i < 16; i++) {
    const v = parseInt(seed.slice(i * 2, i * 2 + 2), 16)
    bytes.push(Number.isNaN(v) ? seed.charCodeAt(i) & 255 : v)
  }
  const st: number[] = []
  for (let k = 0; k < 4; k++) {
    let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0
    for (const b of bytes) h = fnv(h, b)
    h = fnv(h, 0xff)
    for (let i = 0; i < salt.length; i++) h = fnv(h, salt.charCodeAt(i) & 255)
    h ^= h >>> 15
    h = Math.imul(h, 0x2c1b3c6d) >>> 0
    h ^= h >>> 12
    st.push(h >>> 0)
  }
  let [a, b, c, d] = st
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }
  for (let i = 0; i < 12; i++) next()
  return next
}

function checkIndex(i: number, what: string): void {
  if (!Number.isInteger(i) || i < 0) throw new RangeError(`${what} 인덱스는 0 이상의 정수여야 한다: ${i}`)
}

/** 블록 처음 자세의 상자: 바닥 변 가운데 (x, y) 둘레로 a만큼 돈 w×h 직사각형. 꼭짓점 내림 여유 2. */
function blockRestBox(b: BlockDef): Box {
  const c = cosT(b.a)
  const s = sinT(b.a)
  const left = -Math.floor(b.w / 2)
  const right = b.w + left
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [rx, ry] of [[left, 0], [right, 0], [right, b.h], [left, b.h]]) {
    const x = b.x + Math.floor((c * rx - s * ry) / TRIG_ONE)
    const y = b.y + Math.floor((s * rx + c * ry) / TRIG_ONE)
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 }
}

/** 움직이는 길의 색인 상자: 움직임 전체를 덮는 상자에, pass 길이면 pass.x까지 x를 넓힌다(차 중심이 pass.x를 넘을 때 찾도록). */
function moverIndexBox(m: Mover): Box {
  const b = moverBox(m)
  if (m.start.k !== 'pass') return b
  return { ...b, x0: Math.min(b.x0, m.start.x), x1: Math.max(b.x1, m.start.x) }
}

/** 구간 바닥(minY)에 넣는 길의 최저 높이: 움직임 전체 범위. fall 길은 떨어진 깊이가 아니라 처음 자세의 최저점. */
function moverFloor(m: Mover): number {
  if (m.motion.k !== 'fall') return moverBox(m).y0
  let y = Infinity
  for (const s of m.segs) y = Math.min(y, s.y0, s.y1)
  return y
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
}

type Boxed<T> = { item: T; box: Box }
type SectionItems = { hazards: Boxed<Hazard>[]; movers: Boxed<Mover>[]; blocks: Boxed<Block>[] }

// k번째 구간에 쓸 템플릿을 정하는 함수를 받아 코스를 만든다. pick은 k 오름차순으로 한 번씩만 불리고 templates 중 하나를 돌려준다.
function buildCourse(templates: readonly Template[], pick: (k: number) => Template): Course {
  // 선분 0은 시작 평지. 코스 시작점(x = 0) 뒤로 START_BACK만큼 이어져 있어 첫 구간에서 되굴러가도 길 위에 남는다.
  const segs: Seg[] = [{ x0: -START_BACK, y0: 0, x1: START_LEN, y1: 0, boost: false }]
  const sections: Section[] = []
  const sectionGems: Gem[][] = []
  const sectionItems: SectionItems[] = []
  const movers: Mover[] = [] // movers[id]
  const builtCache = new Map<Template, Built>()
  let penX = START_LEN
  let penY = 0
  let gemId = 0
  let hazardId = 0
  let blockId = 0

  const builtOf = (tpl: Template): Built => {
    let built = builtCache.get(tpl)
    if (!built) {
      built = buildTemplate(tpl)
      builtCache.set(tpl, built)
    }
    return built
  }

  // 항목 상자가 자기 구간 [startX, endX] 밖으로 뻗는 최대 거리(back: 앞쪽, fwd: 뒤쪽). 템플릿 전체에서 한 번 정하므로
  // 조회 결과가 그때까지 만든 구간 수와 상관없다(같은 코스를 그림·시뮬이 함께 쓴다).
  let reach: { back: number; fwd: number } | null = null
  const reachOf = (): { back: number; fwd: number } => {
    if (reach) return reach
    let back = 0
    let fwd = 0
    for (const tpl of templates) {
      const b = builtOf(tpl)
      const boxes = [
        ...b.hazards.map((h) => hazardBox({ ...h, id: 0 })),
        ...b.movers.map((m) => moverIndexBox({ ...m, id: 0 })),
        ...b.blocks.map(blockRestBox),
      ]
      for (const x of boxes) {
        back = Math.max(back, -(REST_LEN + x.x0))
        fwd = Math.max(fwd, x.x1 - b.endX)
      }
    }
    reach = { back, fwd }
    return reach
  }

  const addSection = (): void => {
    const k = sections.length
    const tpl = pick(k)
    const built = builtOf(tpl)
    const startX = penX
    const firstSeg = segs.length
    segs.push({ x0: penX, y0: penY, x1: penX + REST_LEN, y1: penY, boost: false })
    const tx = penX + REST_LEN
    for (const s of built.segs) segs.push({ x0: s.x0 + tx, y0: s.y0 + penY, x1: s.x1 + tx, y1: s.y1 + penY, boost: s.boost })
    const gems: Gem[] = []
    for (const g of built.gems) gems.push({ id: gemId++, x: g.x + tx, y: g.y + penY })
    const items: SectionItems = { hazards: [], movers: [], blocks: [] }
    for (const h of built.hazards) {
      const item: Hazard = { ...shiftHazard(h, tx, penY), id: hazardId++ }
      items.hazards.push({ item, box: hazardBox(item) })
    }
    for (const m of built.movers) {
      const item: Mover = { ...shiftMover(m, tx, penY), id: movers.length }
      movers.push(item)
      items.movers.push({ item, box: moverIndexBox(item) })
    }
    for (const b of built.blocks) {
      const item: Block = { ...shiftBlock(b, tx, penY), id: blockId++ }
      items.blocks.push({ item, box: blockRestBox(item) })
    }
    sections.push({
      index: k,
      templateId: tpl.id,
      startX,
      endX: built.endX + tx,
      firstSeg,
      lastSeg: segs.length - 1,
      // 움직이는 길 위에 선 차가 fall 판정에 걸리지 않게 길이 움직이는 범위의 최저점도 넣는다.
      minY: items.movers.reduce((y, e) => Math.min(y, moverFloor(e.item)), Math.min(penY, built.minY + penY)),
    })
    sectionGems.push(gems)
    sectionItems.push(items)
    penX = built.endX + tx
    penY += built.endY
  }

  // 상자와 겹칠 수 있는 구간: startX − back ≤ box.x1 이고 endX + fwd ≥ box.x0. 앞쪽 조건을 만족하는 구간을 모두 만든 뒤
  // endX로 이진 탐색해 시작 구간을 찾고 오른쪽으로 훑는다.
  const near = <T>(box: Box, list: (s: SectionItems) => Boxed<T>[]): T[] => {
    if (!Number.isFinite(box.x0) || !Number.isFinite(box.x1)) throw new RangeError(`상자 x 범위는 유한해야 한다: ${box.x0}, ${box.x1}`)
    const { back, fwd } = reachOf()
    while (sections.length === 0 || sections[sections.length - 1].startX - back <= box.x1) addSection()
    let lo = 0
    let hi = sections.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sections[mid].endX + fwd >= box.x0) hi = mid
      else lo = mid + 1
    }
    const out: T[] = []
    for (let k = lo; k < sections.length && sections[k].startX - back <= box.x1; k++) {
      for (const e of list(sectionItems[k])) if (overlaps(e.box, box)) out.push(e.item)
    }
    return out
  }

  return {
    seg(i) {
      checkIndex(i, 'seg')
      while (segs.length <= i) addSection()
      return segs[i]
    },
    section(k) {
      checkIndex(k, 'section')
      while (sections.length <= k) addSection()
      return sections[k]
    },
    gemsBetween(segFrom, segTo) {
      checkIndex(segFrom, 'seg')
      checkIndex(segTo, 'seg')
      while (segs.length <= segTo) addSection()
      // lastSeg ≥ segFrom인 첫 구간 ~ firstSeg ≤ segTo인 마지막 구간 (이진 탐색).
      let lo = 0
      let hi = sections.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (sections[mid].lastSeg >= segFrom) hi = mid
        else lo = mid + 1
      }
      const out: Gem[] = []
      for (let k = lo; k < sections.length && sections[k].firstSeg <= segTo; k++) for (const g of sectionGems[k]) out.push(g)
      return out
    },
    hazardsNear: (box) => near(box, (s) => s.hazards),
    moversNear: (box) => near(box, (s) => s.movers),
    blocksNear: (box) => near(box, (s) => s.blocks),
    moverById(id) {
      checkIndex(id, 'mover')
      if (id >= movers.length) throw new RangeError(`아직 만들지 않은 움직이는 길: ${id}`)
      return movers[id]
    },
  }
}

export function courseFromTemplates(templates: readonly Template[]): Course {
  if (templates.length === 0) throw new Error('템플릿이 비어 있다')
  return buildCourse(templates, (k) => templates[k % templates.length])
}

export function courseOf(templateIds: readonly string[]): Course {
  return courseFromTemplates(
    templateIds.map((id) => {
      const t = TEMPLATES.find((x) => x.id === id)
      if (!t) throw new Error(`알 수 없는 템플릿: ${id}`)
      return t
    }),
  )
}

// 구간 k의 티어 가중치: from ≤ k인 마지막 항목.
function weightsAt(k: number): readonly [number, number, number, number] {
  let w = TIER_WEIGHTS[0].w
  for (const t of TIER_WEIGHTS) if (t.from <= k) w = t.w
  return w
}

export function makeSeededCourse(seed: string, templates: readonly Template[]): Course {
  if (templates.length === 0) throw new Error('템플릿이 비어 있다')
  const next = u32Stream(seed, 'neon-course')
  const byTier: Template[][] = [[], [], [], []]
  for (const t of templates) byTier[t.tier - 1].push(t)
  const recent: string[] = []
  return buildCourse(templates, (k) => {
    // 템플릿이 없는 티어는 가중치 0으로 본다. 전부 0이면 있는 템플릿 전체에서 뽑는다.
    const w = weightsAt(k).map((x, i) => (byTier[i].length > 0 ? x : 0))
    const total = w[0] + w[1] + w[2] + w[3]
    let pool: Template[]
    let r = next() % Math.max(1, total)
    if (total === 0) pool = [...templates]
    else {
      let tier = 0
      while (r >= w[tier]) {
        r -= w[tier]
        tier++
      }
      pool = byTier[tier]
    }
    const fresh = pool.filter((t) => !recent.includes(t.id))
    const cands = fresh.length > 0 ? fresh : pool
    const chosen = cands[next() % cands.length]
    recent.push(chosen.id)
    if (recent.length > RECENT) recent.shift()
    return chosen
  })
}

const cache = new Map<string, Course>()

export function getCourse(seed: string): Course {
  const hit = cache.get(seed)
  if (hit) {
    cache.delete(seed)
    cache.set(seed, hit)
    return hit
  }
  const c = makeSeededCourse(seed, TEMPLATES)
  cache.set(seed, c)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return c
}

/** 테스트 전용: 캐시에 든 seed 수. */
export function courseCacheSize(): number {
  return cache.size
}
