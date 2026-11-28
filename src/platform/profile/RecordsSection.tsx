import { useEffect, useMemo, useState } from 'react'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { duels, games, worlds } from '../../games/index.ts'
import { useAuth } from '../auth/AuthProvider.tsx'

type Row = { game_id: string; key: string; value: number; detail: string | null }

/** 게임 manifest의 `records` 선언과 서버 `user_records`만으로 그린다. 게임별 분기 없음. */
export function RecordsSection({ handle }: { handle: string }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[] | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    setRows(undefined)
    rpc<Row[] | null>('user_records', { p_handle: handle })
      .then((r) => { if (alive) setRows(r ?? []) })
      .catch((e) => { if (alive) setError(errorMessage(e instanceof ApiError ? e.code : 'network')) })
    return () => { alive = false }
  }, [handle, attempt])

  const isAdmin = !!profile?.is_admin
  const declared = useMemo(
    () => [...games, ...duels, ...worlds]
      .filter((g) => g.manifest.records?.length && (!g.manifest.hidden || isAdmin))
      .map((g) => ({ id: g.manifest.id, name: g.manifest.name, records: g.manifest.records ?? [] })),
    [isAdmin],
  )

  return (
    <>
      <h3 className="section-title">기록</h3>
      {error && (
        <div className="stack" role="alert">
          <p className="form-error">기록을 불러오지 못했어요 ({error})</p>
          <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </div>
      )}
      {!error && rows === undefined && <p className="page-note" role="status">불러오는 중…</p>}
      {!error && rows && declared.length === 0 && <p className="muted">아직 기록이 없어요</p>}
      {!error && rows && declared.map((g) => (
        <section key={g.id} className="fm-panel">
          <h4 className="fm-panel-head">{g.name}</h4>
          <ul className="pf-rows" aria-label={`${g.name} 기록`}>
            {g.records.map((r) => {
              const row = rows.find((x) => x.game_id === g.id && x.key === r.key)
              return (
                <li key={r.key} className="fm-row">
                  <span className="fm-row-main">{r.label}</span>
                  <span className="fm-row-value rec-value">
                    {row ? `${row.value.toLocaleString('ko-KR')}${r.unit ?? ''}${row.detail ? ` (${row.detail})` : ''}` : '–'}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </>
  )
}
