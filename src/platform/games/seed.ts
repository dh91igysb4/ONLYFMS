// 자유 플레이 출제 시드: 16바이트 난수와 그 소문자 hex 표기(32자).
export function newSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

export function seedHex(seed: Uint8Array): string {
  return Array.from(seed, (b) => b.toString(16).padStart(2, '0')).join('')
}
