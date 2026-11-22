import { duels, games, worlds } from '../../games/index.ts'

export const SITE_TARGET = 'site'
const SITE_NAME = '사이트'

type Target = { id: string; name: string }

function allTargets(isAdmin: boolean): Target[] {
  const out: Target[] = []
  for (const { manifest: m } of [...games, ...duels, ...worlds]) {
    if (m.hidden && !isAdmin) continue
    out.push({ id: m.id, name: m.name })
  }
  return out
}

/** 제안 대상: 솔로 게임 → 대전 게임 → 지속형 게임 → 사이트. 숨김 게임은 관리자에게만 보인다. */
export function suggestTargets(isAdmin: boolean): Target[] {
  return [...allTargets(isAdmin), { id: SITE_TARGET, name: SITE_NAME }]
}

/** 등록부에 없으면 id 그대로. */
export function targetName(id: string): string {
  if (id === SITE_TARGET) return SITE_NAME
  return allTargets(true).find((t) => t.id === id)?.name ?? id
}
