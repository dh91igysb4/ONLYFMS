import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase.ts'
import { rpc } from '../../lib/api.ts'

export type Profile = {
  id: string
  handle: string | null
  status: 'pending' | 'approved' | 'rejected'
  is_admin: boolean
}

type AuthValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  refresh(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

async function loadProfile(): Promise<Profile | null> {
  try {
    const row = await rpc<Profile | Profile[] | null>('my_profile')
    return (Array.isArray(row) ? row[0] : row) ?? null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const sessionRef = useRef<Session | null>(null)

  const applySession = useCallback(async (next: Session | null) => {
    sessionRef.current = next
    setSession(next)
    if (!next) {
      setProfile(null)
      setLoading(false)
      return
    }
    const p = await loadProfile()
    if (sessionRef.current === next) {
      setProfile(p)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) void applySession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return
      // 같은 사용자의 토큰 갱신이면 로딩 화면 없이 세션만 교체한다.
      if (next && sessionRef.current?.user.id === next.user.id) {
        sessionRef.current = next
        setSession(next)
        return
      }
      setLoading(true)
      // onAuthStateChange 콜백 안에서 supabase 호출이 막히지 않도록 다음 틱으로 미룬다.
      setTimeout(() => void applySession(next), 0)
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [applySession])

  const refresh = useCallback(async () => {
    if (!sessionRef.current) return
    setProfile(await loadProfile())
  }, [])

  const value = useMemo(() => ({ session, profile, loading, refresh }), [session, profile, loading, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서만 쓸 수 있어요')
  return ctx
}
