import { ApiError } from '../../lib/api.ts'

const MAX_SIDE = 1280
const MAX_BYTES = 1_048_576

/** 긴 쪽을 max로 줄인 크기(작으면 그대로). */
export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const long = Math.max(w, h)
  if (long <= max) return { w, h }
  const k = max / long
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** 사진을 EXIF 방향대로 다시 그려 JPEG로 만든다(메타데이터 제거). */
export async function prepareChatImage(file: File): Promise<Blob> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ApiError('image_unsupported', 0)
  }
  try {
    const { w, h } = fitSize(bmp.width, bmp.height)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ApiError('image_unsupported', 0)
    // JPEG에는 투명이 없어 그냥 그리면 투명한 곳이 검게 된다
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new ApiError('image_unsupported', 0)
    if (blob.size > MAX_BYTES) throw new ApiError('image_too_large', 0)
    return blob
  } finally {
    bmp.close?.()
  }
}
