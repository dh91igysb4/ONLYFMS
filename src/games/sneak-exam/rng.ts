// 정수 난수. 시뮬·시험 구성은 이 모듈의 난수만 쓴다(Math.random 금지).

// 선형 합동 생성기 한 걸음. 항상 0..2^32-1 정수.
export function nextRng(r: number): number {
  return (Math.imul(r, 1664525) + 1013904223) >>> 0
}

// 0..n-1. 낮은 비트는 주기가 짧아 위 24비트를 쓴다.
export function rngInt(r: number, n: number): number {
  return Math.floor(((r >>> 8) * n) / 16777216)
}

// 32자리 16진수 시드를 8자리씩 4개로 XOR한 뒤 salt를 섞는다.
export function seedInt(seed: string, salt: number): number {
  let x = 0
  for (let i = 0; i < 4; i++) x ^= parseInt(seed.slice(i * 8, i * 8 + 8), 16) >>> 0
  return Math.imul(x ^ salt, 2654435761) >>> 0
}
