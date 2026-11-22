// 몰래 수능 상수. 길이는 mm, 시간은 틱(60Hz). 시뮬은 모두 정수로 계산한다.
export const TICK_HZ = 60
export const TOTAL_TICKS = 7200 // 2분
export const N_Q = 8 // 시험 문제 수
export const N_CHOICE = 5 // 선택지 수
export const PROG_MAX = 3600 // 한 문제 풀이 진행도 상한(도달하면 정답 공개)
export const SUSP_MAX = 10000 // 의심도 상한(도달하면 적발)
export const SUSP_DECAY = 5 // 그 틱의 증가가 0이면 줄어드는 양
export const SUSP_WATCH = 6000 // 이 이상이면 감독관이 내 옆 통로를 주시

// 교실 좌표(mm). 내 자리는 오른쪽에서 둘째 열, 맨 뒷줄.
export const ME_X = 900
export const ME_Z = 1000
export const COL_X = [-2700, -900, 900, 2700] as const
export const ROW_Z = [1000, 2400, 3800, 5200, 6600] as const
export const AISLE_X = [-3600, -1800, 0, 1800, 3600] as const
export const WATCH_AISLE_X = [0, 1800] as const
export const FRONT_Z = 8200

// 거리 구역(제곱 거리): near ≤ NEAR2, mid ≤ MID2, 그 밖은 far.
export const NEAR2 = 1500 * 1500
export const MID2 = 3500 * 3500

// seen/blind의 [near, mid, far]는 틱당 의심도 증가. seen = 감독관이 나를 보는 중, blind = 안 보는 중.
export type ToolSpec = {
  name: string
  rate: number // 틱당 풀이 진행도
  stow: number // 숨기는 데 걸리는 틱
  seen: readonly [number, number, number]
  blind: readonly [number, number, number]
}
export const TOOLS: readonly (ToolSpec | null)[] = [
  null,
  { name: '스마트 안경', rate: 6, stow: 0, seen: [60, 10, 0], blind: [0, 0, 0] },
  { name: '무선 이어폰', rate: 12, stow: 20, seen: [120, 20, 0], blind: [120, 20, 0] },
  { name: '휴대폰', rate: 30, stow: 40, seen: [250, 80, 15], blind: [40, 0, 0] },
]

export type ProctorSpec = {
  name: string
  hint: string
  speed: number
  farMul: number
  glassesFar: number
  wWatch: number
  wDoze: number
  wPatrol: number
  watchT: readonly [number, number]
  dozeT: readonly [number, number]
  lookT: readonly [number, number]
  relookOf: number // look이 끝났을 때 1/relookOf 확률로 같은 통로의 다른 줄을 한 번 더 본다. 0이면 안 함
}
export const PROCTORS: readonly ProctorSpec[] = [
  { name: '순찰형', hint: '쉬지 않고 통로를 돈다', speed: 25, farMul: 1, glassesFar: 0, wWatch: 1, wDoze: 0, wPatrol: 6, watchT: [60, 120], dozeT: [0, 0], lookT: [40, 90], relookOf: 3 },
  { name: '매의 눈', hint: '멀리서도 잘 본다', speed: 20, farMul: 2, glassesFar: 5, wWatch: 6, wDoze: 0, wPatrol: 2, watchT: [180, 360], dozeT: [0, 0], lookT: [90, 180], relookOf: 0 },
  { name: '졸음형', hint: '자주 졸지만 언제 깰지 모른다', speed: 15, farMul: 1, glassesFar: 0, wWatch: 2, wDoze: 5, wPatrol: 1, watchT: [60, 180], dozeT: [60, 240], lookT: [60, 120], relookOf: 0 },
]

export const START_GRACE = 120 // 시작 직후 감독관이 앞에 서 있는 틱
export const SCORE_BASE = 100 // 정답 하나당 점수
export const BONUS_MAX = 100 // 시간 보너스 상한
export const SCORE_MAX = 1600
export const MAX_ACTION_TICKS = 120
export const SEND_TICKS = 30
export const MAX_CATCHUP = 5
