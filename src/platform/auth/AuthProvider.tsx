import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase.ts'
import { ApiError, onAccessDenied, rpc } from '../../lib/api.ts'

export type Profile = {
  id: string
  handle: string | null
  status: 'pending' | 'approved' | 'rejected'
  is_admin: boolean
  palette?: string
  home_layout?: unknown
  appearance?: string
}

type AuthValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** 프로필을 불러오지 못했을 때의 오류 코드. 프로필이 없는 것과 구분한다. */
  error: string | null
  refresh(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

type Loaded = { ok: true; profile: Profile | null } | { ok: false; code: string }

async function loadProfile(): Promise<Loaded> {
  try {
    const row = await rpc<Profile | Profile[] | null>('my_profile')
    return { ok: true, profile: (Array.isArray(row) ? row[0] : row) ?? null }
  } catch (e) {
    return { ok: false, code: e instanceof ApiError ? e.code : 'unknown' }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<Session | null>(null)

  const applySession = useCallback(async (next: Session | null) => {
    sessionRef.current = next
    setSession(next)
    if (!next) {
      setProfile(null)
      setError(null)
      setLoading(false)
      return
    }
    setProfile(null)
    const r = await loadProfile()
    if (sessionRef.current === next) {
      if (r.ok) {
        setProfile(r.profile)
        setError(null)
      } else {
        setError(r.code)
      }
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
    const r = await loadProfile()
    if (r.ok) {
      setProfile(r.profile)
      setError(null)
    } else {
      setError(r.code) // 이전 프로필은 그대로 둔다
    }
  }, [])

  // 요청이 승인 문제로 거부되면 프로필을 다시 읽는다. 승인이 취소됐으면 가드가 /welcome으로 보낸다.
  // 이미 다시 읽는 중이면 겹쳐 부르지 않는다.
  const refreshing = useRef(false)
  useEffect(() => onAccessDenied(() => {
    if (refreshing.current) return
    refreshing.current = true
    void refresh().finally(() => { refreshing.current = false })
  }), [refresh])

  const value = useMemo(() => ({ session, profile, loading, error, refresh }), [session, profile, loading, error, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서만 쓸 수 있어요')
  return ctx
}
