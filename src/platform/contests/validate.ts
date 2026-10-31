// 대회 입력 검사. 서버(_validate_contest_input)와 같은 규칙, 필드별 한국어 오류.
export type ContestItemInput = { game_id: string; options: Record<string, string>; count: number }

export type ContestInput = {
  title: string
  startsAt: Date
  durationMin: number
  visibility: 'public' | 'invite'
  items: ContestItemInput[]
  official: boolean
}

const MIN = 60_000
const DAY = 24 * 60 * MIN

export function validateContest(input: ContestInput, nowMs: number): Record<string, string> {
  const errors: Record<string, string> = {}

  const title = input.title.trim()
  if (title.length < 1 || title.length > 40) errors.title = '제목은 1~40자로 적어 주세요'

  const start = input.startsAt.getTime()
  if (!Number.isFinite(start)) errors.startsAt = '시작 시각을 정해 주세요'
  else if (start < nowMs + 5 * MIN) errors.startsAt = '시작은 지금부터 5분 뒤 이후로 정해 주세요'
  else if (start > nowMs + 30 * DAY) errors.startsAt = '시작은 30일 안으로 정해 주세요'

  const d = input.durationMin
  if (!Number.isInteger(d) || d < 5 || d > 180) errors.durationMin = '제한 시간은 5~180분이에요'

  let total = 0
  let bad = false
  for (const it of input.items) {
    if (!it.game_id || !Number.isInteger(it.count) || it.count < 1 || it.count > 10) bad = true
    else total += it.count
  }
  if (bad || input.items.length === 0 || total < 1 || total > 10) {
    errors.items = '문제는 모두 합쳐 1~10개로 구성해 주세요'
  }
  return errors
}
