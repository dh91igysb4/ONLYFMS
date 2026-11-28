// 모래 발자국(화면 전용 연출): 내 캐릭터가 모래 칸을 걸으면 지나간 자리에 작은 발자국을 남기고, 몇 초에 걸쳐 옅어지다 지운다.
// 서버·세이브·판정과 무관한 순수 모듈. 그리기는 scene.ts가 한다.
import type { Vec } from './map.ts'

/** 발 중앙(월드 px), 찍은 시각(ms), 왼발(0)·오른발(1) */
export type Footprint = { x: number; y: number; t: number; side: 0 | 1 }

/** 이만큼(px) 걸을 때마다 하나 */
export const FOOTPRINT_STEP = 6
/** 동시에 남는 발자국 상한(그리기 비용) */
export const FOOTPRINT_MAX = 20
/** 찍힌 뒤 사라질 때까지(ms) */
export const FOOTPRINT_LIFE_MS = 3000
/** 이 시간까지는 진하게, 그 뒤 사라질 때까지 옅어진다 */
const FADE_START_MS = FOOTPRINT_LIFE_MS / 2

/** 남은 발자국과 마지막으로 찍은 자리(발자국이 다 사라져도 기억해 서 있는 자리에 다시 찍지 않는다) */
export type Footprints = { prints: readonly Footprint[]; last: Footprint | null }
export const NO_FOOTPRINTS: Footprints = { prints: [], last: null }

/**
 * 한 프레임 갱신: 오래된 것을 지우고, 모래 위에서 마지막으로 찍은 자리와 FOOTPRINT_STEP 이상 떨어졌으면 하나 더 찍는다.
 * isSand(x, y)는 월드 px가 모래 칸인지. 모래가 아니어도 걸은 자리는 기억해 모래로 들어서는 첫 걸음에 찍는다.
 */
export function stepFootprints(fp: Footprints, pos: Vec, tMs: number, isSand: (x: number, y: number) => boolean): Footprints {
  // 시계가 뒤로 가면(다시 시작) 새로
  if (fp.last && tMs < fp.last.t) fp = NO_FOOTPRINTS
  const alive = fp.prints.filter((f) => tMs - f.t < FOOTPRINT_LIFE_MS)
  let prints: readonly Footprint[] = alive.length === fp.prints.length ? fp.prints : alive
  let last = fp.last
  const prev = fp.last
  if (!prev || Math.hypot(pos.x - prev.x, pos.y - prev.y) >= FOOTPRINT_STEP) {
    const side: 0 | 1 = prev ? (prev.side === 0 ? 1 : 0) : 0
    last = { x: pos.x, y: pos.y, t: tMs, side }
    if (isSand(pos.x, pos.y)) {
      prints = [...prints, last]
      if (prints.length > FOOTPRINT_MAX) prints = prints.slice(prints.length - FOOTPRINT_MAX)
    }
  }
  return prints === fp.prints && last === fp.last ? fp : { prints, last }
}

/** 진하기 0~1: 처음 절반은 1, 그 뒤 0까지 줄어든다 */
export function footprintAlpha(f: Footprint, tMs: number): number {
  const age = tMs - f.t
  if (age <= FADE_START_MS) return 1
  if (age >= FOOTPRINT_LIFE_MS) return 0
  return 1 - (age - FADE_START_MS) / (FOOTPRINT_LIFE_MS - FADE_START_MS)
}
