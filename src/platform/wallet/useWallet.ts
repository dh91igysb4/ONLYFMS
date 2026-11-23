import { useSyncExternalStore } from 'react'
import { getPrizes, getWallet, subscribePrizes, subscribeWallet, type Prize, type WalletSnapshot } from '../../lib/walletStore.ts'
import { fetchMyWallet } from './api.ts'

export function useWallet(): WalletSnapshot {
  return useSyncExternalStore(subscribeWallet, getWallet, getWallet)
}

/** 최근 받은 상금(my_wallet prizes) */
export function usePrizes(): Prize[] {
  return useSyncExternalStore(subscribePrizes, getPrizes, getPrizes)
}

/** my_wallet()을 다시 읽는다. 실패는 삼킨다(배지는 이전 값 유지) */
export async function refreshWallet(): Promise<void> {
  try {
    await fetchMyWallet()
  } catch {
    /* 다음 기회에 다시 읽는다 */
  }
}
