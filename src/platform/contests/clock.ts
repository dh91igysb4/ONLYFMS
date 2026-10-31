import { rpc } from '../../lib/api.ts'
import { syncFromView } from '../../lib/serverTime.ts'

/** PlayView가 없는 화면에서 서버 시각과의 차이를 맞춘다. 실패하면 브라우저 시각을 그대로 쓴다. */
export async function syncServerTime(): Promise<void> {
  try {
    const ms = await rpc<unknown>('server_now')
    if (typeof ms === 'number') syncFromView(ms)
  } catch {
    /* ignore */
  }
}
