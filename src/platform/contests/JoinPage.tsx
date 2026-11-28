import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, errorMessage, rpc } from '../../lib/api.ts'
import { formatGold } from '../wallet/format.ts'
import { refreshWallet, useWallet } from '../wallet/useWallet.ts'
import { walletEnabled } from '../wallet/enabled.ts'
import { mismatchFee } from './fee.ts'
import '../wallet/wallet.css'

/**
 * 초대 링크 참가. 참가비 0으로 먼저 들어가 보고, 참가비 대회면 서버가 fee_mismatch로 지금 참가비를 알려 주므로
 * 확인 화면("참가비 N G 내고 참가")을 한 번 거친다(지갑 설계 §10). 참가비 0 대회는 지금처럼 바로 들어간다.
 */
export function JoinPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { balance } = useWallet()
  const [error, setError] = useState<string | null>(null)
  const [confirmFee, setConfirmFee] = useState<number | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const started = useRef(-1)

  async function tryJoin(fee: number): Promise<void> {
    try {
      const id = await rpc<string>('join_by_invite_code', fee > 0 ? { p_code: code, p_entry_fee: fee } : { p_code: code })
      if (fee > 0) void refreshWallet()
      navigate(`/contests/${id}`, { replace: true })
    } catch (e) {
      const c = e instanceof ApiError ? e.code : 'network'
      const real = mismatchFee(e)
      if (real !== null && real > 0 && walletEnabled()) {
        setConfirmFee(real)
        setConfirmError(null)
        return
      }
      if (fee > 0 && c === 'not_enough_gold') {
        setConfirmError(errorMessage(c))
        return
      }
      setConfirmFee(null)
      setError(errorMessage(c))
    }
  }

  useEffect(() => {
    if (started.current === attempt) return // StrictMode 중복 호출 방지
    started.current = attempt
    setError(null)
    void tryJoin(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, attempt])

  if (confirmFee !== null) {
    const short = balance !== null && balance < confirmFee
    return (
      <div className="stack" role="group" aria-label="참가 확인">
        <h2 className="page-title">참가비가 있는 대회예요</h2>
        <p>
          참가비 <strong className="stake-amount">{formatGold(confirmFee)}</strong>를 내고 참가할까요?
          {balance !== null && <span className="muted"> · 보유 {formatGold(balance)}</span>}
        </p>
        <p className="muted">모인 참가비를 1~3등이 6:3:1로 나눠 가져요. 대회가 취소되면 돌려받아요.</p>
        {(short || confirmError) && <p className="form-error" role="alert">{confirmError ?? 'JWD가 부족해요'}</p>}
        <button
          className="btn btn-primary"
          disabled={busy || short}
          onClick={async () => {
            setBusy(true)
            try { await tryJoin(confirmFee) } finally { setBusy(false) }
          }}
        >
          참가비 {formatGold(confirmFee)} 내고 참가
        </button>
        <Link className="btn btn-ghost btn-link" to="/contests">그만두기</Link>
      </div>
    )
  }

  if (!error) return <p className="page-note" role="status">참가하는 중…</p>
  return (
    <div className="stack" role="alert">
      <p className="form-error">{error}</p>
      <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
      <Link className="btn btn-ghost btn-link" to="/contests">대회 목록</Link>
    </div>
  )
}
