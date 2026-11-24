// 같은 지역 친구 이름표(온라인 설계 §4.3). 캔버스 픽셀 글꼴에 한글이 없어 HTML 글자로 캔버스 위에 띄운다.
// 프레임마다 부르므로 React 렌더 없이 DOM을 직접 맞춘다.

/** x·y는 프레임(.fish-frame) 기준 CSS px, 이름표 기준점(머리 위 가운데) */
export type Tag = { id: string; handle: string; x: number; y: number; visible: boolean }

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
    if (el.textContent !== t.handle) el.textContent = t.handle
    el.style.transform = `translate(${Math.round(t.x)}px, ${Math.round(t.y)}px)`
    el.hidden = !t.visible
  }
}
