// 고를 수 있는 차(설계 §5·§6). 순수 모듈: React·외부 의존 없음(Deno 호환).
// 차는 차체 판정 모양만 다르다: 바퀴 반지름·축거·질량·가속·회전은 모든 차가 같다.
// 지붕 = 두 바퀴 중점에서 차의 윗방향 headOffset에 둔 반지름 headR 원(지붕 높이 = 축선 위 headOffset + headR).
// 차대 = 두 바퀴 중심 선분을 차의 윗방향으로 bodyDY 올린 선분, 반지름 bodyR인 캡슐.
// 값은 그림에 맞춰 ±30 mm 안에서만 고치고, 지붕 높이 순서(pickup > coupe > buggy > sports > f1 > skate)와 가격은 그대로 둔다.
// 낮은 차 지붕은 쿠페보다 지붕 바닥(headOffset - headR)이 낮으면 쿠페가 지나는 마루에 걸린다(cars.test.ts 쿠페 기준 비교). 그래서 지붕 높이(headOffset + headR)는 두고 중심을 올려 반지름을 줄였다.
import { BODY_DY, BODY_R, HEAD_OFFSET, HEAD_R, MM } from './constants.ts'

/** 길이는 u. price는 골드. */
export type CarDef = { id: string; label: string; price: number; headOffset: number; headR: number; bodyDY: number; bodyR: number }

export const DEFAULT_CAR = 'coupe'

export const CARS: readonly CarDef[] = [
  // 쿠페(지금 노란 차): 지금 상수 그대로 → 쿠페로 달리면 차 도입 전과 같은 결과
  { id: 'coupe', label: '쿠페', price: 0, headOffset: HEAD_OFFSET, headR: HEAD_R, bodyDY: BODY_DY, bodyR: BODY_R }, // 지붕 380 mm
  { id: 'pickup', label: '픽업', price: 5000, headOffset: 270 * MM, headR: 180 * MM, bodyDY: 150 * MM, bodyR: 190 * MM }, // 450 mm
  { id: 'buggy', label: '버기', price: 15000, headOffset: 175 * MM, headR: 155 * MM, bodyDY: 120 * MM, bodyR: 170 * MM }, // 330 mm
  { id: 'sports', label: '스포츠카', price: 30000, headOffset: 150 * MM, headR: 130 * MM, bodyDY: 90 * MM, bodyR: 150 * MM }, // 280 mm
  { id: 'f1', label: 'F1', price: 60000, headOffset: 125 * MM, headR: 105 * MM, bodyDY: 60 * MM, bodyR: 130 * MM }, // 230 mm
  { id: 'skate', label: '스케이트보드', price: 100000, headOffset: 110 * MM, headR: 90 * MM, bodyDY: 40 * MM, bodyR: 120 * MM }, // 200 mm
]

/** id의 차. 모르는 id·undefined는 기본 차(쿠페). */
export function carById(id: string | undefined): CarDef {
  return CARS.find((c) => c.id === id) ?? (CARS.find((c) => c.id === DEFAULT_CAR) as CarDef)
}

/** 어느 차든 지붕 원·차대 캡슐이 축선(바퀴 중심)에서 닿는 최대 거리. 판정 후보를 거르는 여유값에 쓴다. */
export const CAR_REACH_MAX = CARS.reduce((m, c) => Math.max(m, c.headOffset + c.headR, c.bodyDY + c.bodyR), 0)
