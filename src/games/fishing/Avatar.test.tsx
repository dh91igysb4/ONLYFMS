import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Avatar } from './Avatar.tsx'
import { DEFAULT_OUTFIT } from './wardrobe.ts'

test('옷차림 JSON을 앞모습으로 그리고, 깨진 값은 기본 옷차림', () => {
  const fill = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ fillRect: fill }) as unknown as CanvasRenderingContext2D)
  render(<Avatar data={JSON.stringify({ ...DEFAULT_OUTFIT, hat: 'straw', top: 'kit-stripes' })} scale={4} />)
  const img = screen.getByRole('img')
  expect(img.getAttribute('aria-label')).toBe('낚시 캐릭터: 모자 밀짚모자, 상의 흑백 줄무늬 유니폼, 하의 남색 바지, 머리 모양 짧은 머리')
  expect(img.getAttribute('width')).toBe('64')
  expect(img.getAttribute('height')).toBe('96')
  expect(fill).toHaveBeenCalled()
  render(<Avatar data="{oops" scale={2} />)
  expect(screen.getAllByRole('img')[1].getAttribute('aria-label')).toContain('모자 청록 비니')
})
