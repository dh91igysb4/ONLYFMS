// 상점 목록에 보이는 차 미리보기: 작은 캔버스에 바퀴 둘과 그 차 그림(배경 투명). 평지에 선 옆모습이다.
import { useEffect, useRef } from 'react'
import { WHEELBASE, WHEEL_R } from './constants.ts'
import { paintCar } from './render.ts'

// 차 좌표(mm): 꼬리 -280 ~ 앞끝 1680(바퀴 220 mm와 빛 번짐), 바닥 -260(바퀴 바닥) ~ 위 740(가장 높은 지붕 705).
const A0 = -280
const A1 = 1680
const B0 = -260
const B1 = 740

/** size는 캔버스 가로 px(세로는 그림 비율에 맞춘다). */
export function CarPreview({ itemId, size }: { itemId: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const k = size / (A1 - A0) // px / mm
  const height = Math.ceil((B1 - B0) * k)

  useEffect(() => {
    const canvas = ref.current
    const c = canvas?.getContext('2d')
    if (!canvas || !c) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(height * dpr)
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, size, height)
    const y = B1 * k
    const R = { x: -A0 * k, y }
    const F = { x: (-A0 + WHEELBASE / 16) * k, y }
    paintCar(c, itemId, R, F, F.x - R.x, (WHEEL_R / 16) * k)
  }, [itemId, size, height, k])

  return <canvas ref={ref} role="img" aria-label="차 미리보기" style={{ width: size, height, display: 'block' }} />
}
