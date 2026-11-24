/** 금액 표기 `1,234 G` */
export function formatGold(n: number): string {
  return `${n.toLocaleString('ko-KR')} G`
}

/** 부호 있는 금액 `+500` / `−200` (빼기 기호 U+2212) */
export function signedGold(n: number): string {
  return n < 0 ? `−${Math.abs(n).toLocaleString('ko-KR')}` : `+${n.toLocaleString('ko-KR')}`
}

/** 도전과제 보너스 배율 표기: 140 → "×2.4", 0 → "×1", 15 → "×1.15" */
export function formatMultiplier(pct: number): string {
  const m = (100 + Math.max(0, Math.floor(pct))) / 100
  return `×${m.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`
}
