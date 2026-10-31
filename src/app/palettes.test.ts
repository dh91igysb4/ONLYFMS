import { describe, expect, it } from 'vitest';
import css from './theme.css?raw';
import wyaCss from '../games/who-are-ya/wya.css?raw';
import {
  CSS_VAR,
  PALETTES,
  PALETTE_IDS,
  isAppearance,
  isPaletteId,
  resolveTokens,
  type Mode,
  type TokenName,
} from './palettes.ts';

function lum(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MODES: Mode[] = ['dark', 'light'];

describe('palettes', () => {
  it('palettes_meet_text_contrast', () => {
    const textTokens: TokenName[] = ['ink', 'muted', 'accentStrong', 'warnText', 'winText', 'loseText'];
    for (const id of PALETTE_IDS) {
      for (const mode of MODES) {
        const t = PALETTES[id][mode];
        for (const token of textTokens) {
          for (const bgName of ['bg', 'panel'] as const) {
            const v = contrast(t[token], t[bgName]);
            expect(v, `${id}/${mode}/${token} on ${bgName}: ${v.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
          }
        }
        const v = contrast(t.onAccent, t.lime);
        expect(v, `${id}/${mode}/onAccent on lime: ${v.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        const live = contrast(t.onLive, t.liveBg);
        expect(live, `${id}/${mode}/onLive on liveBg: ${live.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('light_tiles_visible_on_bg', () => {
    for (const id of PALETTE_IDS) {
      const t = PALETTES[id].light;
      for (const token of ['hit', 'near', 'miss'] as const) {
        const v = contrast(t[token], t.bg);
        expect(v, `${id}/light/${token} on bg: ${v.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('light_surfaces_have_visible_edges', () => {
    for (const id of PALETTE_IDS) {
      const t = PALETTES[id].light;
      for (const bgName of ['bg', 'panel'] as const) {
        const v = contrast(t.line, t[bgName]);
        expect(v, `${id}/light/line on ${bgName}: ${v.toFixed(2)}`).toBeGreaterThanOrEqual(1.5);
      }
      expect(t.edge, `${id}/light/edge`).toBe(t.line);
      // 강조 채움 버튼은 채움색이나 테두리 중 하나가 배경과 3:1 이상 구분돼야 한다
      const fill = Math.max(contrast(t.lime, t.bg), contrast(t.accentEdge, t.bg));
      expect(fill, `${id}/light/accent fill or edge on bg: ${fill.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      // 등번호 셔츠가 결과 타일 위에서 보여야 한다
      expect(contrast(t.shirtHit, t.hit), `${id}/light/shirtHit on hit`).toBeGreaterThanOrEqual(2);
      expect(contrast(t.shirtMiss, t.miss), `${id}/light/shirtMiss on miss`).toBeGreaterThanOrEqual(2);
    }
  });

  it('dark_edges_are_invisible', () => {
    // 다크는 기존 화면과 픽셀 동일: inset 테두리 색이 자기 채움색과 같고 구분선은 패널색 그대로
    for (const id of PALETTE_IDS) {
      const t = PALETTES[id].dark;
      expect(t.edge, `${id}/dark/edge`).toBe(t.panel);
      expect(t.line, `${id}/dark/line`).toBe(t.panel);
      expect(t.accentEdge, `${id}/dark/accentEdge`).toBe(t.lime);
      expect([t.shirtHit, t.shirtMiss]).toEqual(['#3f9a4c', '#6b7689']);
    }
  });

  it('classic_dark_matches_theme_css', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const vars: Record<string, string> = {};
    for (const m of root.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1]] = m[2].toLowerCase();
    for (const token of Object.keys(CSS_VAR) as TokenName[]) {
      expect(vars[CSS_VAR[token]], `${CSS_VAR[token]}`).toBe(PALETTES.classic.dark[token]);
    }
  });

  it('palette_ids_match_migration', () => {
    const files = import.meta.glob('../../supabase/migrations/*.sql', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    let ids: string[] | null = null;
    for (const sql of Object.values(files)) {
      const m = /profiles_palette_check\s+check\s*\(\s*palette\s+in\s*\(([^)]*)\)/i.exec(sql);
      if (m) ids = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
    expect(ids).not.toBeNull();
    expect(ids).toEqual([...PALETTE_IDS]);
  });

  it('resolve_unknown_falls_back', () => {
    expect(resolveTokens('neon', 'dark')).toEqual(PALETTES.classic.dark);
    expect(isPaletteId('navy')).toBe(true);
    expect(isPaletteId('neon')).toBe(false);
    expect(isAppearance('system')).toBe(true);
    expect(isAppearance(null)).toBe(false);
  });

  it('no_text_use_of_fill_tokens', () => {
    const re = /(^|[^-])color:\s*var\(--(lime|near|bg)\)/m;
    expect(re.test(css)).toBe(false);
    expect(re.test(wyaCss)).toBe(false);
  });
});
