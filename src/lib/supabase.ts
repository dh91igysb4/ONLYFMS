import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

// 환경변수가 없으면 앱 셸과 테스트는 그대로 동작하도록 더미 값을 쓴다.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'sb_publishable_missing')
