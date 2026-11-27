// 게임 목록 구역: manifest `topic`으로 묶는다(게임별 분기 없이). 주제 구역이 먼저, 주제 없는 게임은 "다른 게임".
// 구역 안에서는 지속형(world) 게임을 먼저, 그다음 일반 게임을 등록부 순서대로 둔다.
// 구역이 둘이면 게임이 더 많은 쪽이 wide(넓은 화면 3단에서 2칸 차지, 카드 2열). 같으면 뒤쪽.
import type { GameTopic, Manifest } from '../../games/types.ts'

export const TOPIC_TITLES: Record<GameTopic, string> = {
  football: '축구',
}
export const OTHER_TITLE = '다른 게임'

export type Section = { key: string; title: string; games: Manifest[]; wide: boolean }

export function gameSections(solo: readonly Manifest[], worlds: readonly Manifest[]): Section[] {
  const all = [...worlds, ...solo]
  const topics = Object.keys(TOPIC_TITLES) as GameTopic[]
  const sections: Section[] = topics.map((t) => ({ key: t, title: TOPIC_TITLES[t], games: all.filter((m) => m.topic === t), wide: false }))
  sections.push({ key: 'other', title: OTHER_TITLE, games: all.filter((m) => !m.topic || !topics.includes(m.topic)), wide: false })
  const out = sections.filter((s) => s.games.length > 0)
  if (out.length === 2) {
    const [a, b] = out
    ;(a.games.length > b.games.length ? a : b).wide = true
  }
  return out
}
