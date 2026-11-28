// 상점 옵션 고정. 경쟁 모드(데일리·대회·대전)는 `shop: true` 옵션을 manifest default로 되돌려 쓴다.
import type { Manifest } from './types.ts'

export function pinShopOptions(manifest: Manifest, options: Record<string, string>): Record<string, string> {
  const out = { ...options }
  for (const o of manifest.options) if (o.shop) out[o.key] = o.default
  return out
}
