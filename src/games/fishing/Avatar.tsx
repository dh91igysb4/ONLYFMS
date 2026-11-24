// 프로필 캐릭터(설계 옷장 §7). 플랫폼 AvatarSection이 getAvatarComponent로 찾아 서버 avatar 문자열(옷차림 JSON)을 넘긴다.
// 앞모습 대기 그림을 캔버스에 그린다. 깨진 값·모르는 옷은 기본 옷차림. 캔버스 내부 색은 낚시 캔버스 예외.
import { useEffect, useRef } from 'react'
import type { AvatarProps } from '../ui.ts'
import { decodeOutfit, playerSprites } from './outfit.ts'
import { drawSpriteData } from './sprites.ts'
import { SLOT_NAMES, WEAR_SLOTS, wearItem } from './wardrobe.ts'

export function Avatar({ data, scale }: AvatarProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const outfit = decodeOutfit(data)
  const sp = playerSprites(outfit)['player-idle-down']
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect?.(0, 0, sp.w * scale, sp.h * scale)
    drawSpriteData(ctx, sp, 0, 0, scale)
  }, [sp, scale])
  const desc = WEAR_SLOTS.filter((s) => s !== 'hairColor' && s !== 'rodSkin')
    .map((s) => `${SLOT_NAMES[s]} ${wearItem(s, outfit[s])?.name ?? ''}`)
    .join(', ')
  return (
    <canvas
      ref={ref}
      className="pf-avatar-canvas"
      width={sp.w * scale}
      height={sp.h * scale}
      style={{ width: sp.w * scale, height: sp.h * scale, imageRendering: 'pixelated' }}
      role="img"
      aria-label={`낚시 캐릭터: ${desc}`}
    />
  )
}
