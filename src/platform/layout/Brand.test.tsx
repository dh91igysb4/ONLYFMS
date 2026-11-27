import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Brand, BRAND_INTERVAL_MS } from './Brand.tsx'

function setReducedMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: on && q.includes('reduce'), media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  setReducedMotion(false)
})
afterEach(() => vi.useRealTimers())

const shown = () => document.querySelector('.app-wordmark.is-current')?.textContent

test('스크린리더에는 사이트 이름만, 화면에는 문구가 번갈아 바뀐다', () => {
  vi.setSystemTime(new Date('2026-11-02T09:00:00Z'))
  render(<Brand />)
  expect(screen.getByRole('heading', { level: 1, name: 'playONLYFMS' })).toBeTruthy()
  expect(shown()).toBe('playONLYFMS')
  act(() => { vi.advanceTimersByTime(BRAND_INTERVAL_MS) })
  expect(shown()).toBe('재원이 전역까지 D-490')
  act(() => { vi.advanceTimersByTime(BRAND_INTERVAL_MS) })
  expect(shown()).toBe('playONLYFMS')
})

test('자정을 넘기면 새로고침 없이 숫자가 줄어든다', () => {
  vi.setSystemTime(new Date('2026-11-02T14:59:58Z')) // 11/2 23:59:58 KST
  render(<Brand />)
  act(() => { vi.advanceTimersByTime(BRAND_INTERVAL_MS) })
  expect(shown()).toBe('재원이 전역까지 D-489')
})

test('전역 이후에는 돌지 않는다', () => {
  vi.setSystemTime(new Date('2028-03-07T03:00:00Z'))
  render(<Brand />)
  act(() => { vi.advanceTimersByTime(BRAND_INTERVAL_MS * 3) })
  expect(shown()).toBe('playONLYFMS')
  expect(document.querySelectorAll('.app-wordmark')).toHaveLength(1)
})

test('동작 줄이기에서는 전환 애니메이션 클래스를 붙이지 않는다', () => {
  setReducedMotion(true)
  vi.setSystemTime(new Date('2026-11-02T09:00:00Z'))
  render(<Brand />)
  act(() => { vi.advanceTimersByTime(BRAND_INTERVAL_MS) })
  expect(shown()).toBe('재원이 전역까지 D-490')
  expect(document.querySelector('.app-wordmark.is-leaving')).toBeNull()
})

test('칸 폭은 전역일 문구로 고정하고 사이트 이름을 그 폭에 맞게 줄인다', () => {
  vi.setSystemTime(new Date('2026-11-02T09:00:00Z'))
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.classList.contains('brand-sizer-name') ? 200 : this.classList.contains('brand-sizer') ? 150 : 0
    return { width: w, height: 0, x: 0, y: 0, top: 0, left: 0, right: w, bottom: 0, toJSON() {} } as DOMRect
  })
  render(<Brand />)
  const ticker = document.querySelector<HTMLElement>('.brand-ticker')!
  expect(ticker.style.getPropertyValue('--brand-fit')).toBe('0.750')
  expect(document.querySelector('.brand-sizer:not(.brand-sizer-name)')?.getAttribute('data-text')).toBe('재원이 전역까지 D-490')
  expect(screen.getAllByText('playONLYFMS')).toHaveLength(1)
  rect.mockRestore()
})

test('사이트 이름이 더 좁으면 키우지 않는다', () => {
  vi.setSystemTime(new Date('2026-11-02T09:00:00Z'))
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.classList.contains('brand-sizer-name') ? 100 : this.classList.contains('brand-sizer') ? 150 : 0
    return { width: w, height: 0, x: 0, y: 0, top: 0, left: 0, right: w, bottom: 0, toJSON() {} } as DOMRect
  })
  render(<Brand />)
  expect(document.querySelector<HTMLElement>('.brand-ticker')!.style.getPropertyValue('--brand-fit')).toBe('1.000')
  rect.mockRestore()
})
