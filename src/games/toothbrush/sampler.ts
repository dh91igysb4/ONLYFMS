import { MAX_SAMPLES } from './logic'

export const TICK_MS = 1000 / 60
export const GAP_MS = 250
const EPS = 1e-9

/** 포인터 이벤트와 rAF 시각을 60Hz 샘플 열로 바꾼다(DOM 없음). */
export class Sampler {
  started = false
  private last: number | null = null
  private acc = 0
  private touching = false
  private px = 0
  private py = 0
  private origin: [number, number] | null = null
  private buf: number[] = []

  down(x: number, y: number): void {
    if (!this.started) {
      this.started = true
      this.last = null
      this.acc = 0
    }
    this.touching = true
    this.px = x
    this.py = y
  }

  move(x: number, y: number): void {
    this.px = x
    this.py = y
  }

  up(): void {
    this.touching = false
  }

  frame(now: number): void {
    if (!this.started || this.last === null) {
      this.last = now
      return
    }
    const dt = now - this.last
    this.last = now
    if (dt > GAP_MS) {
      this.acc = 0
      this.origin = null
      this.buf.push(-1, -1)
      return
    }
    this.acc += dt
    const n = Math.floor(this.acc / TICK_MS + EPS)
    if (n <= 0) return
    this.acc = Math.max(0, this.acc - n * TICK_MS)
    if (!this.touching) {
      for (let i = 0; i < n; i++) this.buf.push(-1, -1)
      this.origin = null
      return
    }
    const [x0, y0] = this.origin ?? [this.px, this.py]
    const x1 = this.px
    const y1 = this.py
    for (let i = 1; i <= n; i++) {
      this.buf.push(x0 + Math.floor(((x1 - x0) * i) / n), y0 + Math.floor(((y1 - y0) * i) / n))
    }
    this.origin = [x1, y1]
  }

  take(): number[] {
    const out = this.buf
    this.buf = []
    return out
  }
}

export function chunk(flat: number[], max = MAX_SAMPLES): number[][] {
  const out: number[][] = []
  for (let i = 0; i < flat.length; i += 2 * max) out.push(flat.slice(i, i + 2 * max))
  return out
}
