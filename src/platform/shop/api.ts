// 상점 RPC 데이터 계층 (buy_item·equip_item·my_items). 실패하면 ApiError의 message가 오류 코드다.
import { rpc } from '../../lib/api.ts'

type ItemRow = { item_id: string; equipped: boolean }

/** 내가 가진 품목(행이 있는 것)과 지금 고른 품목. 고른 게 없으면 equipped는 null(= 기본) */
export async function fetchMyItems(gameId: string): Promise<{ owned: string[]; equipped: string | null }> {
  const rows = (await rpc<ItemRow[] | null>('my_items', { p_game: gameId })) ?? []
  return { owned: rows.map((r) => r.item_id), equipped: rows.find((r) => r.equipped)?.item_id ?? null }
}

/** price는 화면이 본 가격. 다르면 서버가 price_mismatch를 던진다 */
export async function buyItem(gameId: string, itemId: string, price: number): Promise<{ balance: number }> {
  const d = await rpc<{ balance: number | string }>('buy_item', { p_game: gameId, p_item: itemId, p_price: price })
  return { balance: Number(d?.balance) }
}

export async function equipItem(gameId: string, itemId: string): Promise<void> {
  await rpc<unknown>('equip_item', { p_game: gameId, p_item: itemId })
}
