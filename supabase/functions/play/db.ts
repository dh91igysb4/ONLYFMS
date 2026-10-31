// postgres.js 연결과 트랜잭션 헬퍼. Edge Function은 소유자(서비스) 연결이라 RLS를 우회한다.
import postgres from 'postgres'

export type Sql = postgres.Sql
export type Tx = postgres.TransactionSql

/** Supabase 풀러(트랜잭션 모드)에서도 되도록 prepared statement를 끈다 */
export function createSql(url: string): Sql {
  return postgres(url, { prepare: false, onnotice: () => {} })
}

/** 주입된 연결로 트랜잭션을 연다. 예외면 롤백된다 */
export function txOn(sql: Sql) {
  return <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => sql.begin(fn) as Promise<T>
}

let defaultSql: Sql | null = null
/** SUPABASE_DB_URL 연결의 트랜잭션 (계획 인터페이스) */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!defaultSql) {
    const url = Deno.env.get('SUPABASE_DB_URL')
    if (!url) throw new Error('SUPABASE_DB_URL is not set')
    defaultSql = createSql(url)
  }
  return txOn(defaultSql)(fn)
}
