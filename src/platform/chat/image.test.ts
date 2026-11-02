import { afterEach, expect, test, vi } from 'vitest'
import { fitSize, prepareChatImage } from './image.ts'
import { ApiError } from '../../lib/api.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('fitSize', () => {
  expect(fitSize(4000, 3000)).toEqual({ w: 1280, h: 960 })
  expect(fitSize(3000, 4000)).toEqual({ w: 960, h: 1280 })
  expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 })
  expect(fitSize(1280, 1280)).toEqual({ w: 1280, h: 1280 })
})

function stubCanvas(size: number) {
  const ctx = { drawImage: vi.fn() }
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') throw new Error('unexpected ' + tag)
    return {
      width: 0, height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void) => cb({ size, type: 'image/jpeg' } as Blob),
    }
  }) as unknown as typeof document.createElement)
  return ctx
}

test('디코딩 실패는 image_unsupported', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad')))
  await expect(prepareChatImage(new File(['x'], 'a.heic'))).rejects.toMatchObject({
    code: 'image_unsupported', status: 0,
  })
})

test('1MB 초과는 image_too_large', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }))
  stubCanvas(1_048_577)
  const e = await prepareChatImage(new File(['x'], 'a.jpg')).catch((x) => x)
  expect(e).toBeInstanceOf(ApiError)
  expect(e.code).toBe('image_too_large')
})

test('정상: EXIF 방향 옵션과 축소 크기로 그린다', async () => {
  const bmp = { width: 4000, height: 3000, close: vi.fn() }
  const cib = vi.fn().mockResolvedValue(bmp)
  vi.stubGlobal('createImageBitmap', cib)
  const ctx = stubCanvas(1_048_576)
  const blob = await prepareChatImage(new File(['x'], 'a.jpg'))
  expect(blob.size).toBe(1_048_576)
  expect(cib.mock.calls[0][1]).toEqual({ imageOrientation: 'from-image' })
  expect(ctx.drawImage).toHaveBeenCalledWith(bmp, 0, 0, 1280, 960)
})
