import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { errorMessage } from '../../lib/api.ts'
import { getGame } from '../../games/index.ts'
import type { GameModule } from '../../games/types.ts'
import { PlayRunner } from './PlayRunner.tsx'
import { useAuth } from '../auth/AuthProvider.tsx'

import { equipItem } from '../shop/api.ts'
import { ShopPanel } from '../shop/ShopPanel.tsx'
import { useOwnedItems } from '../shop/useOwnedItems.ts'

export function FreePage() {
  const { game = '' } = useParams()
  const { profile } = useAuth()
  const mod = getGame(game)
  // 숨김 게임은 관리자에게만 있는 게임이다. 그 밖의 사람에게는 없는 게임과 똑같이 보인다.
  const supported = !!mod?.manifest.modes.free && (!mod.manifest.hidden || !!profile?.is_admin)
  if (!mod || !supported) return <p className="form-error" role="alert">{errorMessage('unknown_game')}</p>
  return <FreeGame game={game} mod={mod} />
}

/** 상점 옵션이 있으면 가진 품목을 읽어 온 뒤에 판을 시작한다 */
function FreeGame({ game, mod }: { game: string; mod: GameModule }) {
  const items = useOwnedItems(game, mod.manifest)
  if (!items.ready) return <p className="muted" role="status">불러오는 중</p>
  return <FreeBody game={game} mod={mod} items={items} />
}

function FreeBody({ game, mod, items }: { game: string; mod: GameModule; items: ReturnType<typeof useOwnedItems> }) {
  const { manifest } = mod
  const shop = manifest.shop
  const [options, setOptions] = useState<Record<string, string>>(() => {
    const init = Object.fromEntries(manifest.options.map((o) => [o.key, o.default]))
    if (shop && items.equipped && items.owned.has(items.equipped)) init[shop.option] = items.equipped
    return init
  })
  const [round, setRound] = useState(0)
  const [bought, setBought] = useState<string[]>([])
  const [shopOpen, setShopOpen] = useState(false)
  const next = () => setRound((n) => n + 1)
  const owned = new Set([...items.owned, ...bought])

  const choose = (key: string, value: string) => {
    setOptions((o) => ({ ...o, [key]: value }))
    if (shop && key === shop.option && items.canShop) void equipItem(game, value).catch(() => { /* 고른 값은 이번 판에는 그대로 쓴다 */ })
    next()
  }

  return (
    <div className="stack">
      <div className="free-head">
        <h2 className="free-title">{manifest.name} <span className="muted">· 자유 플레이</span></h2>
        <button className="btn btn-ghost btn-sm" onClick={next}>새 판</button>
      </div>
      {manifest.options.length > 0 && (
        <div className="free-options">
          {manifest.options.map((o) => (
            <label key={o.key} className="free-option">
              <span className="sr-only">{o.label}</span>
              <select
                className="input input-sm"
                value={options[o.key]}
                onChange={(e) => choose(o.key, e.target.value)}
              >
                {o.choices
                  .filter((c) => !o.shop || owned.has(c.value))
                  .map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          ))}
          {items.canShop && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShopOpen((v) => !v)}>상점</button>
          )}
        </div>
      )}
      {shopOpen && items.canShop && shop && (
        <ShopPanel
          gameId={game}
          manifest={manifest}
          owned={owned}
          selected={options[shop.option]}
          onRefresh={items.refresh}
          onBought={(id) => { setBought((b) => [...b, id]); items.refresh(); choose(shop.option, id) }}
          onSelect={(id) => choose(shop.option, id)}
          onClose={() => setShopOpen(false)}
        />
      )}
      <PlayRunner key={round} mode="local" gameId={game} options={options} onNext={next} />
    </div>
  )
}
