import { useEffect } from 'react'
import { supabase } from '../../lib/supabase.ts'

// 자유 플레이 기록 대기열 (설계 §11). 저장에 실패하면 localStorage에 보관했다가 다시 보낸다.
// 서버는 client_id가 같은 행을 무시하므로(upsert ignoreDuplicates) 재전송해도 중복 저장되지 않는다.
// played_at은 서버가 정한다.
export type FreePlayRow = {
  client_id: string
  user_id: string
  game_id: string
  options: Record<string, string>
  logic_version: number
  solved: boolean
  score: number
  action_count: number
}

const KEY = 'onlyfms:freeQueue'
export const MAX_QUEUE = 50

function load(): FreePlayRow[] {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? (v as FreePlayRow[]) : []
  } catch {
    return []
  }
}

function save(rows: FreePlayRow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    // 저장소를 쓸 수 없으면 이번 세션의 메모리 대기열만 남는다.
  }
}

// localStorage를 못 쓰는 환경을 위한 메모리 대기열
let memory: FreePlayRow[] = []
let inFlight: Promise<void> | null = null

function read(): FreePlayRow[] {
  const stored = load()
  const seen = new Set(stored.map((r) => r.client_id))
  return [...stored, ...memory.filter((r) => !seen.has(r.client_id))]
}

function write(rows: FreePlayRow[]): void {
  memory = rows
  save(rows)
}

async function sendOne(row: FreePlayRow): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('free_plays')
      .upsert(row, { onConflict: 'client_id', ignoreDuplicates: true })
    return !error
  } catch {
    return false
  }
}

async function doFlush(): Promise<void> {
  const snapshot = read()
  for (const row of snapshot) {
    if (await sendOne(row)) {
      // 보내는 동안 새로 쌓인 행을 지우지 않도록 현재 대기열에서 이 행만 뺀다.
      write(read().filter((r) => r.client_id !== row.client_id))
    }
  }
}

export function flush(): Promise<void> {
  // 이미 보내는 중이면 끝난 뒤 한 번 더 돈다. 그사이 쌓인 행이 다음 접속까지 남지 않게 한다.
  if (inFlight) return inFlight.then(() => flush())
  const p = doFlush().finally(() => {
    if (inFlight === p) inFlight = null
  })
  inFlight = p
  return p
}

export async function submit(row: FreePlayRow): Promise<void> {
  const next = [...read().filter((r) => r.client_id !== row.client_id), row]
  write(next.length > MAX_QUEUE ? next.slice(next.length - MAX_QUEUE) : next)
  await flush()
}

/** 온라인으로 돌아오면 대기열을 비운다. 해제 함수를 돌려준다. */
export function flushOnOnline(): () => void {
  const h = () => void flush()
  window.addEventListener('online', h)
  return () => window.removeEventListener('online', h)
}

/** 앱 어디에 있든 시작할 때와 온라인 복귀 때 대기열을 비운다. 레이아웃에서 한 번 쓴다. */
export function useFreeQueueFlush(): void {
  useEffect(() => {
    void flush()
    return flushOnOnline()
  }, [])
}

/** 테스트용 */
export function resetFreeQueue(): void {
  memory = []
  inFlight = null
}
