// 프로필 캐릭터(설계 옷장 §7). 플랫폼 AvatarSection이 getAvatarComponent로 찾아 서버 avatar 문자열(옷차림 JSON)을 넘긴다.
// 앞모습 대기 그림을 캔버스에 그린다. 깨진 값·모르는 옷은 기본 옷차림. 캔버스 내부 색은 낚시 캔버스 예외.
import { useEffect, useRef } from 'react'
import type { AvatarProps } from '../ui.ts'
import { decodeOutfit, playerSprites } from './outfit.ts'
import { drawSpriteData } from './sprites.ts'
import { SLOT_NAMES, WEAR_SLOTS, wearItem } from './wardrobe.ts'

/** 서버 avatar 문자열의 칭호(v31 logic.avatar가 옷차림과 함께 넣는다). 없거나 깨졌으면 null */
export function avatarTitle(data: string): string | null {
  try {
    const v = JSON.parse(data) as { title?: unknown }
    return typeof v.title === 'string' && v.title.length > 0 && v.title.length <= 24 ? v.title : null
  } catch {
    return null
  }
}

/** 앞모습 대기 그림(16×24칸)에서 머리 부분: 왼쪽 2칸부터 12×12칸(낚싯대 칸은 뺀다) */
const HEAD = { x: 2, y: 0, size: 12 }

export function Avatar({ data, scale, crop }: AvatarProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const outfit = decodeOutfit(data)
  const sp = playerSprites(outfit)['player-idle-down']
  const head = crop === 'head'
  const w = (head ? HEAD.size : sp.w) * scale
  const h = (head ? HEAD.size : sp.h) * scale
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect?.(0, 0, w, h)
    drawSpriteData(ctx, sp, head ? -HEAD.x * scale : 0, head ? -HEAD.y * scale : 0, scale)
  }, [sp, scale, head, w, h])
  const desc = WEAR_SLOTS.filter((s) => s !== 'hairColor' && s !== 'rodSkin')
    .map((s) => `${SLOT_NAMES[s]} ${wearItem(s, outfit[s])?.name ?? ''}`)
    .join(', ')
  // 칭호는 전신 그림(프로필)에만 아래에 붙인다. 얼굴만(명예의 전당 액자)일 때는 없다
  const title = head ? null : avatarTitle(data)
  return (
    <>
    <canvas
      ref={ref}
      className="pf-avatar-canvas"
      width={w}
      height={h}
      style={{ width: w, height: h, imageRendering: 'pixelated' }}
      role="img"
      aria-label={`낚시 캐릭터: ${desc}`}
    />
    {/* 프로필 화면에는 fishing.css가 없어 글자 모양을 직접 둔다(색은 토큰) */}
    {title && <span className="fish-avatar-title" style={{ display: 'block', marginTop: 4, fontSize: 12, fontWeight: 600, color: 'var(--accent-strong)', textAlign: 'center' }}>{title}</span>}
    </>
  )
}
