import { vi } from 'vitest'
import type { Profile } from './AuthProvider.tsx'

// supabase 모듈 mock이 공유하는 상태. 각 테스트에서 setAuth로 바꾼다.
export const mocks = {
  session: null as unknown,
  profile: null as Profile | null,
  rpc: vi.fn(),
  signInWithOAuth: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(async () => ({ error: null })),
}

export function setAuth(profile: Profile | null, loggedIn = true) {
  mocks.session = loggedIn ? { access_token: 't', user: { id: 'u1' } } : null
  mocks.profile = profile
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'my_profile' ? { data: mocks.profile, error: null } : { data: null, error: null },
  )
}

export const supabaseMock = () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mocks.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: (...a: unknown[]) => (mocks.signInWithOAuth as (...x: unknown[]) => unknown)(...a),
      signOut: () => mocks.signOut(),
    },
    rpc: (...a: unknown[]) => (mocks.rpc as (...x: unknown[]) => unknown)(...a),
  },
  supabaseUrl: 'http://localhost:54321',
  supabaseKey: 'k',
})
