// 대국 만들기의 판돈 입력 (지갑 설계 §9). 빠른 선택 + 직접 입력, 상한 min(내 잔액, 41,000).
import { formatGold } from '../wallet/format.ts'
import '../wallet/wallet.css'
import { parseStake, stakeCap, stakePresets, stakeProblem } from './stake.ts'

type Props = {
  /** 입력칸 그대로의 문자열 */
  text: string
  onText(next: string): void
  balance: number | null
}

export function StakePicker({ text, onText, balance }: Props) {
  const stake = parseStake(text)
  const problem = stakeProblem(stake, balance)
  const cap = stakeCap(balance)
  return (
    <div className="field stake-picker">
      <label className="stake-label" htmlFor="duel-stake">판돈</label>
      <div className="stake-presets" role="group" aria-label="판돈 빠른 선택">
        {stakePresets(balance).map((p) => (
          <button
            key={p}
            type="button"
            className={`btn btn-ghost stake-chip${stake === p ? ' is-on' : ''}`}
            aria-pressed={stake === p}
            onClick={() => onText(String(p))}
          >
            {formatGold(p)}
          </button>
        ))}
      </div>
      <input
        id="duel-stake"
        className="input"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        aria-invalid={problem !== null}
        aria-describedby="duel-stake-help"
        onChange={(e) => onText(e.target.value)}
      />
      <span id="duel-stake-help" className="muted stake-help">
        이기면 상대 판돈까지 가져가요 · 최대 {formatGold(cap)}{balance !== null && ` · 내 골드 ${formatGold(balance)}`}
      </span>
      {problem && <span className="form-error stake-problem">{problem}</span>}
    </div>
  )
}
