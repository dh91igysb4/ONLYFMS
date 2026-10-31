// 화면용 클럽 유니폼 색·국기 (원본 단독판 wy_render.js에서 가져옴). React 없음.

/** [주 색, 보조 색, 무늬] s=세로 줄무늬 h=반반 a=소매 색 다름 p=단색 */
export type Kit = [main: string, second: string, style: 's' | 'h' | 'a' | 'p']

export const KIT: Record<string, Kit> = {
  MCI: ['#6cabdd', '#ffffff', 'p'], ARS: ['#ef0107', '#ffffff', 'a'], BHA: ['#0057b8', '#ffffff', 's'], LIV: ['#c8102e', '#c8102e', 'p'],
  CHE: ['#034694', '#ffffff', 'p'], BRE: ['#e30613', '#ffffff', 's'], LEE: ['#ffffff', '#1d428a', 'p'], NEW: ['#241f20', '#ffffff', 's'],
  AVL: ['#7a1e45', '#95bfe5', 'a'], HUL: ['#f5a12d', '#111111', 'p'], EVE: ['#003399', '#ffffff', 'p'], IPS: ['#0044a9', '#ffffff', 'p'],
  BOU: ['#da291c', '#111111', 's'], TOT: ['#ffffff', '#132257', 'p'], FUL: ['#ffffff', '#111111', 'p'], MUN: ['#da291c', '#111111', 'p'],
  CRY: ['#1b458f', '#c4122e', 's'], NFO: ['#dd0000', '#ffffff', 'p'], COV: ['#59cbe8', '#ffffff', 'p'], SUN: ['#eb172b', '#ffffff', 's'],
  BAR: ['#a50044', '#004d98', 's'], ATM: ['#cb3524', '#ffffff', 's'], RMA: ['#ffffff', '#febe10', 'p'], BET: ['#00954c', '#ffffff', 's'],
  RSO: ['#0067b1', '#ffffff', 's'], SEV: ['#ffffff', '#d71920', 'p'], ALA: ['#0761af', '#ffffff', 's'], ATH: ['#ee2523', '#ffffff', 's'],
  CEL: ['#8ac3ee', '#ffffff', 'p'], VIL: ['#ffe667', '#005187', 'p'], DEP: ['#ffffff', '#0067b1', 's'], ESP: ['#007fc8', '#ffffff', 's'],
  OSA: ['#d91a21', '#0a346f', 'p'], RAC: ['#ffffff', '#00a650', 'p'], LEV: ['#b4053f', '#004d98', 's'], ELC: ['#ffffff', '#05642c', 'p'],
  RAY: ['#ffffff', '#e53027', 'p'], GET: ['#005999', '#ffffff', 'p'], VAL: ['#ffffff', '#ee3524', 'p'], MAL: ['#ffffff', '#0061a2', 's'],
  INT: ['#010e80', '#111111', 's'], LAZ: ['#87d8f7', '#ffffff', 'p'], ROM: ['#8e1f2f', '#f0bc42', 'p'], COM: ['#0e2c5a', '#ffffff', 'p'],
  MIL: ['#fb090b', '#111111', 's'], FRO: ['#ffe600', '#004a9b', 'p'], NAP: ['#12a0d7', '#ffffff', 'p'], JUV: ['#ffffff', '#111111', 's'],
  TOR: ['#881f19', '#ffffff', 'p'], CAG: ['#b8122d', '#002350', 'h'], BOL: ['#1a2f48', '#a21c26', 'h'], ATA: ['#1e71b8', '#111111', 's'],
  GEN: ['#ad1919', '#001d4b', 'h'], LEC: ['#ffe300', '#e20613', 's'], SAS: ['#00a752', '#111111', 's'], MON: ['#e30613', '#ffffff', 'p'],
  UDI: ['#ffffff', '#111111', 's'], FIO: ['#482e92', '#ffffff', 'p'], PAR: ['#ffffff', '#1b1b1b', 'p'], VEN: ['#111111', '#f37020', 'p'],
  FCB: ['#dc052d', '#ffffff', 'p'], BVB: ['#fde100', '#111111', 'p'], SCF: ['#e2001a', '#111111', 'p'], B04: ['#e32221', '#111111', 'p'],
  SVE: ['#111111', '#ffffff', 'p'], RBL: ['#ffffff', '#dd0741', 'p'], SVW: ['#1d9053', '#ffffff', 'p'], M05: ['#c3141e', '#ffffff', 'p'],
  FCA: ['#ba3733', '#46714d', 'p'], TSG: ['#1961b5', '#ffffff', 'p'], HSV: ['#ffffff', '#0a3f86', 'p'], KOE: ['#ffffff', '#ed1c24', 'p'],
  SCP: ['#005ca9', '#111111', 'p'], SGE: ['#111111', '#e1000f', 'p'], VFB: ['#ffffff', '#e32219', 'p'], S04: ['#004d9d', '#ffffff', 'p'],
  FCU: ['#eb1923', '#ffffff', 'p'], BMG: ['#ffffff', '#111111', 'p'],
  PSG: ['#004170', '#da291c', 'p'], LIL: ['#e01e13', '#20325f', 'p'], REN: ['#e13327', '#111111', 'p'], ASM: ['#e51b22', '#ffffff', 'h'],
  OL: ['#ffffff', '#14387f', 'p'], PFC: ['#1a2b4c', '#ffffff', 'p'], NIC: ['#c4161c', '#111111', 's'], RCL: ['#ffe600', '#e30613', 'p'],
  OM: ['#ffffff', '#2faee0', 'p'], FCL: ['#f58113', '#111111', 'p'], TFC: ['#3d2a7e', '#ffffff', 'p'], AJA: ['#ffffff', '#0a3f86', 'p'],
  SB29: ['#e30613', '#ffffff', 'p'], SCO: ['#111111', '#ffffff', 's'], LMF: ['#e30613', '#ffffff', 'p'], RCS: ['#009fe3', '#ffffff', 'p'],
  EST: ['#0b4a9b', '#ffffff', 'p'], HAC: ['#0f2d55', '#95c0e5', 'h'],
}
export const DEFAULT_KIT: Kit = ['#d1d5db', '#6b7280', 'p']

const ISO2: Record<string, string> = {
  ALB: 'AL', ALG: 'DZ', ANG: 'AO', ARG: 'AR', ARM: 'AM', AUS: 'AU', AUT: 'AT', BDI: 'BI', BEL: 'BE', BEN: 'BJ', BFA: 'BF', BIH: 'BA',
  BRA: 'BR', BUL: 'BG', CAN: 'CA', CGO: 'CG', CHI: 'CL', CHN: 'CN', CIV: 'CI', CMR: 'CM', COD: 'CD', COL: 'CO', COM: 'KM', CPV: 'CV',
  CRC: 'CR', CRO: 'HR', CTA: 'CF', CZE: 'CZ', DEN: 'DK', DOM: 'DO', ECU: 'EC', EGY: 'EG', EQG: 'GQ', ESP: 'ES', EST: 'EE', FIN: 'FI',
  FRA: 'FR', GAB: 'GA', GAM: 'GM', GEO: 'GE', GER: 'DE', GHA: 'GH', GLP: 'GP', GNB: 'GW', GRE: 'GR', GUI: 'GN', HAI: 'HT', HUN: 'HU',
  IDN: 'ID', IRL: 'IE', ISL: 'IS', ISR: 'IL', ITA: 'IT', JAM: 'JM', JOR: 'JO', JPN: 'JP', KEN: 'KE', KOR: 'KR', KSA: 'SA', KVX: 'XK',
  LTU: 'LT', LUX: 'LU', MAR: 'MA', MAS: 'MY', MEX: 'MX', MKD: 'MK', MLI: 'ML', MNE: 'ME', MOZ: 'MZ', MTN: 'MR', NED: 'NL', NGA: 'NG',
  NIG: 'NE', NIR: 'GB', NOR: 'NO', NZL: 'NZ', PAR: 'PY', PER: 'PE', PHI: 'PH', POL: 'PL', POR: 'PT', ROU: 'RO', RUS: 'RU', SEN: 'SN',
  SLE: 'SL', SRB: 'RS', SUI: 'CH', SUR: 'SR', SVK: 'SK', SVN: 'SI', SWE: 'SE', TAN: 'TZ', THA: 'TH', TOG: 'TG', TUN: 'TN', TUR: 'TR',
  UKR: 'UA', URU: 'UY', USA: 'US', UZB: 'UZ', VEN: 'VE', ZAM: 'ZM', IRN: 'IR', IRQ: 'IQ', QAT: 'QA', UAE: 'AE', RSA: 'ZA', ZIM: 'ZW',
  HON: 'HN', PAN: 'PA', BOL: 'BO', CUW: 'CW', MTQ: 'MQ', CYP: 'CY', MLT: 'MT', LVA: 'LV', BLR: 'BY', MDA: 'MD', AZE: 'AZ', KAZ: 'KZ',
  FRO: 'FO',
}
/** 잉글랜드·스코틀랜드·웨일스 지역 깃발 (태그 시퀀스) */
const SUB: Record<string, string> = {
  ENG: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  SCO: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  WAL: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
}

/** FIFA 국가 코드 → 국기 이모지 */
export function flag(cc: string): string {
  if (SUB[cc]) return SUB[cc]
  const iso = ISO2[cc]
  if (!iso) return '🏳️'
  return String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}
