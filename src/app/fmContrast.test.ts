// FM 스타일 파생 색(theme.css :root의 color-mix)이 모든 팔레트에서 읽히는지 본다(설계 2026-11-28-fm-ui §4.1).
import { describe, expect, it } from 'vitest'
import css from './theme.css?raw'
import walletCss from '../platform/wallet/wallet.css?raw'
import lbCss from '../platform/leaderboard/leaderboard.css?raw'
import { PALETTES, PALETTE_IDS, type Mode } from './palettes.ts'

function lum(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** color-mix(in srgb, a, b p) — sRGB 채널별 선형 섞기 */
function mix(a: string, b: string, p: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
  return '#' + [1, 3, 5].map((i) => Math.round(ch(a, i) * (1 - p) + ch(b, i) * p).toString(16).padStart(2, '0')).join('')
}

const MODES: Mode[] = ['dark', 'light']

describe('fm contrast', () => {
  it('fm contrast: 판 제목 띠·내 줄 바탕·판 위 승무패 칸 글자가 20개 조합 모두 4.5 이상', () => {
    for (const id of PALETTE_IDS) for (const mode of MODES) {
      const t = PALETTES[id][mode]
      const head = mix(t.panel, t.ink, 0.06)
      const me = mix(t.panel, t.accentStrong, 0.12)
      const checks: [string, string, string][] = [
        ['muted on head', t.muted, head], ['ink on head', t.ink, head], ['ink on me', t.ink, me],
        ['win on panel', t.winText, t.panel], ['lose on panel', t.loseText, t.panel], ['muted on panel', t.muted, t.panel],
      ]
      for (const [name, fg, bg] of checks) {
        const v = contrast(fg, bg)
        expect(v, `${id}/${mode}/${name}: ${v.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('theme.css에 fm 파생 변수 식이 그대로 있다', () => {
    expect(css).toContain('--fm-head: color-mix(in srgb, var(--panel), var(--ink) 6%)')
    expect(css).toContain('--fm-line: color-mix(in srgb, var(--panel), var(--ink) 12%)')
    expect(css).toContain('--fm-me: color-mix(in srgb, var(--panel), var(--accent-strong) 12%)')
  })

  it('내 줄 바탕(fm-me) 위에는 흐린 글자를 두지 않는다: 순위 칸·줄 hover 보조 글자는 ink로', () => {
    expect(lbCss.replace(/\s+/g, ' ')).toContain('.lb-table tr.is-me td.rank { color: var(--ink); }')
    expect(css.replace(/\s+/g, ' ')).toContain('a.fm-row:hover .fm-row-sub, a.fm-row:hover .fm-row-go { color: var(--ink); }')
  })

  it('머리글이 좁은 폰에서 넘치지 않게: 430px 이하에서 지갑 글자·밸리 글자를 숨긴다', () => {
    const flat = (x: string) => x.replace(/\s+/g, ' ')
    expect(flat(walletCss)).toMatch(/@media \(max-width: 430px\) \{[^}]*\.wallet-badge-label \{ display: none; \}/)
    // 폰에서는 머리글 밸리 버튼을 빼고(홈의 밸리 판이 같은 입구) 잔액이 잘리지 않게 한다
    expect(flat(css)).toContain('@media (max-width: 430px) { .valley-btn { display: none; } }')
  })

  it('버튼 글자는 가운데: 링크로 된 .btn도 가로·세로 가운데, 밑줄 없음', () => {
    const btn = css.replace(/\s+/g, ' ').match(/\.btn \{([^}]*)\}/)![1]
    for (const rule of ['display: inline-flex;', 'align-items: center;', 'justify-content: center;', 'text-decoration: none;']) {
      expect(btn).toContain(rule)
    }
  })
})
