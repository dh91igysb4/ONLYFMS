// 게임 시계: 실제 1초 = 게임 1분, 게임 하루 = 실제 24분. 브라우저와 Edge Function이 함께 쓰므로
// 순수 함수만 둔다 (Date.now·Math.random·DOM 없음, 시각은 인자로 받는다).

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Weather = 'sun' | 'rain'
export type Conditions = { gameMinute: number; gameDay: number; season: Season; weather: Weather }

export const KST_OFFSET_MS = 9 * 3_600_000
export const GAME_DAY_MS = 1_440_000
// 첫 봄이 시작되는 시각 (KST 2026-11-23 00:00)
export const SEASON_ANCHOR_MS = Date.UTC(2026, 10, 22, 15, 0, 0)
export const RAIN_CHANCE = 0.25

const WEEK_MS = 604_800_000
const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter']

export const SEASON_NAMES: Record<Season, string> = {
  spring: '봄',
  summer: '여름',
  autumn: '가을',
  winter: '겨울',
}

// 음수에도 0 이상을 돌려주는 나머지
function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

// 게임 날짜별 날씨. 32비트 정수 해시를 2^32로 나눈 값이 RAIN_CHANCE 미만이면 비.
export function weatherOf(gameDay: number): Weather {
  let h = (gameDay | 0) ^ 0x9e3779b9
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4_294_967_296 < RAIN_CHANCE ? 'rain' : 'sun'
}

export function conditionsAt(nowMs: number): Conditions {
  const kst = nowMs + KST_OFFSET_MS
  const gameMinute = mod(Math.floor(kst / 1000), 1440)
  const gameDay = Math.floor(kst / GAME_DAY_MS)
  const season = SEASONS[mod(Math.floor((nowMs - SEASON_ANCHOR_MS) / WEEK_MS), 4)]
  return { gameMinute, gameDay, season, weather: weatherOf(gameDay) }
}

// 겨울에 오는 비는 눈으로 보인다(HUD 아이콘·내리는 입자). 출현 조건에서는 그대로 'rain'이다.
export function isSnow(cond: Conditions): boolean {
  return cond.weather === 'rain' && cond.season === 'winter'
}

// [시작시, 끝시) 구간 안인가. 끝이 시작보다 작으면 자정을 넘는 구간.
export function inHours(gameMinute: number, hours: readonly [number, number]): boolean {
  const [from, to] = hours
  const h = gameMinute / 60
  return from <= to ? h >= from && h < to : h >= from || h < to
}

// 20:00~4:59 는 밤
export function isNight(gameMinute: number): boolean {
  return inHours(gameMinute, [20, 5])
}

// 어둠 정도 0~1. 18~20시 0→1, 20~5시 1, 5~6시 1→0.
export function nightLevel(gameMinute: number): number {
  const h = gameMinute / 60
  if (h >= 18 && h < 20) return (h - 18) / 2
  if (h >= 20 || h < 5) return 1
  if (h < 6) return 6 - h
  return 0
}

// 'HH:MM', 분은 10분 단위 내림
export function formatClock(gameMinute: number): string {
  const hh = Math.floor(gameMinute / 60)
  const mm = Math.floor((gameMinute % 60) / 10) * 10
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// ---------------------------------------------------------------- 물때 (낚시 5부)
// 게임 시각의 고정 구간: 썰물 2~6시·14~18시(하루 두 번, 4시간씩). 나머지는 밀물.
export type Tide = 'low' | 'high'
export const LOW_TIDE_HOURS: readonly (readonly [number, number])[] = [[2, 6], [14, 18]]

export function tideAt(gameMinute: number): Tide {
  const m = mod(gameMinute, 1440)
  return LOW_TIDE_HOURS.some((h) => inHours(m, h)) ? 'low' : 'high'
}

/** 다음에 물때가 바뀌는 게임 분(0~1439). HUD·지도 문구용 */
export function nextTideChange(gameMinute: number): number {
  const m = mod(gameMinute, 1440)
  const edges = LOW_TIDE_HOURS.flatMap(([from, to]) => [from * 60, to * 60]).sort((a, b) => a - b)
  return edges.find((e) => e > m) ?? edges[0]
}
