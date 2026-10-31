import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (import.meta.env.PROD && (!url || !key)) {
  throw new Error('VITE_SUPABASE_URL 과 VITE_SUPABASE_PUBLISHABLE_KEY 환경변수가 필요해요')
}

export const supabaseUrl = url ?? 'http://localhost:54321'
export const supabaseKey = key ?? 'sb_publishable_missing'

// 개발·테스트에서만 더미 값으로 앱 셸이 동작하도록 한다.
export const supabase = createClient(supabaseUrl, supabaseKey)
