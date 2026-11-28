import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Manifest } from '../../games/types.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { walletEnabled } from '../wallet/enabled.ts'
import { fetchMyItems } from './api.ts'

type Loaded = { owned: string[]; equipped: string | null }

/**
 * 상점 옵션이 있는 게임에서 "내가 고를 수 있는 품목"을 정한다.
 * 상점이 없거나 로그인·승인·지갑이 안 되면 바로 ready이고, 가격 0 품목만 고를 수 있다.
 * my_items가 실패해도 ready(가격 0 품목, 기본값으로 시작)이며 refresh()로 다시 읽을 수 있다.
 */
export function useOwnedItems(gameId: string, manifest: Manifest) {
  const { profile } = useAuth()
  const shop = manifest.shop
  const canShop = !!shop && profile?.status === 'approved' && walletEnabled()
  const [loaded, setLoaded] = useState<Loaded | 'failed' | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (!canShop) return
    let live = true
    fetchMyItems(gameId).then(
      (r) => { if (live) setLoaded(r) },
      () => { if (live) setLoaded((prev) => prev ?? 'failed') },
    )
    return () => { live = false }
  }, [canShop, gameId, tick])

  const free = useMemo(() => (shop?.items ?? []).filter((i) => i.price === 0).map((i) => i.id), [shop])
  const data = canShop && loaded && loaded !== 'failed' ? loaded : null
  const owned = useMemo(() => new Set([...free, ...(data?.owned ?? [])]), [free, data])
  return {
    ready: !canShop || loaded !== null,
    owned,
    equipped: data?.equipped ?? null,
    refresh,
    canShop,
  }
}
