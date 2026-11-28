import { useState } from 'react'
import type { Manifest } from '../../games/types.ts'
import { getShopPreview } from '../../games/ui.ts'
import { setBalance } from '../../lib/walletStore.ts'
import { fetchMyWallet } from '../wallet/api.ts'
import { formatGold } from '../wallet/format.ts'
import { buyItem } from './api.ts'

const MESSAGES: Record<string, string> = {
  not_enough_gold: 'JWD가 부족해요',
  price_mismatch: '가격이 바뀌었어요. 페이지를 새로 고쳐 주세요',
  already_owned: '이미 가진 품목이에요',
}

export function shopErrorMessage(code: string): string {
  return MESSAGES[code] ?? '사지 못했어요'
}

type Props = {
  gameId: string
  manifest: Manifest
  owned: Set<string>
  selected: string
  onBought(itemId: string): void
  onSelect(itemId: string): void
  /** 산 품목 목록을 다시 읽는다 (사기에 실패했어도 서버에선 샀을 수 있다) */
  onRefresh(): void
  onClose(): void
}

export function ShopPanel({ gameId, manifest, owned, selected, onBought, onSelect, onRefresh, onClose }: Props) {
  const shop = manifest.shop
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!shop) return null
  const choices = manifest.options.find((o) => o.key === shop.option)?.choices ?? []
  const Preview = getShopPreview(gameId)

  const buy = async (id: string, price: number) => {
    setBusy(true)
    setError(null)
    try {
      const { balance } = await buyItem(gameId, id, price)
      setBalance(balance)
      setConfirming(null)
      onBought(id)
    } catch (e) {
      setError(shopErrorMessage(e instanceof Error ? e.message : ''))
      setConfirming(null)
      // 응답만 잃고 서버에서는 샀을 수 있으니 보유 목록과 잔액을 다시 읽는다
      onRefresh()
      void fetchMyWallet().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="shop-panel fm-panel" aria-label="상점">
      <div className="fm-panel-head">
        <span>상점</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>닫기</button>
      </div>
      <div className="fm-panel-body">
        {error && <p className="form-error" role="alert">{error}</p>}
        <ul className="shop-list">
          {shop.items.map((it) => {
            const label = choices.find((c) => c.value === it.id)?.label ?? it.id
            const has = owned.has(it.id)
            return (
              <li key={it.id} className="shop-item">
                {Preview && <Preview itemId={it.id} size={96} />}
                <span className="shop-name">{label}</span>
                {has ? (
                  selected === it.id
                    ? <span className="muted">고름</span>
                    : <button className="btn btn-ghost btn-sm" onClick={() => onSelect(it.id)}>고르기</button>
                ) : confirming === it.id ? (
                  <span className="shop-confirm">
                    <span>{formatGold(it.price)}로 살까요?</span>
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void buy(it.id, it.price)}>확인</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirming(null)}>취소</button>
                  </span>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => { setError(null); setConfirming(it.id) }}>
                    {`사기 (${formatGold(it.price)})`}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
