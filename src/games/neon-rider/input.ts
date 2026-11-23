// 네온 라이더 입력 부호화. 틱마다의 누름 여부를 런 길이 [뗌, 누름, 뗌, …]으로 줄여 보낸다.
// 외부 입력(d)은 신뢰하지 않고 검증한다.
import { MAX_ACTION_TICKS, MAX_RUNS } from './constants.ts'

export function encodeHold(bits: readonly boolean[]): number[] {
  const out: number[] = []
  let cur = false
  let n = 0
  for (const b of bits) {
    if (b === cur) {
      n++
    } else {
      out.push(n)
      cur = b
      n = 1
    }
  }
  out.push(n)
  return out
}

export function decodeHold(d: unknown): boolean[] | null {
  if (!Array.isArray(d) || d.length < 1 || d.length > MAX_RUNS) return null
  let total = 0
  for (let k = 0; k < d.length; k++) {
    const n = d[k]
    if (!Number.isInteger(n) || (n as number) < 0) return null
    if (n === 0 && k > 0) return null
    total += n as number
    if (total > MAX_ACTION_TICKS) return null
  }
  if (total < 1) return null
  const out: boolean[] = []
  for (let k = 0; k < d.length; k++) {
    const n = d[k] as number
    for (let j = 0; j < n; j++) out.push(k % 2 === 1)
  }
  return out
}
