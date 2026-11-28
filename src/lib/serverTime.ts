// 서버 시각과 브라우저 시각의 차이를 기억해 두고, 서버 기준 현재 시각을 돌려준다 (설계 §11).
// server_now는 응답을 만들기 전에 찍히고 오는 데 시간이 걸리므로 표본은 실제 차이보다 늘 작게 나온다.
// 그래서 지연이 가장 적었던(가장 큰) 표본을 남긴다. 더 늦게 온 표본으로 시계를 뒤로 돌리지 않아 실시간 대전 화면이
// 몇 초마다 흔들리지 않는다(레이싱 최종 리뷰 I3). 기기 시계를 바꾼 것처럼 크게 벗어나면 새 표본을 그대로 받는다.
const JUMP_MS = 5000
let offset = 0
let synced = false

export function syncFromView(serverNow: number): void {
  if (!Number.isFinite(serverNow)) return
  const sample = serverNow - Date.now()
  if (!synced || sample > offset || offset - sample > JUMP_MS) offset = sample
  synced = true
}

export function now(): number {
  return Date.now() + offset
}

/** 테스트용 */
export function resetServerTime(): void {
  offset = 0
  synced = false
}
