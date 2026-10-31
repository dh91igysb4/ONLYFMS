import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const rpcMock = vi.fn()
const refreshMock = vi.fn()
const applyMock = vi.fn()
let profile: Record<string, unknown> | null = null

vi.mock('../../lib/supabase.ts', () => ({ supabase: {}, supabaseUrl: 'x', supabaseKey: 'k' }))
vi.mock('../../lib/api.ts', async (orig) => ({
  ...(await orig<typeof import('../../lib/api.ts')>()),
  rpc: (...a: unknown[]) => rpcMock(...a),
}))
vi.mock('../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ profile, refresh: refreshMock }),
}))
vi.mock('../../app/appearance.ts', () => ({
  applyAppearance: (...a: unknown[]) => applyMock(...a),
  resolveMode: (a: string) => (a === 'light' ? 'light' : 'dark'),
}))

import { ApiError } from '../../lib/api.ts'
import { AppearanceSettings } from './AppearanceSettings.tsx'

beforeEach(() => {
  rpcMock.mockReset()
  refreshMock.mockReset()
  applyMock.mockReset()
  refreshMock.mockResolvedValue(undefined)
  profile = { handle: 'kane', palette: 'navy', appearance: 'light' }
})

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement

test('renders_current_choice', () => {
  render(<AppearanceSettings />)
  expect(radio('미드나잇 네이비').checked).toBe(true)
  expect(radio('라이트').checked).toBe(true)
})

test('defaults_when_missing', () => {
  profile = { handle: 'kane' }
  render(<AppearanceSettings />)
  expect(radio('기본 보라').checked).toBe(true)
  expect(radio('다크').checked).toBe(true)
})

test('pick_applies_and_saves', async () => {
  rpcMock.mockResolvedValue(null)
  render(<AppearanceSettings />)
  fireEvent.click(radio('인디고'))
  expect(applyMock).toHaveBeenCalledWith('indigo', 'light')
  expect(rpcMock).toHaveBeenCalledWith('set_appearance', { p_palette: 'indigo', p_appearance: 'light' })
  await waitFor(() => expect(refreshMock).toHaveBeenCalled())
})

test('disabled_while_saving', () => {
  rpcMock.mockReturnValue(new Promise(() => {}))
  render(<AppearanceSettings />)
  fireEvent.click(radio('인디고'))
  const radios = screen.getAllByRole('radio') as HTMLInputElement[]
  expect(radios.length).toBe(13)
  expect(radios.every((r) => r.disabled)).toBe(true)
})

test('failure_reverts_and_alerts', async () => {
  rpcMock.mockRejectedValue(new ApiError('appearance_invalid', 400))
  render(<AppearanceSettings />)
  fireEvent.click(radio('인디고'))
  expect((await screen.findByRole('alert')).textContent).toBe('화면 설정 값이 올바르지 않아요')
  expect(applyMock).toHaveBeenLastCalledWith('navy', 'light')
  expect(radio('미드나잇 네이비').checked).toBe(true)
  expect(refreshMock).not.toHaveBeenCalled()
})
