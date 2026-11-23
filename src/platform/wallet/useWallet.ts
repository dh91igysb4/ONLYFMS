import { useSyncExternalStore } from 'react'
import { getWallet, subscribeWallet, type WalletSnapshot } from '../../lib/walletStore.ts'
import { fetchMyWallet } from './api.ts'

export function useWallet(): WalletSnapshot {
  return useSyncExternalStore(subscribeWallet, getWallet, getWallet)
}

/** my_wallet()을 다시 읽는다. 실패는 삼킨다(배지는 이전 값 유지) */
export async function refreshWallet(): Promise<void> {
  try {
    await fetchMyWallet()
  } catch {
    /* 다음 기회에 다시 읽는다 */
  }
}
