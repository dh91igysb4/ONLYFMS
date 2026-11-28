// 같은 지역 친구 이름표(온라인 설계 §4.3). 캔버스 픽셀 글꼴에 한글이 없어 HTML 글자로 캔버스 위에 띄운다.
// 프레임마다 부르므로 React 렌더 없이 DOM을 직접 맞춘다.
// 자랑 카드(이름 아래 한 줄)와 이모트(이름 위)도 여기서 붙인다(설계 2026-11-25-fishing-brag-discard).
import type { Rarity } from './data.ts'

/** x·y는 프레임(.fish-frame) 기준 CSS px, 이름표 기준점(머리 위 가운데) */
export type Tag = {
  id: string
  handle: string
  x: number
  y: number
  visible: boolean
  /** 자랑 카드 한 줄과 희귀도(전설·신화 강조 색) */
  card?: { text: string; tone: Rarity }
  /** 이모트 글자 */
  emote?: string
  /** 말풍선(맨 위) */
  say?: string
  /** 칭호(이름 바로 아래) */
  title?: string
}

/** 자식 하나를 있으면 맞추고 없으면 지운다. 새로 만들 때는 before 앞(없으면 맨 끝)에 넣는다 */
function part(host: HTMLElement, cls: string, text: string | undefined, before: Element | null): HTMLElement | null {
  let el = host.querySelector<HTMLElement>(`:scope > .${cls}`)
  if (text === undefined) {
    el?.remove()
    return null
  }
  if (!el) {
    el = document.createElement('span')
    el.className = cls
    host.insertBefore(el, before)
  }
  if (el.textContent !== text) el.textContent = text
  return el
}

export function syncTags(container: HTMLElement, tags: Tag[]): void {
  const keep = new Set(tags.map((t) => t.id))
  for (const el of [...container.querySelectorAll<HTMLSpanElement>('span.fish-peer-tag')]) {
    if (!keep.has(el.dataset.id ?? '')) el.remove()
  }
  for (const t of tags) {
    let el = container.querySelector<HTMLSpanElement>(`span.fish-peer-tag[data-id="${CSS.escape(t.id)}"]`)
    if (!el) {
      el = document.createElement('span')
      el.className = 'fish-peer-tag'
      el.dataset.id = t.id
      container.appendChild(el)
    }
    // 위에서 아래로: 말풍선 · 이모트 · 이름 · 칭호 · 자랑 카드
    const name = part(el, 'fish-peer-name', t.handle, null)!
    const emote = part(el, 'fish-peer-emote', t.emote, name)
    part(el, 'fish-peer-say', t.say, emote ?? name)
    part(el, 'fish-peer-title', t.title, name.nextElementSibling)
    const card = part(el, 'fish-peer-card', t.card?.text, null)
    if (card && t.card && card.dataset.tone !== t.card.tone) card.dataset.tone = t.card.tone
    el.style.transform = `translate(${Math.round(t.x)}px, ${Math.round(t.y)}px)`
    el.hidden = !t.visible
  }
}
