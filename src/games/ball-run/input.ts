// 볼 런 입력 부호화. 틱마다의 목표 x(정수)를 런-길이 쌍 [값, 개수, …]으로 줄여 보낸다.
// 외부 입력(d)은 신뢰하지 않고 검증한다. 화면 쪽 드래그 계산은 부동소수를 허용한다.
import { DRAG_SPAN, MAX_ACTION_TICKS, X_LIMIT } from './constants.ts'

export function encodeInputs(targets: readonly number[]): number[] {
  const out: number[] = []
  let i = 0
  while (i < targets.length) {
    const v = targets[i]
    let n = 1
    while (i + n < targets.length && targets[i + n] === v) n++
    out.push(v, n)
    i += n
  }
  return out
}

export function decodeInputs(d: unknown): number[] | null {
  if (!Array.isArray(d) || d.length < 2 || d.length % 2 !== 0) return null
  let total = 0
  for (let k = 0; k < d.length; k += 2) {
    const v = d[k]
    const n = d[k + 1]
    if (!Number.isInteger(v) || Math.abs(v as number) > X_LIMIT) return null
    if (!Number.isInteger(n) || (n as number) < 1) return null
    total += n as number
    if (total > MAX_ACTION_TICKS) return null
  }
  const out: number[] = []
  for (let k = 0; k < d.length; k += 2) {
    const v = d[k] as number
    const n = d[k + 1] as number
    for (let j = 0; j < n; j++) out.push(v)
  }
  return out
}

export function clampX(x: number): number {
  return Math.max(-X_LIMIT, Math.min(X_LIMIT, Math.round(x)))
}

// 화면 너비에 대한 손가락 이동 비율을 DRAG_SPAN에 곱한다. 너비가 없으면 이동하지 않는다.
export function dragTarget(startTarget: number, dxPx: number, widthPx: number): number {
  if (!(widthPx > 0)) return clampX(startTarget)
  return clampX(startTarget + Math.round((dxPx / widthPx) * DRAG_SPAN))
}
