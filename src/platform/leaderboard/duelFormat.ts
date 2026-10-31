/** 대전 승률: w / (w + d + l)를 백분율 정수로. 판수 0이면 "–". */
export function duelRate(w: number, d: number, l: number): string {
  const n = w + d + l
  return n === 0 ? '–' : `${Math.round((w * 100) / n)}%`
}
