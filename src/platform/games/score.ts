import { getGame } from '../../games/index.ts'

/** 자유 플레이 점수를 게임의 manifest.scoreDecimals(기본 2)에 맞춰 문자열로 만든다. */
export function formatFreeScore(gameId: string, value: number | null | undefined): string {
  const d = getGame(gameId)?.manifest.scoreDecimals ?? 2
  return Number(value ?? 0).toFixed(d)
}
