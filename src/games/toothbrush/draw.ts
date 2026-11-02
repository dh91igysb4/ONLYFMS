// 양치 캔버스 그리기 (순수 그리기 도우미). 캔버스 안의 색은 테마와 상관없는 고정색이다
// (CLAUDE.md 금지 사항의 예외: 양치 캔버스 내부 색).
import { CELL, H, LH, LW, MAX_THICK, R, W } from './constants.ts'
import { isTooth } from './mask.ts'

const MOUTH = '#3b1e28'
const TOOTH = '#f4f1ea'
const BRUSH = 'rgba(120, 200, 255, 0.9)'

/** 두께 → 플라그 불투명도. 얇은 플라그도 보이게 바닥값을 둔다. */
function plaqueAlpha(t: number): number {
  return 0.2 + (0.8 * Math.min(t, MAX_THICK)) / MAX_THICK
}

export function drawZone(
  g: CanvasRenderingContext2D,
  zone: number,
  thick: readonly number[],
  cursor: readonly [number, number] | null,
): void {
  g.clearRect(0, 0, LW, LH)
  g.fillStyle = MOUTH
  g.fillRect(0, 0, LW, LH)
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c
      if (!isTooth(zone, i)) continue
      g.fillStyle = TOOTH
      g.fillRect(c * CELL, r * CELL, CELL, CELL)
      const t = thick[i]
      if (t > 0) {
        g.fillStyle = `rgba(214, 190, 60, ${plaqueAlpha(t).toFixed(3)})`
        g.fillRect(c * CELL, r * CELL, CELL, CELL)
      }
    }
  }
  if (cursor) {
    g.strokeStyle = BRUSH
    g.lineWidth = 3
    g.beginPath()
    g.arc(cursor[0], cursor[1], (R + 0.5) * CELL, 0, Math.PI * 2)
    g.stroke()
  }
}
