import { expect, test } from 'vitest'
import { safeRedirect } from './redirect.ts'

test('keeps same-site paths', () => {
  expect(safeRedirect('/join/ABC123')).toBe('/join/ABC123')
  expect(safeRedirect('/contests/1?tab=board')).toBe('/contests/1?tab=board')
})

test('falls back for empty or off-site targets', () => {
  for (const bad of [
    null, undefined, '', 'evil.com', 'https://evil.com', '//evil.com', '/\\evil.com', '\\/evil.com',
    '/%09/evil.com', '/\t/evil.com', '/%2F/evil.com', '/%5Cevil.com', '/ /evil.com', '/\n/evil.com',
    '/%E0%A4%A', 'javascript:alert(1)',
  ]) {
    expect(safeRedirect(bad), String(bad)).toBe('/')
  }
})
