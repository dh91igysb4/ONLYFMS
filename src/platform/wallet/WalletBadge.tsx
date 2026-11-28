// 헤더의 보유 잔액 (설계 §5.5). 저장소(walletStore)를 그대로 보여 준다.
// "지갑"을 붙인다: 낚시 화면도 같은 잔액(지갑)을 보여 주므로 헤더 금액이 사이트 공용 지갑이라는 걸 드러낸다.
import { formatGold } from './format.ts'
import { useWallet } from './useWallet.ts'
import './wallet.css'

export function WalletBadge() {
  const { balance } = useWallet()
  const text = balance === null ? '— JWD' : formatGold(balance)
  return (
    <span className="wallet-badge" aria-label={`지갑 ${text}`}>
      <span className="wallet-badge-label" aria-hidden="true">지갑</span> {text}
    </span>
  )
}
