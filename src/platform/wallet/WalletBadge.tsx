// 헤더의 내 골드 잔액 (설계 §5.5). 저장소(walletStore)를 그대로 보여 준다.
import { formatGold } from './format.ts'
import { useWallet } from './useWallet.ts'
import './wallet.css'

export function WalletBadge() {
  const { balance } = useWallet()
  const text = balance === null ? '— G' : formatGold(balance)
  return (
    <span className="wallet-badge" aria-label={`내 골드 ${text}`}>
      {text}
    </span>
  )
}
