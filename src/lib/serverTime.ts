// 서버 시각과 브라우저 시각의 차이를 기억해 두고, 서버 기준 현재 시각을 돌려준다 (설계 §11).
let offset = 0

export function syncFromView(serverNow: number): void {
  if (Number.isFinite(serverNow)) offset = serverNow - Date.now()
}

export function now(): number {
  return Date.now() + offset
}

/** 테스트용 */
export function resetServerTime(): void {
  offset = 0
}
