import { supabase } from '../../lib/supabase.ts'
// 순환 import: 상대 모듈은 함수 안에서만 호출하고 모듈 최상위에서는 쓰지 않으므로 안전하다
import { pendingIds } from './freeQueue.ts'

// 자유 플레이 행동 로그 대기열 (설계 §5.3). 점수 대기열(freeQueue)과 키·메모리를 따로 쓴다.
// 로그는 점수 행(free_plays)이 서버에 있어야 저장되므로, 점수 행이 대기 중이면 건너뛴다.
export type FreeLogRow = { client_id: string; user_id: string; seed: string; actions: unknown[]; attempts: number }

export const MAX_LOG_QUEUE = 10
export const LOG_KEY = 'onlyfms:freeLogQueue'
const MAX_FK_ATTEMPTS = 3

function load(): FreeLogRow[] {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? (v as FreeLogRow[]) : []
  } catch {
    return []
  }
}

function save(rows: FreeLogRow[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(rows))
  } catch {
    // 저장소를 쓸 수 없으면 이번 세션의 메모리 대기열만 남는다.
  }
}

let memory: FreeLogRow[] = []
let inFlight: Promise<void> | null = null

function read(): FreeLogRow[] {
  const stored = load()
  const seen = new Set(stored.map((r) => r.client_id))
  return [...stored, ...memory.filter((r) => !seen.has(r.client_id))]
}

function write(rows: FreeLogRow[]): void {
  memory = rows
  save(rows)
}

type Outcome = 'ok' | 'drop' | 'fk' | 'keep'

async function sendOne(row: FreeLogRow): Promise<Outcome> {
  try {
    const { attempts: _attempts, ...body } = row
    void _attempts
    const { error } = await supabase
      .from('free_play_logs')
      .upsert(body, { onConflict: 'client_id', ignoreDuplicates: true })
    if (!error) return 'ok'
    const code = (error as { code?: string }).code
    if (code === '23503') return 'fk'
    if (code === '42501' || code === '23514') return 'drop'
    return 'keep'
  } catch {
    return 'keep'
  }
}

async function doFlush(): Promise<void> {
  const snapshot = read()
  const skip = pendingIds()
  for (const row of snapshot) {
    if (skip.has(row.client_id)) continue
    const out = await sendOne(row)
    if (out === 'ok' || out === 'drop') {
      write(read().filter((r) => r.client_id !== row.client_id))
    } else if (out === 'fk') {
      const attempts = row.attempts + 1
      write(
        attempts >= MAX_FK_ATTEMPTS
          ? read().filter((r) => r.client_id !== row.client_id)
          : read().map((r) => (r.client_id === row.client_id ? { ...r, attempts } : r)),
      )
    }
  }
}

export function flushLogs(): Promise<void> {
  // 이미 보내는 중이면 끝난 뒤 한 번 더 돈다.
  if (inFlight) return inFlight.then(() => flushLogs())
  const p = doFlush().finally(() => {
    if (inFlight === p) inFlight = null
  })
  inFlight = p
  return p
}

/** 로그를 대기열에 넣고, 점수 행 전송(after)이 끝나면 로그를 보낸다. 점수 기록에는 영향을 주지 않는다. */
export async function submitLog(row: Omit<FreeLogRow, 'attempts'>, after: Promise<void>): Promise<void> {
  try {
    const next = [...read().filter((r) => r.client_id !== row.client_id), { ...row, attempts: 0 }]
    write(next.length > MAX_LOG_QUEUE ? next.slice(next.length - MAX_LOG_QUEUE) : next)
    await after.catch(() => undefined)
    await flushLogs()
  } catch {
    // 로그는 최선 노력이다.
  }
}

/** 테스트용 */
export function resetFreeLogQueue(): void {
  memory = []
  inFlight = null
}
