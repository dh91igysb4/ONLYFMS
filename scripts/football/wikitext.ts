// 위키텍스트 파싱 도구 (설계 2026-11-25-football-honours-design.md §3.3). 순수 함수만.

export function stripComments(t: string): string {
  return t.replace(/<!--[\s\S]*?-->/g, '')
}

/** 각주(<ref>…</ref>, <ref …/>)와 각주형 틀({{refn}}, {{efn}}, {{sfn}} 등)을 뺀다 */
export function stripRefs(t: string): string {
  let s = t.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  for (const b of templates(s, /^(refn|efn|efn-\w+|sfn|sfnp|notetag|r)$/i)) s = s.replace(b, '')
  return s
}

/** 이름이 name과 맞는 틀 블록을 중괄호 짝을 맞춰 순서대로 돌려준다(바깥 틀만) */
export function templates(t: string, name: RegExp): string[] {
  const out: string[] = []
  for (const b of topLevelBlocks(t)) {
    const n = b.slice(2).split(/[|}]/, 1)[0].trim()
    if (name.test(n)) out.push(b)
  }
  return out
}

/** 바깥 수준의 {{…}} 블록 */
function topLevelBlocks(t: string): string[] {
  const out: string[] = []
  let depth = 0, start = -1
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i] === '{' && t[i + 1] === '{') { if (depth === 0) start = i; depth++; i++ }
    else if (t[i] === '}' && t[i + 1] === '}' && depth > 0) { depth--; i++; if (depth === 0) out.push(t.slice(start, i + 1)) }
  }
  return out
}

/** 틀 인자: 위치 인자 배열과 이름 인자 맵 (중첩 [[ ]]·{{ }} 안의 |는 나누지 않는다) */
export function templateArgs(block: string): { positional: string[]; named: Map<string, string> } {
  const inner = block.slice(2, -2)
  const parts = splitTop(inner, '|').slice(1)
  const positional: string[] = [], named = new Map<string, string>()
  for (const p of parts) {
    const m = /^\s*([\w -]+?)\s*=([\s\S]*)$/.exec(p)
    if (m && !p.trimStart().startsWith('[[')) named.set(m[1].toLowerCase(), m[2].trim())
    else positional.push(p.trim())
  }
  return { positional, named }
}

/** 괄호 깊이 0에서만 sep으로 나눈다 */
export function splitTop(t: string, sep: string): string[] {
  const out: string[] = []
  let depthB = 0, depthS = 0, cur = ''
  for (let i = 0; i < t.length; i++) {
    const two = t.slice(i, i + 2)
    if (two === '{{') { depthB++; cur += two; i++; continue }
    if (two === '}}' && depthB > 0) { depthB--; cur += two; i++; continue }
    if (two === '[[') { depthS++; cur += two; i++; continue }
    if (two === ']]' && depthS > 0) { depthS--; cur += two; i++; continue }
    if (depthB === 0 && depthS === 0 && t.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue }
    cur += t[i]
  }
  out.push(cur)
  return out
}

const SKIP_NS = /^(file|image|category|media|wikipedia|template|help|portal):/i

export function normalizeTitle(target: string): string {
  const s = target.split('#', 1)[0].replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

/** 링크 대상 제목들(문서에 나온 순서). 파일·분류 링크는 그 안의 링크까지 뺀다 */
export function wikiLinks(t: string): string[] {
  const out: string[] = []
  let s = t
  // 파일 링크는 안에 링크가 있을 수 있어 짝을 맞춰 지운다
  for (;;) {
    const i = s.search(/\[\[\s*(file|image):/i)
    if (i < 0) break
    let depth = 0, j = i
    for (; j < s.length - 1; j++) {
      if (s[j] === '[' && s[j + 1] === '[') { depth++; j++ } else if (s[j] === ']' && s[j + 1] === ']') { depth--; j++; if (depth === 0) break }
    }
    s = s.slice(0, i) + s.slice(j + 1)
  }
  for (const m of s.matchAll(/\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]/g)) {
    if (SKIP_NS.test(m[1].trim())) continue
    const n = normalizeTitle(m[1])
    if (n) out.push(n)
  }
  return out
}

/** 사람이 보는 글자: 링크는 표시 글자, 틀·태그·굵게 표시는 뺀다 */
export function plainText(t: string): string {
  let s = stripRefs(stripComments(t))
  for (const b of topLevelBlocks(s)) s = s.replace(b, '')
  return s.replace(/\[\[(?:[^[\]|]*\|)?([^[\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * 위키 표 → 표마다 행 배열 → 칸 원문 배열. 칸 속성(rowspan 등)은 떼고, rowspan 칸은 아래 행들의 같은 자리에 복제한다.
 * 줄 머리의 | ! 는 괄호({{ }}) 밖일 때만 칸 표시로 본다(여러 줄 인용 틀 대비). 표 안의 표는 다루지 않는다.
 */
export function tables(text: string): string[][][] {
  const t = stripRefs(stripComments(text))
  const out: string[][][] = []
  let rows: string[][] | null = null
  let raw: { text: string; n: number }[] = []
  let carry = new Map<number, { text: string; left: number }>()
  let depth = 0, open = false
  const flushRow = () => {
    if (!rows || (!raw.length && !carry.size)) { raw = []; return }
    const full: string[] = []
    const next = new Map<number, { text: string; left: number }>()
    const take = (col: number) => {
      const c = carry.get(col)
      if (!c) return false
      full.push(c.text)
      if (c.left > 1) next.set(col, { text: c.text, left: c.left - 1 })
      return true
    }
    let col = 0
    for (const cell of raw) {
      while (take(col)) col++
      full.push(cell.text)
      if (cell.n > 1) next.set(col, { text: cell.text, left: cell.n - 1 })
      col++
    }
    while (take(col)) col++
    if (raw.length) rows.push(full)
    else for (const [k, v] of carry) next.set(k, v) // 칸 없는 행(빈 |-)은 rowspan을 쓰지 않는다
    carry = next
    raw = []
  }
  const addCells = (line: string, header: boolean) => {
    const parts = splitTop(line, '||').flatMap((p) => (header ? splitTop(p, '!!') : [p]))
    for (const part of parts) {
      const bits = splitTop(part, '|')
      let attrs = '', content = part
      if (bits.length > 1 && !/\[\[|\{\{/.test(bits[0])) { attrs = bits[0]; content = bits.slice(1).join('|') }
      const m = /rowspan\s*=\s*"?(\d+)/i.exec(attrs)
      raw.push({ text: content.trim(), n: m ? Number(m[1]) : 1 })
    }
    open = true
  }
  for (const line of t.split('\n')) {
    const atTop = depth === 0
    const l = line.trimStart()
    if (atTop && l.startsWith('{|')) { rows = []; raw = []; carry = new Map(); open = false }
    else if (atTop && l.startsWith('|}')) { flushRow(); if (rows) out.push(rows); rows = null; open = false }
    else if (atTop && rows && l.startsWith('|-')) { flushRow(); open = false }
    else if (atTop && rows && l.startsWith('|+')) { open = false }
    else if (atTop && rows && (l.startsWith('|') || l.startsWith('!'))) addCells(l.slice(1), l.startsWith('!'))
    else if (rows && open && raw.length) raw[raw.length - 1].text += '\n' + line
    depth += (line.match(/\{\{/g)?.length ?? 0) - (line.match(/\}\}/g)?.length ?? 0)
    if (depth < 0) depth = 0
  }
  return out
}

/** 제목이 name인 절의 본문(하위 절 포함, 같거나 높은 수준의 다음 제목 전까지). 없으면 null */
export function sectionText(t: string, name: string): string | null {
  const lines = t.split('\n')
  const head = (l: string) => /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(l)
  const i = lines.findIndex((l) => { const h = head(l); return !!h && plainText(h[2]) === name })
  if (i < 0) return null
  const level = head(lines[i])![1].length
  let j = i + 1
  for (; j < lines.length; j++) { const h = head(lines[j]); if (h && h[1].length <= level) break }
  return lines.slice(i + 1, j).join('\n').trim()
}
