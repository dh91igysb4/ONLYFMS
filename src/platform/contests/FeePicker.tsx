// 대회 만들기의 참가비 입력 (지갑 설계 §10). 빠른 선택 + 직접 입력, 상한 min(내 잔액, 41,000).
import { formatGold } from '../wallet/format.ts'
import '../wallet/wallet.css'
import { feeCap, feePresets, feeProblem, parseFee } from './fee.ts'

type Props = {
  /** 입력칸 그대로의 문자열 */
  text: string
  onText(next: string): void
  balance: number | null
  /** 서버가 돌려준 오류 문구 */
  error?: string
}

export function FeePicker({ text, onText, balance, error }: Props) {
  const fee = parseFee(text)
  const problem = feeProblem(fee, balance) ?? error ?? null
  const cap = feeCap(balance)
  return (
    <div className="field stake-picker">
      <label className="stake-label" htmlFor="contest-fee">참가비</label>
      <div className="stake-presets" role="group" aria-label="참가비 빠른 선택">
        {feePresets(balance).map((p) => (
          <button
            key={p}
            type="button"
            className={`btn btn-ghost stake-chip${fee === p ? ' is-on' : ''}`}
            aria-pressed={fee === p}
            onClick={() => onText(String(p))}
          >
            {formatGold(p)}
          </button>
        ))}
      </div>
      <input
        id="contest-fee"
        className="input"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        aria-invalid={problem !== null}
        aria-describedby="contest-fee-help"
        onChange={(e) => onText(e.target.value)}
      />
      <span id="contest-fee-help" className="muted stake-help">
        모인 참가비를 1~3등이 6:3:1로 나눠 가져요 · 만든 뒤에는 바꿀 수 없어요 · 최대 {formatGold(cap)}
        {balance !== null && ` · 보유 ${formatGold(balance)}`}
      </span>
      {problem && <span className="form-error stake-problem">{problem}</span>}
    </div>
  )
}
