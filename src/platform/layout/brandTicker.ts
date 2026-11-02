// 헤더 로고 옆 글자 자리에 번갈아 보여 줄 문구. 가입자 조재원의 전역 D-day (2028-03-06, KST)
import { kstDaysUntil } from '../../shared/kst.ts'

export const SITE_NAME = 'playONLYFMS'
const DISCHARGE_DATE = '2028-03-06'

export function brandMessages(nowMs: number): string[] {
  const days = kstDaysUntil(DISCHARGE_DATE, nowMs)
  if (days > 0) return [SITE_NAME, `재원이 전역까지 D-${days}`]
  if (days === 0) return [SITE_NAME, '재원이 전역 D-DAY 🎉']
  return [SITE_NAME] // 전역 다음 날부터는 돌지 않는다
}
