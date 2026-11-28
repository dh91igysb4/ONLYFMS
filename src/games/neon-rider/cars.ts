// 고를 수 있는 차(설계 §5·§6). 순수 모듈: React·외부 의존 없음(Deno 호환).
// 차는 차체 판정 모양만 다르다: 바퀴 반지름·축거·질량·가속·회전은 모든 차가 같다.
// 지붕 = 두 바퀴 중점에서 차의 윗방향 headOffset 높이, 앞뒤 ±headHalf 선분에 반지름 headR을 두른 캡슐(지붕 높이 = 축선 위 headOffset + headR).
// 차대 = 두 바퀴 중심 선분을 차의 윗방향으로 bodyDY 올린 선분, 반지름 bodyR인 캡슐.
// 값은 그림에 맞춰 ±30 mm 안에서만 고치고, 지붕 높이 순서(pickup > coupe > buggy > sports > f1 > skate)와 가격은 그대로 둔다.
// 낮은 차 지붕은 쿠페보다 지붕 바닥(headOffset - headR)이 낮으면 쿠페가 지나는 마루에 걸린다(cars.test.ts 쿠페 기준 비교). 그래서 지붕 높이(headOffset + headR)는 두고 중심을 올려 반지름을 줄였다.
import { BODY_DY, BODY_R, HEAD_HALF, HEAD_OFFSET, HEAD_R, MM } from './constants.ts'

/** 길이는 u. price는 골드. */
// 지붕 판정은 축 가운데 위 headOffset 높이, 앞뒤로 ±headHalf인 선분을 반지름 headR로 두른 캡슐(A~C필러)이다. 땅에 닿으면 죽는 것은 이 캡슐뿐이다.
export type CarDef = { id: string; label: string; price: number; headOffset: number; headR: number; headHalf: number; bodyDY: number; bodyR: number }

export const DEFAULT_CAR = 'coupe'

export const CARS: readonly CarDef[] = [
  // v8(2026-11-28): 바퀴 220 mm. 지붕 판정은 A~C 필러를 덮는 캡슐(축 방향 ±headHalf)이고, 그 아래(차 바닥)는 지형에 닿아도 죽지 않는다.
  // 지붕 캡슐 아래 끝은 바퀴를 길에 붙인 어떤 자세에서도 쿠페가 안 닿는 지형에 안 닿게 잡는다(cars.test 쿠페 기준 비교). 스케이트보드는 지붕이 없어 보드 위 빈 자리(서 있는 사람 높이)에 둔다.
  { id: 'coupe', label: '쿠페', price: 0, headOffset: HEAD_OFFSET, headR: HEAD_R, headHalf: HEAD_HALF, bodyDY: BODY_DY, bodyR: BODY_R }, // 지붕 580 mm
  { id: 'pickup', label: '픽업', price: 5000, headOffset: 570 * MM, headR: 130 * MM, headHalf: 200 * MM, bodyDY: 210 * MM, bodyR: 190 * MM }, // 지붕 700 mm
  { id: 'buggy', label: '버기', price: 15000, headOffset: 410 * MM, headR: 110 * MM, headHalf: 200 * MM, bodyDY: 130 * MM, bodyR: 170 * MM }, // 지붕 520 mm
  { id: 'sports', label: '스포츠카', price: 30000, headOffset: 380 * MM, headR: 100 * MM, headHalf: 190 * MM, bodyDY: 150 * MM, bodyR: 150 * MM }, // 지붕 480 mm
  { id: 'f1', label: 'F1', price: 60000, headOffset: 320 * MM, headR: 45 * MM, headHalf: 60 * MM, bodyDY: 70 * MM, bodyR: 130 * MM }, // 지붕 365 mm
  { id: 'skate', label: '스케이트보드', price: 100000, headOffset: 340 * MM, headR: 40 * MM, headHalf: 0, bodyDY: 40 * MM, bodyR: 120 * MM }, // 판정 380 mm
]

/** id의 차. 모르는 id·undefined는 기본 차(쿠페). */
export function carById(id: string | undefined): CarDef {
  return CARS.find((c) => c.id === id) ?? (CARS.find((c) => c.id === DEFAULT_CAR) as CarDef)
}

/** 어느 차든 지붕 원·차대 캡슐이 축선(바퀴 중심)에서 닿는 최대 거리. 판정 후보를 거르는 여유값에 쓴다. */
export const CAR_REACH_MAX = CARS.reduce((m, c) => Math.max(m, c.headOffset + c.headR + c.headHalf, c.bodyDY + c.bodyR), 0)

/** 지붕 캡슐을 덮는 원들의 (축 방향 위치, 반지름): 캡슐 중심선 위에 간격 ≤ headR로 원을 놓는다(위 가장자리 처짐 ≤ headR·(1 − √3/2)). */
export function headStops(car: CarDef): number[] {
  if (car.headHalf <= 0) return [0]
  const n = Math.max(1, Math.ceil((2 * car.headHalf) / car.headR))
  const out: number[] = []
  for (let i = 0; i <= n; i++) out.push(-car.headHalf + Math.floor((2 * car.headHalf * i) / n))
  return out
}
