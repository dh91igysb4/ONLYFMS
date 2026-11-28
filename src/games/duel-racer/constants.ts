// 1대1 레이싱 수치 원본 (설계 docs/superpowers/specs/2026-11-28-duel-racer-design.md, 계획 2026-11-28-duel-racer-p1).
// 값은 조율용 시작값이다. 테스트는 이 상수를 import해 비교한다. 외부 의존 없음 (Deno 호환).
// 단위: 미터·초·라디안.

/** 물리 틱 수(초당). 기록은 틱 수로 센다 (설계 §6.3) */
export const TICK_HZ = 60
/** 니트로 없이 낼 수 있는 최고 속도 (m/s, 180km/h) */
export const TOP_SPEED = 50
/** 니트로 분사 중 최고 속도 (m/s) */
export const NITRO_SPEED = 62
/** 정지에서 0.9·TOP_SPEED까지 걸리는 시간 목표 (s) */
export const ACCEL_TIME = 3.0
export const CAR_MASS = 1200
/** 차체 반 크기 (m). 폭 2m, 길이 4.4m */
export const CAR_HALF = { x: 1.0, y: 0.6, z: 2.2 } as const
/** 도로 최소 폭 (m). 차 3~4대가 나란히 (설계 §5.4) */
export const ROAD_MIN_WIDTH = 10
/** 착지 보정이 들어가는 최대 기울기 (도) */
export const LANDING_ASSIST_MAX_DEG = 45
/** 이만큼 못 움직이면 체크포인트로 복귀 (s) */
export const STUCK_SECONDS = 3
/** 이 높이 아래로 떨어지면 복귀 (m) */
export const FALL_Y = -30
/** 니트로를 마지막으로 쓴 뒤(시작 포함) 이만큼 지나면 자동으로 차기 시작 (s) */
export const NITRO_REGEN_DELAY = 3
/** 자동 충전 속도 (게이지/s). 빈 게이지가 약 17초에 가득 */
export const NITRO_REGEN_PER_SEC = 0.06
/** 가득 찬 게이지를 4초에 다 쓴다 */
export const NITRO_BURN_PER_SEC = 0.25
/** 레이스 최대 시간 (s) = manifest duel.realtime.raceSeconds */
export const RACE_SECONDS = 180
export const COURSE_IDS = ['neon-1'] as const

// ---- 온라인 대국(2단계, 설계 §6·§7)
/** 대국 시작(참가) 뒤 출발까지(초) */
export const START_DELAY_SEC = 5
/** 경주 끝 뒤 결과 보고를 기다리는 시간(초) */
export const REPORT_GRACE_SEC = 60
/** 대국 마감(초) = 출발 지연 + 경주 + 보고 유예. manifest turnSeconds의 하나뿐인 선택지 */
export const MATCH_SECONDS = START_DELAY_SEC + RACE_SECONDS + REPORT_GRACE_SEC
