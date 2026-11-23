/** 금액 표기 `1,234 G` */
export function formatGold(n: number): string {
  return `${n.toLocaleString('ko-KR')} G`
}

/** 부호 있는 금액 `+500` / `−200` (빼기 기호 U+2212) */
export function signedGold(n: number): string {
  return n < 0 ? `−${Math.abs(n).toLocaleString('ko-KR')}` : `+${n.toLocaleString('ko-KR')}`
}
