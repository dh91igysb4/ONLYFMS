import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, duel, duelErrorMessage } from '../../lib/api.ts'
import { refreshWallet, useWallet } from '../wallet/useWallet.ts'
import { formatGold } from '../wallet/format.ts'
import '../wallet/wallet.css'

/** stake_mismatch 본문의 실제 판돈 */
function mismatchStake(e: unknown): number | null {
  if (!(e instanceof ApiError) || e.code !== 'stake_mismatch') return null
  const s = (e.body as { stake?: unknown } | undefined)?.stake
  return typeof s === 'number' && Number.isInteger(s) && s >= 0 ? s : null
}

/**
 * 초대 링크 참가. 판돈 0으로 먼저 들어가 보고, 판돈 대국이면 서버가 stake_mismatch로 실제 판돈을 알려 주므로
 * 확인 화면("판돈 N G를 걸고 참가할까요?")을 한 번 거친다(지갑 설계 §9). 판돈 0 대국은 지금처럼 바로 들어간다.
 */
export function DuelJoinPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { balance } = useWallet()
  const [error, setError] = useState<{ code: string; text: string } | null>(null)
  const [confirmStake, setConfirmStake] = useState<number | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const started = useRef(-1)

  /** 참가 요청. 실패면 다음 화면을 정한다 */
  async function tryJoin(stake: number): Promise<void> {
    try {
      const v = await duel({ action: 'join', code, stake })
      if (stake > 0) void refreshWallet()
      navigate(`/duel/${v.match_id}`, { replace: true })
    } catch (e) {
      const c = e instanceof ApiError ? e.code : 'network'
      const real = mismatchStake(e)
      if (real !== null && real > 0) {
        setConfirmStake(real)
        setConfirmError(null)
        return
      }
      if (c === 'own_match') {
        // 자기 대국 링크: 서버가 실어 준 id로 그 대국 화면에 간다
        const id = ((e as ApiError).body as { match_id?: unknown } | undefined)?.match_id
        if (typeof id === 'string' && id) return navigate(`/duel/${id}`, { replace: true })
      }
      // 확인 화면에서 생긴 잔액 부족은 그 화면에 띄운다
      if (stake > 0 && c === 'not_enough_gold') {
        setConfirmError(duelErrorMessage(c))
        return
      }
      setConfirmStake(null)
      setError({ code: c, text: duelErrorMessage(c) })
    }
  }

  useEffect(() => {
    if (started.current === attempt) return // StrictMode 중복 호출 방지
    started.current = attempt
    setError(null)
    void tryJoin(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, attempt])

  if (confirmStake !== null) {
    const short = balance !== null && balance < confirmStake
    return (
      <section className="card stake-confirm" aria-label="판돈 확인">
        <p className="card-title">판돈 {formatGold(confirmStake)}를 걸고 참가할까요?</p>
        <p className="muted">
          이기면 {formatGold(confirmStake * 2)}를 받아요 · 비기거나 무효면 돌려받아요
          {balance !== null && ` · 내 골드 ${formatGold(balance)}`}
        </p>
        {short && <p className="form-error">골드가 부족해요</p>}
        {confirmError && <p className="form-error" role="alert">{confirmError}</p>}
        <div className="card-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || short}
            onClick={async () => {
              setBusy(true)
              setConfirmError(null)
              await tryJoin(confirmStake)
              setBusy(false)
            }}
          >
            참가
          </button>
          <Link className="btn btn-ghost btn-link" to="/duel">취소</Link>
        </div>
      </section>
    )
  }

  if (!error) return <p className="page-note" role="status">참가하는 중…</p>
  // 이미 시작했거나 끝난 대국·취소된 대국·자기 대국은 다시 시도해도 같다
  const retryable = !['full', 'not_waiting', 'own_match'].includes(error.code)
  return (
    <div className="stack" role="alert">
      <p className="form-error">{error.text}</p>
      {retryable && <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>}
      <Link className="btn btn-ghost btn-link" to="/duel">대전 탭으로</Link>
    </div>
  )
}
