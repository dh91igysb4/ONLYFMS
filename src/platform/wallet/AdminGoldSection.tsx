// /admin "골드" 섹션 (설계 §5.4): 최근 장부와 관리자 조정. 서버 함수가 관리자인지 확인한다.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, errorMessage } from '../../lib/api.ts'
import { duels, games, worlds } from '../../games/index.ts'
import { adminGoldAdjust, adminGoldLedger, type LedgerReason, type LedgerRow } from './api.ts'
import { formatGold, signedGold } from './format.ts'
import './wallet.css'

const LIMIT = 50

export const REASON_LABEL: Record<LedgerReason, string> = {
  migrate: '옛 JWD 이전',
  world: '게임 안',
  free: '자유 플레이',
  daily_prize: '데일리 상금',
  duel_stake: '판돈',
  duel_payout: '판돈 획득',
  duel_refund: '판돈 환불',
  contest_fee: '참가비',
  contest_prize: '대회 상금',
  contest_refund: '참가비 환불',
  admin: '관리자 조정',
}

const ADJUST_ERRORS: Record<string, string> = {
  not_found: '없는 아이디예요',
  not_enough_gold: '잔액보다 많이 뺄 수 없어요',
  note_invalid: '메모를 1~100자로 적어 주세요',
}
const msg = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : 'network'
  return ADJUST_ERRORS[code] ?? errorMessage(code)
}

/** 등록부에서 게임 이름 (게임 분기가 아니라 조회) */
function gameName(id: string): string {
  return [...games, ...duels, ...worlds].find((g) => g.manifest.id === id)?.manifest.name ?? id
}

const KST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
/** KST `MM.DD HH:mm` */
export function kstShort(iso: string): string {
  const p = Object.fromEntries(KST.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.month}.${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

export function AdminGoldSection() {
  const [rows, setRows] = useState<LedgerRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [handle, setHandle] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const r = await adminGoldLedger(LIMIT)
      if (alive.current) { setRows(r); setLoadError(null) }
    } catch (e) {
      if (alive.current) setLoadError(msg(e))
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void load()
    return () => { alive.current = false }
  }, [load])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const raw = amount.trim()
    const delta = /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN
    if (!Number.isSafeInteger(delta) || delta === 0) {
      setResult({ ok: false, text: '금액은 0이 아닌 정수로 적어 주세요' })
      return
    }
    const who = handle.trim()
    setBusy(true)
    setResult(null)
    try {
      const bal = await adminGoldAdjust(who, delta, note.trim())
      if (!alive.current) return
      setResult({ ok: true, text: `반영했어요. ${who} 잔액 ${formatGold(bal)}` })
      setAmount('')
      setNote('')
      await load()
    } catch (err) {
      if (alive.current) setResult({ ok: false, text: msg(err) })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <section className="stack" aria-labelledby="admin-gold-title">
      <h3 className="section-title" id="admin-gold-title">JWD</h3>
      <form className="card admin-gold-form" onSubmit={submit}>
        <label>
          아이디
          <input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="off" required />
        </label>
        <label>
          금액
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="예: 500, -200" required />
        </label>
        <label>
          메모
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} required />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>반영</button>
      </form>
      {result && (
        <p className={`admin-gold-msg${result.ok ? '' : ' is-error'}`} role={result.ok ? 'status' : 'alert'}>{result.text}</p>
      )}

      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {rows === null && !loadError && <p className="muted" role="status">불러오는 중…</p>}
      {rows !== null && rows.length === 0 && <p className="muted">아직 장부가 비어 있어요</p>}
      {rows !== null && rows.length > 0 && (
        <div className="admin-gold-wrap">
          <table className="admin-gold-table">
            <thead>
              <tr>
                <th scope="col">시각</th><th scope="col">아이디</th><th scope="col">이유</th>
                <th scope="col" className="num">금액</th><th scope="col" className="num">잔액</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{kstShort(r.createdAt)}</td>
                  <td>{r.handle ?? '알 수 없음'}</td>
                  <td>
                    {REASON_LABEL[r.reason] ?? r.reason}{r.gameId ? ` · ${gameName(r.gameId)}` : ''}
                    {r.note && <span className="admin-gold-sub">{r.note}</span>}
                  </td>
                  <td className={`num ${r.delta < 0 ? 'minus' : 'plus'}`}>
                    {signedGold(r.delta)}
                    {r.rawDelta !== null && <span className="admin-gold-sub">(상한, 원래 {signedGold(r.rawDelta)})</span>}
                  </td>
                  <td className="num">{r.balanceAfter.toLocaleString('ko-KR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
