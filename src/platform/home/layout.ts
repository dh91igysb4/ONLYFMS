export type HomeLayoutEntry = { id: string; on: boolean }

/** 기본값: knownIds 순서대로 전부 켜짐 */
function defaultLayout(knownIds: readonly string[]): HomeLayoutEntry[] {
  return knownIds.map((id) => ({ id, on: true }))
}

function isWellFormed(el: unknown): el is HomeLayoutEntry {
  if (typeof el !== 'object' || el === null) return false
  const e = el as Record<string, unknown>
  return typeof e.id === 'string' && typeof e.on === 'boolean'
}

/**
 * 저장값을 화면에 쓸 레이아웃으로 바꾼다 (스펙 §4.2 규칙 1~3).
 * 1. 배열이 아니면 기본값.
 * 2. 형식 틀린 원소, 모르는 id, 중복 id를 버리고 저장 순서를 지킨다.
 * 3. knownIds 중 빠진 id를 knownIds 순서대로 맨 아래에 켜서 붙인다.
 */
export function resolveLayout(saved: unknown, knownIds: readonly string[]): HomeLayoutEntry[] {
  if (!Array.isArray(saved)) return defaultLayout(knownIds)

  const known = new Set(knownIds)
  const seen = new Set<string>()
  const out: HomeLayoutEntry[] = []
  for (const el of saved) {
    if (!isWellFormed(el)) continue
    if (!known.has(el.id) || seen.has(el.id)) continue
    seen.add(el.id)
    out.push({ id: el.id, on: el.on })
  }
  for (const id of knownIds) {
    if (!seen.has(id)) out.push({ id, on: true })
  }
  return out
}

function copyLayout(layout: HomeLayoutEntry[]): HomeLayoutEntry[] {
  return layout.map((e) => ({ id: e.id, on: e.on }))
}

function swapped(layout: HomeLayoutEntry[], i: number, j: number): HomeLayoutEntry[] {
  const out = copyLayout(layout)
  const tmp = out[i]
  out[i] = out[j]
  out[j] = tmp
  return out
}

/** id를 한 칸 위로. 맨 위거나 없는 id면 내용이 같은 새 배열 */
export function moveUp(layout: HomeLayoutEntry[], id: string): HomeLayoutEntry[] {
  const i = layout.findIndex((e) => e.id === id)
  if (i <= 0) return copyLayout(layout)
  return swapped(layout, i, i - 1)
}

/** id를 한 칸 아래로. 맨 아래거나 없는 id면 내용이 같은 새 배열 */
export function moveDown(layout: HomeLayoutEntry[], id: string): HomeLayoutEntry[] {
  const i = layout.findIndex((e) => e.id === id)
  if (i < 0 || i >= layout.length - 1) return copyLayout(layout)
  return swapped(layout, i, i + 1)
}

/** id의 on만 뒤집는다 */
export function toggle(layout: HomeLayoutEntry[], id: string): HomeLayoutEntry[] {
  return layout.map((e) => (e.id === id ? { id: e.id, on: !e.on } : { id: e.id, on: e.on }))
}

/** 기본값(resolveLayout(null, knownIds))과 같으면 null, 다르면 layout 그대로 — set_home_layout에 보낼 값 */
export function toSaved(layout: HomeLayoutEntry[], knownIds: readonly string[]): HomeLayoutEntry[] | null {
  const defaults = defaultLayout(knownIds)
  const same =
    layout.length === defaults.length &&
    layout.every((e, i) => e.id === defaults[i].id && e.on === defaults[i].on)
  return same ? null : copyLayout(layout)
}
