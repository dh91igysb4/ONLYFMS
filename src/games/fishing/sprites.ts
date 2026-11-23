// 낚시 픽셀 스프라이트. 전부 자체 디자인이며 글자 하나가 픽셀 하나다('.' = 투명).
// 캔버스 내부 색은 theme 토큰 규칙의 승인된 예외(설계 §5)라 여기서 직접 정한다.
// 물고기는 머리가 왼쪽, 16×16 칸 가운데. 캐릭터는 정면(물 쪽)을 보는 16×24.

export type Sprite = { w: number; h: number; rows: string[]; palette: Record<string, string> }

function sprite(palette: Record<string, string>, rows: string[]): Sprite {
  return { w: rows[0].length, h: rows.length, rows, palette }
}

// ── 캐릭터: 청록 비니 + 산호색 방울, 겨자색 바람막이, 남색 바지, 갈색 장화 ──
const PLAYER: Record<string, string> = {
  k: '#2a2135', // 외곽선
  e: '#2a2135', // 눈
  h: '#2f6b7c', // 비니
  H: '#58a3b0', // 비니 골
  p: '#f27d5e', // 방울
  c: '#efe6cc', // 비니 단
  a: '#6b4430', // 머리카락
  s: '#f7cda8', // 피부
  S: '#dda17c', // 피부 그늘
  o: '#f39a8a', // 볼
  m: '#9c4f42', // 입
  j: '#eaa53c', // 바람막이
  J: '#bf7a25', // 바람막이 그늘
  z: '#fbf1d6', // 지퍼
  l: '#424a72', // 바지
  L: '#30365a', // 바지 그늘
  b: '#8a5638', // 장화
  r: '#c08a4c', // 낚싯대
  R: '#5a3a22', // 손잡이
  g: '#c9d1d8', // 릴
}

const PLAYER_IDLE = sprite(PLAYER, [
  '.......kk.......',
  '......kppk......',
  '.....kkppkk...r.',
  '....khhhhhhk..r.',
  '...khHhHhHhhk.r.',
  '...khhhhhhhhk.r.',
  '...kcccccccck.r.',
  '...kassssssak.r.',
  '...kssessessk.r.',
  '...ksossssosk.r.',
  '...ksssmmsssk.r.',
  '....kSssssSk..r.',
  '...kjjjzzjjjk.r.',
  '..kjjjjzzjjjjkr.',
  '..kJjjjzzjjjJkr.',
  '..kJjjjzzjjjJksk',
  '..ksJjjzzjjjJkR.',
  '...kjjjzzjjjk.R.',
  '...kJJJJJJJJk...',
  '...kllllllllk...',
  '...klllkklllk...',
  '...kLllkkLllk...',
  '..kbbbbkkbbbbk..',
  '..kkkkk..kkkkk..',
])

const PLAYER_CAST = sprite(PLAYER, [
  '.....rkk........',
  '......rpk.......',
  '.....kkrpkk.....',
  '....khhhrhhk....',
  '...khHhHhrhhk...',
  '...khhhhhhrhk...',
  '...kcccccccrk...',
  '...kassssssaRkk.',
  '...kseesseeskssk',
  '...ksossssoskSsk',
  '...ksssmmssskJk.',
  '....kSssssSkJk..',
  '...kjjjzzjjJjk..',
  '..kjjjjzzjjjjk..',
  '..kJjjjzzjjjJk..',
  '..kJjjjzzjjjJk..',
  '..ksJjjzzjjjJk..',
  '...kjjjzzjjjk...',
  '...kJJJJJJJJk...',
  '...kllllllllk...',
  '...klllkklllk...',
  '...kLllkkLllk...',
  '..kbbbbkkbbbbk..',
  '..kkkkk..kkkkk..',
])

const PLAYER_REEL = sprite(PLAYER, [
  '.......kk.......',
  '......kppk......',
  '.....kkppkk.....',
  '....khhhhhhk....',
  '...khHhHhHhhk...',
  '...khhhhhhhhk...',
  '...kcccccccck...',
  '...kassssssak...',
  '...kssessessk...',
  '...ksossssosk...',
  '...ksssmmsssk...',
  '....kSssssSk....',
  '...kjjjzzjjjk...',
  '..kjjjjzzjjjjk..',
  '..kJjjjzzjjjJk..',
  '..kJJjkssskJJk..',
  '..kjjksgRskjjk..',
  '...kjjjkkrkjk...',
  '...kJJJJJJrJk...',
  '...klllllllrk...',
  '...klllkklllrk..',
  '...kLllkkLllkr..',
  '..kbbbbkkbbbbkr.',
  '..kkkkk..kkkkk.r',
])

// ── 물: 2프레임, 가장자리끼리 이어진다 ──
const WATER: Record<string, string> = {
  a: '#2f7fb5', // 바탕
  d: '#2a72a5', // 깊은 결
  b: '#4c9dd1', // 물결 몸
  c: '#a6dcf2', // 물결 마루
}

const WATER_0 = sprite(WATER, [
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaadda',
  'aaacccaaaaaaaaaa',
  'aabaaabaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaddaaaaaaa',
  'aaaaaaaaaaaccaaa',
  'aaaaaaaaaabaabaa',
  'aaaaaaaaaaaaaaaa',
  'adaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaccaaaaaaaaa',
  'aaaabaabaaaaadaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
])

const WATER_1 = sprite(WATER, [
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaada',
  'aaaaaaaaaaaaaaaa',
  'aaaacccaaaaaaaaa',
  'aaabaaabaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaddaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaacccaa',
  'aaaaaaaaaabaaaba',
  'aaaaaaaaaaaaaaaa',
  'aadaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaacaaaaaaaaa',
  'aaaaabaabaaaaaaa',
  'aaaaaaaaaaaaadaa',
])

// ── 부두: 가로 판자 두 장 + 장선 못, 둥근 기둥 ──
const WOOD: Record<string, string> = {
  n: '#3b2a22', // 틈·못
  U: '#e2b07a', // 판자 윗면 밝은 줄
  u: '#c8925a', // 판자
  g: '#a8723f', // 나뭇결
  G: '#86562f', // 판자 아래 그늘
  k: '#3b2a22',
  c: '#d8eef8', // 물거품
  w: '#2f7fb5', // 기둥 둘레 물
}

const PIER_PLANK = sprite(WOOD, [
  'UUUUUUUUUUUUUUUU',
  'unuuuuuuuuuuuunu',
  'uuuugggguuuuuuuu',
  'uuuuuuuuuuuggguu',
  'uuuuuuuuuuuuuuuu',
  'unuuuuggguuuuunu',
  'GGGGGGGGGGGGGGGG',
  'nnnnnnnnnnnnnnnn',
  'UUUUUUUUUUUUUUUU',
  'unuuuuuuuuuuuunu',
  'uuuuuuuuuggguuuu',
  'uugggguuuuuuuuuu',
  'uuuuuuuuuuuuuuuu',
  'unuuuuuuuuggguun',
  'GGGGGGGGGGGGGGGG',
  'nnnnnnnnnnnnnnnn',
])

const PIER_POST = sprite(WOOD, [
  '..kkkk..',
  '.kuuuuk.',
  'kuUUUUuk',
  'kuUggUuk',
  'kuUUUUuk',
  'kGuuuuGk',
  'kGGgGGGk',
  'kGgGGgGk',
  'kGGGgGGk',
  'kGGGGGGk',
  'ckkkkkkc',
  '.cccccc.',
])

// ── 찌·느낌표·물보라 ──
const BOBBER = sprite(
  { k: '#2a2135', y: '#ffe066', r: '#e8473c', R: '#ff7d6b', w: '#f7f3ea', W: '#cfc8bb' },
  [
    '...k...',
    '...y...',
    '..kkk..',
    '.kRrrk.',
    'kRrrrrk',
    'kwwwwwk',
    'kwwwwWk',
    '.kwwWk.',
    '..kkk..',
  ],
)

const BANG = sprite({ k: '#2a2135', y: '#ffd23f', Y: '#fff3b0' }, [
  '.kkk.',
  'kyYyk',
  'kyYyk',
  'kyyyk',
  'kyyyk',
  '.kyk.',
  '.kyk.',
  '..k..',
  '.kkk.',
  '.kyk.',
  '.kkk.',
])

const SPLASH = sprite({ w: '#ffffff', c: '#bfe6f7' }, [
  '.w.....w.',
  '..c.w.c..',
  'w..c.c..w',
  '.cc...cc.',
  'c.......c',
])

const SWEAT = sprite({ k: '#2a2135', b: '#8fd3ff', w: '#ffffff' }, ['.k.', 'kbk', 'kwb', '.k.'])

const SPARKLE = sprite({ y: '#fff3b0', w: '#ffffff' }, ['..y..', '..w..', 'ywwwy', '..w..', '..y..'])

// 물속을 지나가는 물고기 그림자(배경 장식)
const FISH_SHADOW = sprite({ s: '#276b9d' }, [
  '...ssss...',
  '.sssssss.s',
  'ssssssssss',
  '.sssssss.s',
  '...ssss...',
])

// 물 위로 솟은 바위(배경 장식)
const ROCK = sprite(
  { k: '#26303a', G: '#b3bfc6', g: '#8796a0', d: '#5d6b76', m: '#79a35e', c: '#e9f6fb', w: '#a6dcf2' },
  [
    '....kkkkk.....',
    '..kkGGGGgkk...',
    '.kGGGggGggdk..',
    'kGGgmggggddk..',
    'kgggmmggdddkk.',
    'kdggggddddddk.',
    '.kddddddddkk..',
    'ccckkkkkkkccc.',
    '.wcccw.cccw...',
  ],
)

// 바 트랙 위 물고기 아이콘: 초록 바 위에서도 보이게 밝은 몸 + 진한 외곽선
const TRACK_FISH = sprite({ k: '#2a2135', o: '#ff9f43', O: '#ffd08a', e: '#2a2135' }, [
  '..kkkk..k',
  '.kOOOOkkk',
  'kOeOoookk',
  'koooookok',
  '.kooookkk',
  '..kkkk..k',
])

// ── 물고기 12종 ──
const FISH_ANCHOVY = sprite(
  { k: '#1c2a3a', b: '#3f6e9c', t: '#8fb4d0', s: '#c9d6e0', w: '#f1f6f9', e: '#0d1620', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '................',
    '.............k..',
    '...kkkkkkk..kbk.',
    '..kbbbbbbbkkbbk.',
    '.kWebbbbbbbbbbk.',
    'kstttttttttttk..',
    '.kwwwwwwwwkkbbk.',
    '..kkkkkkkk..kbk.',
    '.............k..',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_GOBY = sprite(
  { k: '#2e2418', b: '#a38a5e', d: '#5f4a2f', w: '#eadfc4', y: '#c9ad78', e: '#111111', W: '#ffffff', m: '#4a3a26', t: '#d8bf8a', T: '#9c8358' },
  [
    '................',
    '................',
    '................',
    '..kk.kk.........',
    '.kWekWek.kkk.k..',
    'kbbbbbbbkyyyktk.',
    'kbbbbdbbbbdbbttk',
    'kmbbdbbbbdbbbTtk',
    'kwwwbbdbbbdbbttk',
    '.kwwyywwwwbbktk.',
    '..kyyykkkkkk.k..',
    '...kkk..........',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_HORSE_MACKEREL = sprite(
  { k: '#1e2b2a', g: '#5f857c', G: '#86a89d', s: '#c9d5d2', y: '#d9c66b', d: '#3c524d', w: '#eef3f1', e: '#0b1110', W: '#ffffff', x: '#1a2422' },
  [
    '................',
    '................',
    '..............k.',
    '...kkkkkk....kgk',
    '..kggggggkkk.kgk',
    '.kggggggggggkggk',
    'kWeGGGGGGGGGggk.',
    'ksxdddddyyyydgk.',
    'kssssssssdddggk.',
    '.kwwwwwwwwwkkggk',
    '..kwwwwwwkk..kgk',
    '...kkkkkk....kgk',
    '..............k.',
    '................',
    '................',
    '................',
  ],
)

const FISH_MACKEREL = sprite(
  { k: '#14262a', g: '#2f8a86', G: '#56b3a8', x: '#122224', s: '#d3dde0', w: '#f4f7f8', e: '#0a0f10', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '..............k.',
    '....kkkkkk...kgk',
    '..kkgxgxgxkk.kgk',
    '.kgxggxggxgxkggk',
    'kWexgGxgGxgxggk.',
    'ksssssssssssgk..',
    '.kwwwwwwwwwwggk.',
    '..kkwwwwwwkkkggk',
    '....kkkkkk...kgk',
    '..............k.',
    '................',
    '................',
    '................',
  ],
)

const FISH_MULLET = sprite(
  { k: '#22272c', g: '#5e6b76', G: '#7f8d98', l: '#4b5660', s: '#b9c3ca', w: '#e6ebee', e: '#0b0d0f', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '.....k..k.......',
    '...kkgkkgkk...k.',
    '..kggggggggk.kgk',
    '.kgGGGGGGGGgkggk',
    'kWelllllllllGgk.',
    'kssssssssssssgk.',
    '.klllllllllllggk',
    '..kwwwwwwwwkkggk',
    '...kkkkkkkk..kgk',
    '..............k.',
    '................',
    '................',
    '................',
  ],
)

const FISH_ROCKFISH = sprite(
  { k: '#15161a', b: '#3d4048', B: '#5a5e68', d: '#26282e', s: '#8d919b', W: '#ffffff', E: '#111111', r: '#9a4b4b', m: '#1e1f24', t: '#5a5e68' },
  [
    '................',
    '................',
    '....k.k.k.k.....',
    '...kdkdkdkdk....',
    '..kdBdBdBdBdkk..',
    '.kbbbbbbbbbbktk.',
    'kbWEbbdbbBbbkttk',
    'kbEEbdbbbbdbbttk',
    'kmbbbbbbdbbbbttk',
    'kmrbbBbbbbdbbttk',
    'kbsssbbbbdbbkttk',
    '.kssssssbbbkktk.',
    '..ksssssskk..k..',
    '...kkkkkk.......',
    '................',
    '................',
  ],
)

const FISH_FLOUNDER = sprite(
  { k: '#2b2219', b: '#8c7150', B: '#a88b66', d: '#5b4630', f: '#c4a77c', W: '#ffffff', e: '#111111', t: '#7a6044' },
  [
    '................',
    '................',
    '....kkkkkkkk....',
    '..kkffffffffkk..',
    '.kffbbbbbbbbffk.',
    'kfbWebbdbbbBbfk.',
    'kfbbbbBbbbdbbftk',
    'kfWebbbbdbbBbftk',
    'kfbbdbbbbbbbdftk',
    'kfbBbbbdbbbbbftk',
    '.kfbbbdbbbBbfkk.',
    '..kffbbbbbbffk..',
    '...kkffffffkk...',
    '.....kkkkkk.....',
    '................',
    '................',
  ],
)

const FISH_SQUID = sprite(
  { k: '#3a1f2a', p: '#f1d9d6', P: '#f8eae7', r: '#d47a7a', R: '#b2555e', e: '#1a1a1a', w: '#ffffff' },
  [
    '.......kk.......',
    '.....kkppkk.....',
    '....kpPPPppk....',
    '...kppPrPpppk...',
    '..kkppPpprpkkk..',
    '..k.kpprpppk.k..',
    '.....kpppPpk....',
    '.....kprpppk....',
    '.....kppprpk....',
    '.....kweppewk...',
    '.....kpppppk....',
    '....krkrkrkrk...',
    '....kr.rkr.rk...',
    '...kr..rkr..rk..',
    '...kk.kr.rk.kk..',
    '......kk.kk.....',
  ],
)

const FISH_RED_SEABREAM = sprite(
  { k: '#3a1520', r: '#e2626b', R: '#f08e8f', d: '#b23d4c', b: '#5fc4e8', s: '#f6c1bd', e: '#111111', W: '#ffffff' },
  [
    '................',
    '................',
    '......kkk.......',
    '....kkrrrkk...k.',
    '...krRRRRrrkkkrk',
    '..krRRbRRRRrrkrk',
    '.krRRRRRbRRRrrrk',
    'krWeRRRRRRbRrrk.',
    'krRRRbRRRRRRrrk.',
    '.krRRRRRbRRrrrrk',
    '..ksssssssssrkrk',
    '...ksssssssskkrk',
    '....kksssskk..k.',
    '......kkkk......',
    '................',
    '................',
  ],
)

const FISH_SEABASS = sprite(
  { k: '#1b2128', g: '#4f6170', G: '#76889a', d: '#1e252c', s: '#c8d1d8', w: '#eef2f5', e: '#0b0d10', W: '#ffffff', x: '#1e252c', m: '#2a3138', j: '#c8d1d8' },
  [
    '................',
    '................',
    '................',
    '....k.k.k.......',
    '...kdkdkdkkk..k.',
    '..kdddddkgggkkgk',
    '.kgggxggggxgkggk',
    'kWeGGGGxGGGGGgk.',
    'kmmsssssssssgk..',
    'kjwwwwwwwwwwggk.',
    '.kwwwwwwwwwkkggk',
    '..kkkkkkkkk..kgk',
    '..............k.',
    '................',
    '................',
    '................',
  ],
)

const FISH_YELLOWTAIL = sprite(
  { k: '#14202e', b: '#355c86', B: '#5583b0', y: '#f2cc3d', s: '#d4dde6', w: '#f4f7fa', e: '#0a0f15', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '..............k.',
    '....kkkkkk...kyk',
    '..kkbbbbbbkk.kyk',
    '.kbbBBBBBBbbkyyk',
    'kWeyyyyyyyyyyyk.',
    'ksssssssssssyk..',
    '.kwwwwwwwwwwyyk.',
    '..kkwwwwwwkkkyyk',
    '....kkkkkk...kyk',
    '..............k.',
    '................',
    '................',
    '................',
  ],
)

const FISH_GROUPER = sprite(
  { k: '#1d1414', b: '#6e4a3f', B: '#8d6455', d: '#45302a', f: '#a07a5a', w: '#e8d6c4', W: '#ffffff', E: '#111111', m: '#c58f7a' },
  [
    '................',
    '...k.k.k.k......',
    '..kdkdkdkdk.....',
    '.kdbdbdbdbdk.k..',
    '.kbbbbbbbbbbkfk.',
    'kbWEbddbbbddkffk',
    'kbEEbddbBbddbffk',
    'kmbbbddbbbddbffk',
    'kmmbBddbbbddbffk',
    'kmbbbddbBbddbffk',
    '.kwwbddbbbddkffk',
    '..kwwwwwwbbbkfk.',
    '...kkwwwwkkk.k..',
    '.....kkkk.......',
    '................',
    '................',
  ],
)

// ── 낚싯대 4종: 왼쪽 아래 손잡이 → 오른쪽 위 끝 ──
const ROD_1 = sprite({ k: '#2b2118', a: '#e2c27a', b: '#8f7438', h: '#7a5a3a', H: '#a07a4e', l: '#f4f4f4' }, [
  '..............k.',
  '.............kak',
  '............kak.',
  '...........kbk..',
  '..........kak...',
  '.........kak....',
  '........kbk.....',
  '.......kak......',
  '......kak.......',
  '.....kbk........',
  '....kak.........',
  '...kHhk.........',
  '..khHk..........',
  '.kHhk...........',
  'khHk............',
  'kkk.............',
])

const ROD_2 = sprite(
  { k: '#2b2118', a: '#f3ecc4', r: '#d0443a', c: '#c99a62', C: '#a87a48', g: '#b8c0c8', G: '#7d8791' },
  [
    '..............k.',
    '.............kak',
    '............kak.',
    '...........krk..',
    '..........kak...',
    '.........kak....',
    '........krk.....',
    '.......kak......',
    '......kak.......',
    '.....krk........',
    '..kkkak.........',
    '.kgGkkk.........',
    '.kGgkCk.........',
    '..kkCck.........',
    '.kcCk...........',
    'kkk.............',
  ],
)

const ROD_3 = sprite(
  { k: '#14161a', a: '#3a3f48', A: '#6b7888', b: '#3d8de0', h: '#22252b', g: '#9aa8b8', G: '#5e6c7c' },
  [
    '..............k.',
    '.............kAk',
    '............kak.',
    '...........kbk..',
    '..........kAk...',
    '.........kak....',
    '........kbk.....',
    '.......kAk......',
    '......kak.......',
    '.....kbk........',
    '..kkkAk.........',
    '.kgGkkk.........',
    '.kGgkhk.........',
    '..kkhhk.........',
    '.khhk...........',
    'kkk.............',
  ],
)

const ROD_4 = sprite(
  { k: '#1e0f10', a: '#8e1f2a', A: '#c8404a', y: '#f2c14e', Y: '#fff0b0', h: '#6a4426', H: '#8d5e36' },
  [
    '.............Y..',
    '............YkY.',
    '.............kAk',
    '............kak.',
    '...........kyk..',
    '..........kAk...',
    '.........kak....',
    '........kyk.....',
    '.......kAk......',
    '......kak.......',
    '..kkkkyk........',
    '.kyYkkk.........',
    '.kYykHk.........',
    '..kkhHk.........',
    '.kyhk...........',
    'kkk.............',
  ],
)

export const SPRITES: Record<string, Sprite> = {
  'player-idle': PLAYER_IDLE,
  'player-cast': PLAYER_CAST,
  'player-reel': PLAYER_REEL,
  'water-0': WATER_0,
  'water-1': WATER_1,
  'pier-plank': PIER_PLANK,
  'pier-post': PIER_POST,
  bobber: BOBBER,
  bang: BANG,
  splash: SPLASH,
  sweat: SWEAT,
  sparkle: SPARKLE,
  'track-fish': TRACK_FISH,
  'fish-shadow': FISH_SHADOW,
  rock: ROCK,
  'fish-anchovy': FISH_ANCHOVY,
  'fish-goby': FISH_GOBY,
  'fish-horse-mackerel': FISH_HORSE_MACKEREL,
  'fish-mackerel': FISH_MACKEREL,
  'fish-mullet': FISH_MULLET,
  'fish-rockfish': FISH_ROCKFISH,
  'fish-flounder': FISH_FLOUNDER,
  'fish-squid': FISH_SQUID,
  'fish-red-seabream': FISH_RED_SEABREAM,
  'fish-seabass': FISH_SEABASS,
  'fish-yellowtail': FISH_YELLOWTAIL,
  'fish-grouper': FISH_GROUPER,
  'rod-1': ROD_1,
  'rod-2': ROD_2,
  'rod-3': ROD_3,
  'rod-4': ROD_4,
}

const SILHOUETTE = '#1b1f2a'

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  scale: number,
  opts?: { silhouette?: boolean },
): void {
  const sp = SPRITES[name]
  if (!sp) throw new Error(`unknown sprite: ${name}`)
  const silhouette = opts?.silhouette === true
  // 같은 색이 가로로 이어지면 한 번에 칠한다
  for (let row = 0; row < sp.h; row++) {
    const line = sp.rows[row]
    let col = 0
    while (col < sp.w) {
      const ch = line[col]
      if (ch === '.') {
        col++
        continue
      }
      const color = silhouette ? SILHOUETTE : sp.palette[ch]
      let end = col + 1
      while (end < sp.w && line[end] !== '.' && (silhouette || line[end] === ch)) end++
      ctx.fillStyle = color
      ctx.fillRect(x + col * scale, y + row * scale, (end - col) * scale, scale)
      col = end
    }
  }
}

const dataUrlCache = new Map<string, string>()

/** 메뉴(DOM)용 PNG 주소. 브라우저 전용, (이름, 배율, 실루엣)마다 한 번만 만든다. */
export function spriteDataUrl(name: string, scale: number, opts?: { silhouette?: boolean }): string {
  const silhouette = opts?.silhouette === true
  const key = `${name}|${scale}|${silhouette ? 1 : 0}`
  const hit = dataUrlCache.get(key)
  if (hit !== undefined) return hit
  const sp = SPRITES[name]
  if (!sp) throw new Error(`unknown sprite: ${name}`)
  const canvas = document.createElement('canvas')
  canvas.width = sp.w * scale
  canvas.height = sp.h * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')
  drawSprite(ctx, name, 0, 0, scale, { silhouette })
  const url = canvas.toDataURL('image/png')
  dataUrlCache.set(key, url)
  return url
}
