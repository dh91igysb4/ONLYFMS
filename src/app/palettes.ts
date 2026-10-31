export const PALETTE_IDS = ['classic', 'navy', 'claret', 'stadium', 'graphite', 'indigo', 'slate', 'mono', 'sand', 'ice'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const APPEARANCES = ['dark', 'light', 'system'] as const;
export type Appearance = (typeof APPEARANCES)[number];
export type Mode = 'dark' | 'light';

export type TokenName =
  | 'bg' | 'panel' | 'card' | 'ink' | 'muted' | 'lime' | 'onAccent'
  | 'accentStrong' | 'warnText' | 'winText' | 'loseText' | 'hit' | 'near' | 'miss'
  | 'liveBg' | 'onLive' | 'line' | 'edge' | 'accentEdge' | 'shirtHit' | 'shirtMiss';
export type Tokens = Record<TokenName, string>;

export const CSS_VAR: Record<TokenName, string> = {
  bg: '--bg',
  panel: '--panel',
  card: '--card',
  ink: '--ink',
  muted: '--muted',
  lime: '--lime',
  onAccent: '--on-accent',
  accentStrong: '--accent-strong',
  warnText: '--warn-text',
  winText: '--win-text',
  loseText: '--lose-text',
  hit: '--hit',
  near: '--near',
  miss: '--miss',
  liveBg: '--live-bg',
  onLive: '--on-live',
  line: '--line',
  edge: '--edge',
  accentEdge: '--accent-edge',
  shirtHit: '--shirt-hit',
  shirtMiss: '--shirt-miss',
};

// 값은 WCAG 대비를 계산해 검증했다 (palettes.test.ts). 바꾸면 테스트가 막는다.
export const PALETTES: Record<PaletteId, { name: string; dark: Tokens; light: Tokens }> = {
  classic: {
    name: '기본 보라',
    dark: { bg: '#1c1030', panel: '#2d2140', card: '#ffffff', ink: '#ffffff', muted: '#a79cb8', lime: '#c9f25c', onAccent: '#1c1030', accentStrong: '#c9f25c', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#2d2140', edge: '#2d2140', accentEdge: '#c9f25c', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#f4f1fa', panel: '#ffffff', card: '#ffffff', ink: '#1c1030', muted: '#5b4a78', lime: '#c9f25c', onAccent: '#1c1030', accentStrong: '#4d6b00', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#c6c0d0', edge: '#c6c0d0', accentEdge: '#4d6b00', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
  navy: {
    name: '미드나잇 네이비',
    dark: { bg: '#0f1b2d', panel: '#1a2a42', card: '#ffffff', ink: '#ffffff', muted: '#9fb0c8', lime: '#7cc4ff', onAccent: '#0f1b2d', accentStrong: '#7cc4ff', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#1a2a42', edge: '#1a2a42', accentEdge: '#7cc4ff', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#f1f4f9', panel: '#ffffff', card: '#ffffff', ink: '#0f1b2d', muted: '#4a5a75', lime: '#1a5fb4', onAccent: '#ffffff', accentStrong: '#1a5fb4', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#c0c5cf', edge: '#c0c5cf', accentEdge: '#1a5fb4', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
  claret: {
    name: '클라렛',
    dark: { bg: '#2a0f1c', panel: '#3d1a2b', card: '#ffffff', ink: '#ffffff', muted: '#c9a9b8', lime: '#95bfe5', onAccent: '#2a0f1c', accentStrong: '#95bfe5', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#3d1a2b', edge: '#3d1a2b', accentEdge: '#95bfe5', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#f8f1f4', panel: '#ffffff', card: '#ffffff', ink: '#2a0f1c', muted: '#6b4a5a', lime: '#7a1e45', onAccent: '#ffffff', accentStrong: '#7a1e45', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#cbc0c5', edge: '#cbc0c5', accentEdge: '#7a1e45', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
  stadium: {
    name: '스타디움',
    dark: { bg: '#10182a', panel: '#1b2540', card: '#ffffff', ink: '#ffffff', muted: '#a3afc6', lime: '#8fb0ff', onAccent: '#10182a', accentStrong: '#8fb0ff', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#1b2540', edge: '#1b2540', accentEdge: '#8fb0ff', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#eef1f5', panel: '#ffffff', card: '#ffffff', ink: '#10182a', muted: '#4a5670', lime: '#1f4fd1', onAccent: '#ffffff', accentStrong: '#1f4fd1', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#c0c4cd', edge: '#c0c4cd', accentEdge: '#1f4fd1', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
  graphite: {
    name: '그래파이트',
    dark: { bg: '#16161b', panel: '#23232b', card: '#ffffff', ink: '#ffffff', muted: '#a6a6b8', lime: '#a99bff', onAccent: '#16161b', accentStrong: '#a99bff', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#23232b', edge: '#23232b', accentEdge: '#a99bff', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#f2f2f5', panel: '#ffffff', card: '#ffffff', ink: '#16161b', muted: '#55556a', lime: '#5b47d6', onAccent: '#ffffff', accentStrong: '#5b47d6', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#c4c4cb', edge: '#c4c4cb', accentEdge: '#5b47d6', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
  indigo: {
    name: '인디고',
    dark: { bg: '#16123a', panel: '#241f52', card: '#ffffff', ink: '#ffffff', muted: '#b3addb', lime: '#ff9ccf', onAccent: '#16123a', accentStrong: '#ff9ccf', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#241f52', edge: '#241f52', accentEdge: '#ff9ccf', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#f3f2fb', panel: '#ffffff', card: '#ffffff', ink: '#16123a', muted: '#575273', lime: '#b0306f', onAccent: '#ffffff', accentStrong: '#b0306f', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#c4c2ce', edge: '#c4c2ce', accentEdge: '#b0306f', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
  slate: {
    name: '슬레이트',
    dark: { bg: '#131a23', panel: '#1f2a37', card: '#ffffff', ink: '#ffffff', muted: '#a3b2c4', lime: '#5fe0e6', onAccent: '#131a23', accentStrong: '#5fe0e6', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#1f2a37', edge: '#1f2a37', accentEdge: '#5fe0e6', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#eef2f6', panel: '#ffffff', card: '#ffffff', ink: '#131a23', muted: '#4a5868', lime: '#0b6f7a', onAccent: '#ffffff', accentStrong: '#0b6f7a', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#c0c5ca', edge: '#c0c5ca', accentEdge: '#0b6f7a', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
  mono: {
    name: '모노크롬',
    dark: { bg: '#121417', panel: '#1e2125', card: '#ffffff', ink: '#ffffff', muted: '#a9afb8', lime: '#ffffff', onAccent: '#121417', accentStrong: '#ffffff', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#1e2125', edge: '#1e2125', accentEdge: '#ffffff', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#f4f5f7', panel: '#ffffff', card: '#ffffff', ink: '#121417', muted: '#555b64', lime: '#121417', onAccent: '#ffffff', accentStrong: '#121417', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#c4c6c9', edge: '#c4c6c9', accentEdge: '#121417', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
  sand: {
    name: '샌드',
    dark: { bg: '#221e18', panel: '#302a22', card: '#ffffff', ink: '#ffffff', muted: '#c2b8a6', lime: '#a9bdf0', onAccent: '#221e18', accentStrong: '#a9bdf0', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#302a22', edge: '#302a22', accentEdge: '#a9bdf0', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#f5f1ea', panel: '#ffffff', card: '#ffffff', ink: '#1d2433', muted: '#575e6e', lime: '#24408e', onAccent: '#ffffff', accentStrong: '#24408e', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#c4c7cc', edge: '#c4c7cc', accentEdge: '#24408e', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
  ice: {
    name: '아이스',
    dark: { bg: '#1a1733', panel: '#26224a', card: '#ffffff', ink: '#ffffff', muted: '#b1abd6', lime: '#b3a3ff', onAccent: '#1a1733', accentStrong: '#b3a3ff', warnText: '#e9a43c', winText: '#5cc169', loseText: '#ff8f7a', hit: '#5cc169', near: '#e9a43c', miss: '#97a3b8', liveBg: '#5cc169', onLive: '#1c1030', line: '#26224a', edge: '#26224a', accentEdge: '#b3a3ff', shirtHit: '#3f9a4c', shirtMiss: '#6b7689' },
    light: { bg: '#f3f2fb', panel: '#ffffff', card: '#ffffff', ink: '#1a1733', muted: '#575273', lime: '#5b3fd6', onAccent: '#ffffff', accentStrong: '#5b3fd6', warnText: '#9a5800', winText: '#2b7d39', loseText: '#c4271c', hit: '#2f8a3e', near: '#b06a00', miss: '#5d6878', liveBg: '#237a33', onLive: '#ffffff', line: '#c4c2ce', edge: '#c4c2ce', accentEdge: '#5b3fd6', shirtHit: '#86d494', shirtMiss: '#a7b2c3' },
  },
};

export function isPaletteId(x: unknown): x is PaletteId {
  return typeof x === 'string' && (PALETTE_IDS as readonly string[]).includes(x);
}

export function isAppearance(x: unknown): x is Appearance {
  return typeof x === 'string' && (APPEARANCES as readonly string[]).includes(x);
}

export function resolveTokens(id: string, mode: Mode): Tokens {
  return PALETTES[isPaletteId(id) ? id : 'classic'][mode];
}
