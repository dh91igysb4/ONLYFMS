import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const auth = vi.hoisted(() => ({ isAdmin: false }))
vi.mock('../auth/AuthProvider.tsx', () => ({ useAuth: () => ({ profile: { id: 'u1', handle: 'kane', is_admin: auth.isAdmin } }) }))
const reg = vi.hoisted(() => ({ worlds: [] as { manifest: Record<string, unknown> }[] }))
vi.mock('../../games/index.ts', () => ({ get worlds() { return reg.worlds } }))
vi.mock('../../games/ui.ts', () => ({ getWorldPreview: (id: string) => (id === 'w1' || id === 'w2' ? () => null : undefined) }))

import { ValleyButton } from './ValleyButton.tsx'

const m = (id: string, extra: Record<string, unknown> = {}) => ({ manifest: { id, name: `월드 ${id}`, hidden: false, preview: true, ...extra } })
const mount = () => render(<MemoryRouter><ValleyButton /></MemoryRouter>)

beforeEach(() => { auth.isAdmin = false; reg.worlds = [] })

test('짧은 이름이 있으면 짧은 이름, 없으면 이름', () => {
  reg.worlds = [m('w1')]
  mount()
  expect(screen.getByRole('link', { name: '월드 w1 들어가기' }).textContent).toContain('월드 w1')
})

test('숨김 게임은 관리자에게만', () => {
  reg.worlds = [m('w1', { hidden: true, shortName: '숨' })]
  const { unmount } = mount()
  expect(screen.queryByRole('link')).toBeNull()
  unmount()
  auth.isAdmin = true
  mount()
  expect(screen.getByRole('link', { name: '월드 w1 들어가기' }).textContent).toContain('숨')
})

test('미리보기가 없는 지속형 게임만 있으면 버튼이 없다', () => {
  reg.worlds = [m('w9')]
  mount()
  expect(screen.queryByRole('link')).toBeNull()
})
