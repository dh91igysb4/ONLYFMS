// 시드 → 템플릿 이어붙이기. 구간·선분 조회는 게으르게 무한히 생성한다 (설계 §6). 순수 정수 TS.
import { REST_LEN, START_BACK, START_LEN, TIER_WEIGHTS } from './constants.ts'
import { TEMPLATES, buildTemplate } from './pieces.ts'
import type { Built, Seg, Template } from './pieces.ts'

export type Section = { index: number; templateId: string; startX: number; endX: number; firstSeg: number; lastSeg: number; minY: number }
export type Gem = { id: number; x: number; y: number }
export type Course = {
  seg(i: number): Seg // 필요하면 i까지 생성
  section(k: number): Section // 필요하면 k까지 생성
  gemsBetween(segFrom: number, segTo: number): readonly Gem[]
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

// k번째 구간에 쓸 템플릿을 정하는 함수를 받아 코스를 만든다. pick은 k 오름차순으로 한 번씩만 불린다.
function buildCourse(pick: (k: number) => Template): Course {
  // 선분 0은 시작 평지. 코스 시작점(x = 0) 뒤로 START_BACK만큼 이어져 있어 첫 구간에서 되굴러가도 길 위에 남는다.
  const segs: Seg[] = [{ x0: -START_BACK, y0: 0, x1: START_LEN, y1: 0, boost: false }]
  const sections: Section[] = []
  const sectionGems: Gem[][] = []
  const builtCache = new Map<Template, Built>()
  let penX = START_LEN
  let penY = 0
  let gemId = 0

  const addSection = (): void => {
    const k = sections.length
    const tpl = pick(k)
    let built = builtCache.get(tpl)
    if (!built) {
      built = buildTemplate(tpl)
      builtCache.set(tpl, built)
    }
    const startX = penX
    const firstSeg = segs.length
    segs.push({ x0: penX, y0: penY, x1: penX + REST_LEN, y1: penY, boost: false })
    const tx = penX + REST_LEN
    for (const s of built.segs) segs.push({ x0: s.x0 + tx, y0: s.y0 + penY, x1: s.x1 + tx, y1: s.y1 + penY, boost: s.boost })
    const gems: Gem[] = []
    for (const g of built.gems) gems.push({ id: gemId++, x: g.x + tx, y: g.y + penY })
    sections.push({
      index: k,
      templateId: tpl.id,
      startX,
      endX: built.endX + tx,
      firstSeg,
      lastSeg: segs.length - 1,
      minY: Math.min(penY, built.minY + penY),
    })
    sectionGems.push(gems)
    penX = built.endX + tx
    penY += built.endY
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
  }
}

export function courseFromTemplates(templates: readonly Template[]): Course {
  if (templates.length === 0) throw new Error('템플릿이 비어 있다')
  return buildCourse((k) => templates[k % templates.length])
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
  return buildCourse((k) => {
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
