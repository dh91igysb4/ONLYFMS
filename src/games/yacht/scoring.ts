// 요트 다이스 점수 계산 (대전 설계 §8). 순수 함수, 외부 의존 없음.

export type Category =
  | 'aces'
  | 'twos'
  | 'threes'
  | 'fours'
  | 'fives'
  | 'sixes'
  | 'choice'
  | 'threeKind'
  | 'fourKind'
  | 'fullHouse'
  | 'smallStraight'
  | 'largeStraight'
  | 'yacht'

/** 표 순서 = 동점 시 우선순위 */
export const CATEGORIES: Category[] = [
  'aces',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'choice',
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yacht',
]

export type Sheet = Partial<Record<Category, number>>

const UPPER: Category[] = ['aces', 'twos', 'threes', 'fours', 'fives', 'sixes']
const LOWER: Category[] = CATEGORIES.filter((c) => !UPPER.includes(c))

const sum = (d: number[]) => d.reduce((a, b) => a + b, 0)

function counts(dice: number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0]
  for (const d of dice) c[d]++
  return c
}

const isYacht = (dice: number[]) => dice.length === 5 && dice.every((d) => d === dice[0])

function hasRun(dice: number[], len: number): boolean {
  const c = counts(dice)
  let run = 0
  for (let f = 1; f <= 6; f++) {
    run = c[f] > 0 ? run + 1 : 0
    if (run >= len) return true
  }
  return false
}

/** 조커 없는 기본 점수 */
export function rawScore(dice: number[], c: Category): number {
  const cnt = counts(dice)
  const ui = UPPER.indexOf(c)
  if (ui >= 0) return (ui + 1) * cnt[ui + 1]
  const max = Math.max(...cnt)
  switch (c) {
    case 'choice':
      return sum(dice)
    case 'threeKind':
      return max >= 3 ? sum(dice) : 0
    case 'fourKind':
      return max >= 4 ? sum(dice) : 0
    case 'fullHouse':
      return cnt.includes(3) && cnt.includes(2) ? 25 : 0
    case 'smallStraight':
      return hasRun(dice, 4) ? 30 : 0
    case 'largeStraight':
      return hasRun(dice, 5) ? 40 : 0
    case 'yacht':
      return isYacht(dice) ? 50 : 0
    default:
      return 0
  }
}

/** Yacht 칸이 이미 채워진 상태에서 5개가 같으면 조커 */
const isJoker = (dice: number[], sheet: Sheet) => isYacht(dice) && sheet.yacht !== undefined

/** 지금 적을 수 있는 칸 */
export function allowed(dice: number[], sheet: Sheet): Category[] {
  const open = CATEGORIES.filter((c) => sheet[c] === undefined)
  if (!isJoker(dice, sheet)) return open
  const forced = UPPER[dice[0] - 1]
  if (sheet[forced] === undefined) return [forced]
  const lower = open.filter((c) => LOWER.includes(c))
  return lower.length > 0 ? lower : open
}

/** 해당 칸에 적을 때 받는 점수 (조커면 아래 칸 만점) */
export function scoreFor(dice: number[], c: Category, sheet: Sheet): number {
  if (isJoker(dice, sheet) && LOWER.includes(c)) {
    if (c === 'fullHouse') return 25
    if (c === 'smallStraight') return 30
    if (c === 'largeStraight') return 40
    return sum(dice)
  }
  return rawScore(dice, c)
}

/** 이번 기록으로 생기는 +100 */
export function yachtBonus(dice: number[], sheet: Sheet): number {
  return isYacht(dice) && sheet.yacht === 50 ? 100 : 0
}

export function total(sheet: Sheet, bonus: number): number {
  const up = UPPER.reduce((a, c) => a + (sheet[c] ?? 0), 0)
  const low = LOWER.reduce((a, c) => a + (sheet[c] ?? 0), 0)
  return up + (up >= 63 ? 35 : 0) + low + bonus
}
