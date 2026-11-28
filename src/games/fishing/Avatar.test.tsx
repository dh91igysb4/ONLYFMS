import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
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

test('crop="head"면 머리 부분(12×12칸)만 그린다', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ fillRect: vi.fn() }) as unknown as CanvasRenderingContext2D)
  render(<Avatar data="" scale={2} crop="head" />)
  const img = screen.getAllByRole('img').at(-1)!
  expect(img.getAttribute('width')).toBe('24')
  expect(img.getAttribute('height')).toBe('24')
})

describe('칭호(v31)', () => {
  test('전신 그림 아래에 칭호, 얼굴만이면 없음, 깨진 값이면 없음', async () => {
    const { avatarTitle } = await import('./Avatar.tsx')
    expect(avatarTitle(JSON.stringify({ hat: 'cap', title: '용을 낚은 자' }))).toBe('용을 낚은 자')
    expect(avatarTitle('{"hat":"cap"}')).toBeNull()
    expect(avatarTitle('x')).toBeNull()
    expect(avatarTitle(JSON.stringify({ title: 'x'.repeat(25) }))).toBeNull()
  })
})
