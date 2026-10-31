// WebCrypto HMAC 시드 + sfc32 결정적 난수. 외부 의존 없음(브라우저·Deno·Node 공용).
export async function hmacSeed(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message))
  return new Uint8Array(sig)
}

// 시드 앞 16바이트를 sfc32 상태 4개(32비트, 빅엔디안)로 사용한다.
export function rngFromSeed(seed: Uint8Array): () => number {
  if (seed.length < 16) throw new Error('seed must be at least 16 bytes')
  const view = new DataView(seed.buffer, seed.byteOffset, seed.byteLength)
  let a = view.getUint32(0), b = view.getUint32(4), c = view.getUint32(8), d = view.getUint32(12)
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 12; i++) next() // 워밍업
  return next
}
