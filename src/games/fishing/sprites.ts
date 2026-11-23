// 낚시 픽셀 스프라이트. 전부 자체 디자인이며 글자 하나가 픽셀 하나다('.' = 투명).
// 캔버스 내부 색은 theme 토큰 규칙의 승인된 예외(설계 §5)라 여기서 직접 정한다.
// 물고기는 머리가 왼쪽, 16×16 칸 가운데. 캐릭터는 16×24, 아래·위·옆(오른쪽) 세 방향이고 왼쪽은 flipX로 그린다.
// 마을 타일은 16×16(나무 16×32, 상점 80×64). 땅 타일은 칸을 꽉 채우고, 돌·울타리·나무·상점은 배경이 투명해 땅 위에 얹는다.

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
  A: '#4e2f20', // 뒷머리 그늘
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

// ── 4방향 걷기·낚시 자세 ──
// 아래: 기존 정지 그림에 다리 교대 + 방울 흔들림. 위: 뒷모습(뒷머리, 등판 후드), 낚싯대는 왼손 쪽.
// 옆(오른쪽을 봄): 낚싯대를 등 뒤로 비스듬히 멘다. 걷기 0은 보폭(몸 1px 아래, 팔 앞), 1은 뒷발을 드는 순간.
// 낚싯대 끝(스프라이트 안 좌표): cast-up [3, 0], reel-up [14, 0], cast-side [0, 0], reel-side [15, 16].
const PLAYER_WALK_DOWN_0 = sprite(PLAYER, [
  '......kk........',
  '.....kppk.......',
  '.....kppkkk...r.',
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
  '...kLllkkbbbbk..',
  '..kbbbbkkkkkk...',
  '..kkkkk.........',
])

const PLAYER_WALK_DOWN_1 = sprite(PLAYER, [
  '........kk......',
  '.......kppk.....',
  '.....kkkppk...r.',
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
  '..kbbbbkkLllk...',
  '...kkkkkkbbbbk..',
  '.........kkkkk..',
])

const PLAYER_IDLE_UP = sprite(PLAYER, [
  '.......kk.......',
  '......kppk......',
  '.r...kkppkk.....',
  '.r..khhhhhhk....',
  '.r.khhHhHhHhk...',
  '.r.khhhhhhhhk...',
  '.r.kcccccccck...',
  '.r.kaaaaaaaak...',
  '.r.kaaaaaaaak...',
  '.r.kAaaaaaaAk...',
  '.r.ksAaaaaAsk...',
  '.r..kSAAAASk....',
  '.r.kjJJJJJJjk...',
  '.rkjjJjjjjJjjk..',
  '.rkJjjJJJJjjJk..',
  'kskJjjjjjjjjJk..',
  '.RkJjjjjjjjJsk..',
  '.R.kjjjjjjjjk...',
  '...kJJJJJJJJk...',
  '...kllllllllk...',
  '...klllkklllk...',
  '...kLllkkLllk...',
  '..kbbbbkkbbbbk..',
  '..kkkkk..kkkkk..',
])

const PLAYER_WALK_UP_0 = sprite(PLAYER, [
  '........kk......',
  '.......kppk.....',
  '.r...kkkppk.....',
  '.r..khhhhhhk....',
  '.r.khhHhHhHhk...',
  '.r.khhhhhhhhk...',
  '.r.kcccccccck...',
  '.r.kaaaaaaaak...',
  '.r.kaaaaaaaak...',
  '.r.kAaaaaaaAk...',
  '.r.ksAaaaaAsk...',
  '.r..kSAAAASk....',
  '.r.kjJJJJJJjk...',
  '.rkjjJjjjjJjjk..',
  '.rkJjjJJJJjjJk..',
  'kskJjjjjjjjjJk..',
  '.RkJjjjjjjjJsk..',
  '.R.kjjjjjjjjk...',
  '...kJJJJJJJJk...',
  '...kllllllllk...',
  '...klllkklllk...',
  '...kLllkkbbbbk..',
  '..kbbbbkkkkkk...',
  '..kkkkk.........',
])

const PLAYER_WALK_UP_1 = sprite(PLAYER, [
  '......kk........',
  '.....kppk.......',
  '.r...kppkkk.....',
  '.r..khhhhhhk....',
  '.r.khhHhHhHhk...',
  '.r.khhhhhhhhk...',
  '.r.kcccccccck...',
  '.r.kaaaaaaaak...',
  '.r.kaaaaaaaak...',
  '.r.kAaaaaaaAk...',
  '.r.ksAaaaaAsk...',
  '.r..kSAAAASk....',
  '.r.kjJJJJJJjk...',
  '.rkjjJjjjjJjjk..',
  '.rkJjjJJJJjjJk..',
  'kskJjjjjjjjjJk..',
  '.RkJjjjjjjjJsk..',
  '.R.kjjjjjjjjk...',
  '...kJJJJJJJJk...',
  '...kllllllllk...',
  '...klllkklllk...',
  '..kbbbbkkLllk...',
  '...kkkkkkbbbbk..',
  '.........kkkkk..',
])

const PLAYER_IDLE_SIDE = sprite(PLAYER, [
  '.......kk.......',
  'r.....kppk......',
  '.r...kkppkk.....',
  '.r..khhhhhhk....',
  '.r.khhHhHhHhk...',
  '..rkhhhhhhhhk...',
  '..rkcccccccck...',
  '..rkaaaassssk...',
  '..rkaaSsssesk...',
  '..rkaaSssosssk..',
  '..rkaassssmsk...',
  '...rkaSsssSk....',
  '...rkjjjjjjk....',
  '...kjJjjJjjzk...',
  '...kjJjjJjjzk...',
  '...kjJjjJjjzk...',
  '...kjJjjJjjzk...',
  '...kjJssJjjzk...',
  '...RkJkkJJJk....',
  '...Rkllllllk....',
  '....kllllllk....',
  '....kLllllLk....',
  '....kbbbbbbbk...',
  '....kkkkkkkkk...',
])

const PLAYER_WALK_SIDE_0 = sprite(PLAYER, [
  '................',
  '.......kk.......',
  'r.....kppk......',
  '.r...kkppkk.....',
  '.r..khhhhhhk....',
  '.r.khhHhHhHhk...',
  '..rkhhhhhhhhk...',
  '..rkcccccccck...',
  '..rkaaaassssk...',
  '..rkaaSsssesk...',
  '..rkaaSssosssk..',
  '..rkaassssmsk...',
  '...rkaSsssSk....',
  '...rkjjjjjjk....',
  '...kjjjjjjjzk...',
  '...kjjjJjjjzk...',
  '...kjjjjJjjzk...',
  '...kjjjjjJszk...',
  '...RkJJJJJskk...',
  '...Rklllllllk...',
  '...klllkkkllk...',
  '..kLllk..kLllk..',
  '.kbbbbk..kbbbbk.',
  '.kkkkk...kkkkkk.',
])

const PLAYER_WALK_SIDE_1 = sprite(PLAYER, [
  '.......kk.......',
  'r.....kppk......',
  '.r...kkppkk.....',
  '.r..khhhhhhk....',
  '.r.khhHhHhHhk...',
  '..rkhhhhhhhhk...',
  '..rkcccccccck...',
  '..rkaaaassssk...',
  '..rkaaSsssesk...',
  '..rkaaSssosssk..',
  '..rkaassssmsk...',
  '...rkaSsssSk....',
  '...rkjjjjjjk....',
  '...kjjjjjjjzk...',
  '...kjJjjjjjzk...',
  '...kJjjjjjjzk...',
  '..ksJjjjjjjzk...',
  '...kkjjjjjjzk...',
  '....kJJJJJJk....',
  '...kkllllllk....',
  '..kbblllllk.....',
  '..kkbkLllLk.....',
  '....kkbbbbbk....',
  '.....kkkkkkk....',
])

const PLAYER_CAST_UP = sprite(PLAYER, [
  '...r............',
  '....r..kk.......',
  '.....rkppk......',
  '.....kkrpkk.....',
  '....khhhrhhk....',
  '...khhHhHrHhk...',
  '...khhhhhhrhk...',
  '...kcccccccRk...',
  '...kaaaaaaaRsk..',
  '...kaaaaaaaksk..',
  '...kAaaaaaaAkJk.',
  '...ksAaaaaAskJk.',
  '....kSAAAASkjJk.',
  '...kjJJJJJJjJk..',
  '..kjjJjjjjJjjk..',
  '..kJjjJJJJjjJk..',
  '..kJjjjjjjjjJk..',
  '..ksjjjjjjjJk...',
  '...kjjjjjjjjk...',
  '...kJJJJJJJJk...',
  '...kllllllllk...',
  '...kLllkkLllk...',
  '..kbbbbkkbbbbk..',
  '..kkkkk..kkkkk..',
])

const PLAYER_REEL_UP = sprite(PLAYER, [
  '.......kk.....r.',
  '......kppk...r..',
  '.....kkppkk.r...',
  '....khhhhhhkr...',
  '...khhHhHhHrk...',
  '...khhhhhhhrk...',
  '...kcccccccck...',
  '...kaaaaaaaak...',
  '...kaaaaaaaak...',
  '...kAaaaaaaAk...',
  '...ksAaaaaAsk...',
  '....kSAAAASk....',
  '...kjJJJJJJjk...',
  '..kjjJjjjjJjjk..',
  '..kJjjJJJJjjJkk.',
  '..kJjjjjjjjjkgsk',
  '..kJjjjjjjjjJkk.',
  '...kjjjjjjjjk...',
  '...kJJJJJJJJk...',
  '...kllllllllk...',
  '...klllkklllk...',
  '...kLllkkLllk...',
  '..kbbbbkkbbbbk..',
  '..kkkkk..kkkkk..',
])

const PLAYER_CAST_SIDE = sprite(PLAYER, [
  'r.....k.........',
  '.r...kpk........',
  '..r.kkppkkk.....',
  '...rkhhhhhhk....',
  '...rRhHhHhHhk...',
  '...kRsshhhhhk...',
  '...kssscccccck..',
  '...kJsaassssk...',
  '...kJkaSsesk....',
  '...kJkaSsosssk..',
  '...kjkassssmk...',
  '...kjkaSsssSk...',
  '...kjjkjjjjk....',
  '...kjjjjjjjzk...',
  '...kjjjjjjjzk...',
  '...kjjjjjjjzk...',
  '...kjjjjjjjzk...',
  '...kjjjjjjjzk...',
  '....kJJJJJJk....',
  '....kllllllk....',
  '...klllkklllk...',
  '...kLllk.kLllk..',
  '..kbbbbk.kbbbbk.',
  '..kkkkk..kkkkkk.',
])

const PLAYER_REEL_SIDE = sprite(PLAYER, [
  '.......kk.......',
  '......kppk......',
  '.....kkppkk.....',
  '....khhhhhhk....',
  '...khhHhHhHhk...',
  '...khhhhhhhhk...',
  '...kcccccccck...',
  '...kaaaassssk...',
  '...kaaSsssesk...',
  '...kaaSssosssk..',
  '...kaassssmsk...',
  '....kaSsssSk....',
  '....kjjjjjjk....',
  '...kjjjjjjjzk...',
  '...kjjJJJJkkk...',
  '...kjjjjksgsRrr.',
  '...kjjjjjkkkk..r',
  '...kjjjjjjjzk...',
  '....kJJJJJJk....',
  '....kllllllk....',
  '...klllkklllk...',
  '...kLllk.kLllk..',
  '..kbbbbk.kbbbbk.',
  '..kkkkk..kkkkkk.',
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

// ── 새 물고기 4종(밤·비 날씨에 나오는 것들) ──
const FISH_HAIRTAIL = sprite(
  { k: '#2b3a48', s: '#c9d8e2', S: '#eef4f8', t: '#8fa8ba', f: '#a9c0d0', e: '#0d1620', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '...fffffffffff..',
    '..kkkkkkkkkkkkk.',
    '.kSWeSssssssssk.',
    'kSSSSsssssssstkk',
    '.kttttttttttkk..',
    '..kkkkkkkkkk....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_CONGER = sprite(
  { k: '#2a1d14', b: '#7a5a3a', B: '#a07c54', d: '#4d3822', m: '#d9a98a', e: '#111111', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.kkkk...........',
    'kBWebkkkkkkkk...',
    'kmbbbBBBBBBBbkk.',
    'kmmbbbbbbbbbbddk',
    '.kkbbddddddbbdk.',
    '...kkkkkkkkkkk..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_PUFFERFISH = sprite(
  { k: '#2a2a1c', b: '#d9a441', B: '#f0c869', d: '#8a6a2a', f: '#c4873a', w: '#f6efd0', m: '#e8907a', e: '#111111', W: '#ffffff' },
  [
    '................',
    '......k..k......',
    '.....kkkkkk.....',
    '...kkBBBBBBkk...',
    '..kBBBbbbdbbbk..',
    '.kBBbbbbbbbbbbk.',
    'kbbWebbbbdbbbkff',
    'kmbbbbbbbbbbbkff',
    '.kwwbbbbbddbbkf.',
    '.kwwwwwwwwwwwk..',
    '..kkwwwwwwwkk...',
    '....kkkkkkk.....',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_OCTOPUS = sprite(
  { k: '#3a1f2e', b: '#b8485a', B: '#d9697a', d: '#8a2f45', e: '#111111', W: '#ffffff' },
  [
    '................',
    '.....kkkkkk.....',
    '...kkBBBBBBkk...',
    '..kBBBbbbbbbbk..',
    '.kBBbbbbbbbbbbk.',
    '.kbbbbbbbdbbbbk.',
    '.kbWebbbbbbeWbk.',
    '.kbbbbbbbbbbbbk.',
    '..kbbbddbbddbk..',
    '.kbkbbkbbkbbkbk.',
    'kbk.kbk..kbk.kbk',
    'kk...k....k...kk',
    '................',
    '................',
    '................',
    '................',
  ],
)

// ── 강·숲 물고기 17종 ──
const FISH_PALE_CHUB = sprite(
  { k: '#1f2b3a', b: '#6f8fa8', s: '#b9ccd8', S: '#e6eef3', p: '#ee7f9a', f: '#e3a4b3', w: '#f3f6f8', e: '#0d1620', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '................',
    '.............k..',
    '...kkkkkkk..kfk.',
    '..kbbbbbbbkkffk.',
    '.kWebbbbbbbbffk.',
    'kSsppppppppppk..',
    '.kwwwwwwwwkkffk.',
    '..kkkkkkkk..kfk.',
    '.............k..',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_DARK_CHUB = sprite(
  { k: '#262a1c', b: '#8a8a5a', d: '#23251a', s: '#c4c9ba', w: '#e6e8d6', f: '#c9b27a', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '................',
    '...kkkkkkkk..k..',
    '..kbbbdbbdbkkfk.',
    '.kWebbbdbbdbbffk',
    'kssbbbdbbdbbkfk.',
    '.kwwwwdwwdwwkfk.',
    '..kkkkkkkkkk.k..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_SKIN_CARP = sprite(
  { k: '#2a3038', g: '#8f9aa6', G: '#b8c2cc', d: '#5f6b78', w: '#dfe5ea', f: '#9aa6b3', m: '#d9a98a', e: '#0d1117', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '................',
    '...kkkkkkkkk..k.',
    '..kGGgggggggkkfk',
    '.kGWegggdgggdffk',
    'kGGGggggggggkkfk',
    'kmkwwwwwwwwwk.k.',
    '.kkkkkkkkkkk..k.',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_AUCHA_PERCH = sprite(
  { k: '#2a1d14', b: '#7a5a3a', B: '#9c7a52', d: '#4d3822', w: '#f4ecd8', n: '#4a7fd0', f: '#9a7a52', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '....k.k.k.k.....',
    '...kdkdkdkdk..k.',
    '..kbbbBBbbbbkkfk',
    '.kbWebwbbwbbbffk',
    'kbbbnnbbbwbbbkfk',
    'kbbbnbwbbbwbbkfk',
    '.kwwwwwwwwwwk.k.',
    '..kkkkkkkkkk....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_SWEETFISH = sprite(
  { k: '#2b3a2a', b: '#7da06a', B: '#a8c48c', s: '#d6e3cc', y: '#f2c43a', Y: '#ffe27a', w: '#f4f6ec', e: '#0d160d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '................',
    '..........yy....',
    '..kkkkkkkkkkk.k.',
    '.kbbbbbbbbbbkkyk',
    'kWebBBBbbbbbbkYk',
    'kssyysssssssykk.',
    '.kwwwwwwwwwwkyk.',
    '..kkkkkkkkkk..k.',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_CATFISH = sprite(
  { k: '#1e1e22', b: '#5a5a62', B: '#7a7a84', d: '#3a3a42', w: '#c9c9c0', f: '#4a4a52', m: '#e0d6b0', e: '#e8e8e8', E: '#0a0a0a' },
  [
    '................',
    '................',
    '................',
    '.......kkkkk....',
    '..kkkkkkbbbbkk..',
    '.kbbbbbbbbbbbbkk',
    'mmkEebbbBBbbbbfk',
    'mkbbbbbbbbbbbbfk',
    'mmkbbbbbbbbbkkfk',
    'mkkwwwwwwwwwk.k.',
    '..kkkkkkkkkkk...',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_MANDARIN_FISH = sprite(
  { k: '#2a2010', b: '#c9a04a', B: '#e0bd6a', d: '#4a3418', w: '#efe0b0', f: '#b88a3a', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '....k.k.k.k.....',
    '...kfkfkfkfk..k.',
    '.kkbbbdbbdbbkkfk',
    'kBWebdbbdbbdbffk',
    'kBBbbbdbbdbbbkfk',
    'kkwwwbbbbbbbkkfk',
    '.kwwwwwwwwwkk.k.',
    '..kkkkkkkkk..k..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_EEL = sprite(
  { k: '#1a1d1c', b: '#4d5a52', B: '#6f7f74', w: '#d8d9b8', m: '#cfae8a', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '.....kkkkkk.....',
    '.kkkkkbbBBbkkkk.',
    'kWebbbbBbbbbbbbk',
    'kmwwwwkkkkkwwwbk',
    '.kkkkk.....kkkk.',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_GOLDEN_MANDARIN = sprite(
  { k: '#3a2a08', b: '#ffc933', B: '#ffe27a', d: '#d9981a', w: '#fff3b0', f: '#ffb000', Y: '#fffbe0', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '..Y.............',
    '.YWY............',
    '..Y.k.k.k.k.....',
    '...kfkfkfkfk..k.',
    '.kkbbBdbbdbbkkfk',
    'kBWebdbbdbbdbffk',
    'kBBbbBdbbdbbbkfk',
    'kkwwwbbbbbBbkkfk',
    '.kwwwwwwwwwkk.k.',
    '..kkkkkkkkk..k..',
    '.............Y..',
    '............YWY.',
    '.............Y..',
    '................',
    '................',
  ],
)

const FISH_CRUCIAN = sprite(
  { k: '#2e2512', b: '#a88a4a', B: '#c4a862', d: '#6f5a2c', w: '#e0d3a0', f: '#8f7438', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '....kkkkkk......',
    '..kkbbBBbbkk.k..',
    '.kbbBBBBbbbbkkfk',
    'kWebbBBbdbbdbffk',
    'kbbbdbbbbdbbbffk',
    'kbbbbbdbbbbbkkfk',
    '.kwwwwwwwwwwk.k.',
    '..kkwwwwwwkk....',
    '....kkkkkk......',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_CARP = sprite(
  { k: '#3a2410', b: '#b8873a', B: '#d9a850', d: '#8a5a24', w: '#ecd8a8', f: '#c4622a', m: '#f0d070', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '....kkkkkkkk....',
    '..kkBBBBBBBBk.k.',
    '.kbbdbbdbbdbkkfk',
    'kWebbdbbdbbdbffk',
    'kbbdbbdbbdbbbffk',
    'mmkbbdbbdbbdbkfk',
    'm.kbdbbdbbdbbkkk',
    '..kkwwwwwwwwk.k.',
    '....kkkkkkkk....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_BLUEGILL = sprite(
  { k: '#243020', b: '#6e8f5a', d: '#3f5a3a', y: '#e8a23c', n: '#1f2a6e', f: '#9aa060', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '....k.k.k.k.....',
    '...kfkfkfkfk....',
    '..kbbbbbbbbbk.k.',
    '.kbbdbbdbbdbkkfk',
    'kbWebbdbbdbbbffk',
    'kbbbbbdbbdbbbkfk',
    'kbbnnbbbbbbbbkfk',
    'kyynnbbbbbbbkkfk',
    '.kyyyyyyyybbk.k.',
    '..kkyyyyyykk....',
    '....kkkkkk......',
    '................',
    '................',
    '................',
  ],
)

const FISH_LOACH = sprite(
  { k: '#2e2214', b: '#8a6a40', d: '#4f3a20', w: '#d9c9a0', m: '#e0c690', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.kkkkkkkkkkkk...',
    'kWebbdbbdbbbbkk.',
    'kkbbbbbbbbbdbbkk',
    'mkwwwwwwwwwwwbbk',
    'm.kkkkkkkkkkkkk.',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_SNAKEHEAD = sprite(
  { k: '#1e2412', b: '#5f6b3a', B: '#7d8a4a', d: '#2c3318', w: '#c9c79a', f: '#4a5230', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '...fffffffffff..',
    '.kkkkkkkkkkkkkk.',
    'kBBbbddbbddbbbkf',
    'kWebbbddbbddbbkf',
    'kbbbbbbddbbddbkf',
    'kkwwbddbbddbbkkf',
    '.kkwwwwwwwwwwkk.',
    '..kkkkkkkkkkk...',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_STREAM_MINNOW = sprite(
  { k: '#2e2416', b: '#8a7050', d: '#4a3820', w: '#d9cba8', f: '#9a7e58', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '...kkkkkkkk.k...',
    '..kbbdbbdbbkfk..',
    '.kWebbbdbbbbffk.',
    '.kbbbdbbbdbbkfk.',
    '..kwwwwwwwwkkk..',
    '...kkkkkkkk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_LENOK = sprite(
  { k: '#2a2e22', b: '#8a9a78', B: '#aab896', r: '#d63a3a', R: '#ef6a5a', w: '#e8ecd8', f: '#c9604a', e: '#0d0d0d', W: '#ffffff' },
  [
    '................',
    '................',
    '................',
    '....kkkkkkkk..k.',
    '..kkbbbbrbbrkkfk',
    '.kbbbBBbbbbbbffk',
    'kbRWeRbbrbbrbffk',
    'kbbRRbbbbbbbbkfk',
    'kkwwbbrbbrbbkkfk',
    '.kwwwwwwwwwwk.k.',
    '..kkkkkkkkkk....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
)

const FISH_CENTURY_SNAKEHEAD = sprite(
  { k: '#10140a', b: '#343c26', B: '#4a5532', d: '#1a1f10', w: '#8f9470', f: '#2a3020', g: '#6fae4a', S: '#c9c4a8', e: '#0d0d0d', W: '#d8d8c0' },
  [
    '................',
    '................',
    '...fffffffffff..',
    '..kkkkkkkkkkkk..',
    '.kBBbbddbbddbkkf',
    'kBWebbgddbbddgkf',
    'kbbbbbbddbSbddkf',
    'kbbSbbgbddbbbkff',
    'kkbbbddbSbddbkkf',
    '.kwwbbbbbSbbbkkf',
    '..kwwwwwwwwwkk..',
    '...kkkkkkkkkk...',
    '................',
    '................',
    '................',
    '................',
  ],
)

// ── 날씨 아이콘(8×8, HUD용) ──
const ICON_SUN = sprite({ y: '#ffd23f', Y: '#fff3b0', o: '#ff9f43' }, [
  '...oo...',
  '.o.yy.o.',
  '..yyyy..',
  'oyyYyyyo',
  'oyyyyyyo',
  '..yyyy..',
  '.o.yy.o.',
  '...oo...',
])

const ICON_RAIN = sprite({ g: '#8f9cab', G: '#dfe6ee', b: '#5aa9e6' }, [
  '..GGG...',
  '.GGGGGg.',
  'GGGGGGgg',
  'gggggggg',
  '........',
  '.b..b...',
  '..b..b..',
  '.b..b...',
])

const ICON_SNOW = sprite({ g: '#8f9cab', G: '#dfe6ee', W: '#ffffff' }, [
  '..GGG...',
  '.GGGGGg.',
  'GGGGGGgg',
  'gggggggg',
  '.W..W...',
  '..W..W..',
  '.W..W...',
  '..W..W..',
])

// ── HUD 시계 글자(4×6, 콜론 1×6): 캔버스 정수 좌표에 찍어 확대해도 또렷하다 ──
const DIGIT_INK = { w: '#f4f1ff' }
const DIGIT_ROWS: Record<string, string[]> = {
  '0': ['.ww.', 'w..w', 'w..w', 'w..w', 'w..w', '.ww.'],
  '1': ['.w..', 'ww..', '.w..', '.w..', '.w..', 'www.'],
  '2': ['.ww.', 'w..w', '...w', '..w.', '.w..', 'wwww'],
  '3': ['www.', '...w', '.ww.', '...w', '...w', 'www.'],
  '4': ['..w.', '.ww.', 'w.w.', 'wwww', '..w.', '..w.'],
  '5': ['wwww', 'w...', 'www.', '...w', '...w', 'www.'],
  '6': ['.ww.', 'w...', 'www.', 'w..w', 'w..w', '.ww.'],
  '7': ['wwww', '...w', '..w.', '..w.', '.w..', '.w..'],
  '8': ['.ww.', 'w..w', '.ww.', 'w..w', 'w..w', '.ww.'],
  '9': ['.ww.', 'w..w', 'w..w', '.www', '...w', '.ww.'],
}
const DIGITS: Record<string, Sprite> = Object.fromEntries(
  Object.entries(DIGIT_ROWS).map(([d, rows]) => [`digit-${d}`, sprite(DIGIT_INK, rows)]),
)
const DIGIT_COLON = sprite(DIGIT_INK, ['.', 'w', '.', '.', 'w', '.'])

// ── 계절 아이콘(7×7, HUD용): 봄 꽃, 여름 수박, 가을 단풍잎, 겨울 눈송이 ──
const SEASON_SPRING = sprite({ p: '#f59ab8', P: '#ffd3e2', y: '#ffd23f', o: '#f29b38' }, [
  '.pp.pp.',
  'pPPpPPp',
  'pPPyPPp',
  '.pyoyp.',
  'pPPyPPp',
  'pPPpPPp',
  '.pp.pp.',
])

const SEASON_SUMMER = sprite({ r: '#f0525a', R: '#ff8a8f', k: '#2a2135', g: '#3f9e4d', G: '#8fd36b' }, [
  '.......',
  'RRRRRRR',
  'rkrrrkr',
  'GrrkrrG',
  'gGrrrGg',
  '.ggGgg.',
  '..ggg..',
])

const SEASON_AUTUMN = sprite({ o: '#ef7d2d', O: '#c4501f', y: '#ffb547', b: '#7a4a2a' }, [
  '...o...',
  '.o.o.o.',
  '.oyOyo.',
  'ooyOyoo',
  '.ooOoo.',
  '...b...',
  '..b....',
])

const SEASON_WINTER = sprite({ w: '#cfeeff', W: '#ffffff' }, [
  '...w...',
  '.w.w.w.',
  '..wWw..',
  'wwWWWww',
  '..wWw..',
  '.w.w.w.',
  '...w...',
])

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

// ── 마을 땅 타일: 칸을 꽉 채우고 가장자리끼리 이어진다 ──
const GRASS: Record<string, string> = {
  g: '#78b85c', // 바탕
  d: '#5f9e4a', // 풀잎 그늘
  l: '#9ad172', // 풀잎 밝은 쪽
  y: '#b7dd84', // 마른 풀 점
}

const PATH: Record<string, string> = {
  p: '#d6b27a', // 흙
  d: '#bb955e', // 흙 그늘
  l: '#e7cb98', // 조약돌 윗면
  n: '#9e7b4d', // 조약돌 아래
}

const SAND: Record<string, string> = {
  s: '#f0dca8', // 모래
  d: '#dfc58b', // 젖은 알갱이
  l: '#fbefcc', // 반짝이는 알갱이
}

const FLOWER: Record<string, string> = {
  ...GRASS,
  w: '#fbf7ee', // 흰 꽃잎
  W: '#e4dccb', // 흰 꽃잎 그늘
  c: '#f4c542', // 꽃술
  p: '#f28fae', // 분홍 꽃잎
  P: '#d96a8e', // 분홍 꽃잎 그늘
  t: '#4e8a3e', // 줄기
}

// ── 마을 위에 얹는 타일: 배경 투명, 그림자는 반투명이라 풀·모래 어디에 얹어도 된다 ──
const GROUND_SHADOW = '#1f2a1c55'

const ROCK_TILE: Record<string, string> = {
  k: '#39424c', // 외곽선
  G: '#c8d1d6', // 윗면
  g: '#9eabb3', // 몸
  d: '#727f89', // 그늘
  m: '#7fae5e', // 이끼
  x: GROUND_SHADOW,
}

// 울타리: tile-fence는 가로로 이어지는 난간, tile-fence-v는 세로로 이어지는 난간(위·아래에 울타리가 있는 칸용)
const FENCE: Record<string, string> = {
  k: '#3b2a22', // 외곽선
  w: '#e9c58e', // 나무 밝은 면
  u: '#c8925a', // 나무
  U: '#a2703f', // 나무 그늘
  x: GROUND_SHADOW,
}

// 나무: 아래 16px가 자기 칸(밑동), 위 16px는 윗칸에 겹친다. 줄지어 서면 수관이 이어진다
const TREE: Record<string, string> = {
  k: '#1f3a2c', // 외곽선
  t: '#2f6b45', // 수관 그늘
  T: '#3f8a4f', // 수관
  L: '#5aa85a', // 수관 밝은 쪽
  h: '#8cc86c', // 수관 하이라이트
  b: '#7a4e30', // 줄기
  B: '#5a3822', // 줄기 그늘
  q: '#9a6a40', // 줄기 밝은 결
  x: GROUND_SHADOW,
}

// 상점: 5×4칸(80×64). 맨 아래 줄 세 번째 칸(x 32~47)이 문. 산호색 기와 지붕, 하늘색 판자 벽, 물고기 간판
const SHOP_PALETTE: Record<string, string> = {
  k: '#2a2135', // 외곽선
  R: '#d9654b', // 기와
  r: '#b04a3a', // 기와 그늘
  Q: '#ef8f6c', // 기와 밝은 쪽
  C: '#8f3a33', // 용마루
  n: '#4a3a4a', // 처마 그늘
  B: '#9fcbd8', // 벽 판자
  b: '#7db0c2', // 판자 이음
  w: '#f6f1e4', // 흰 테두리
  W: '#d9d0bc', // 흰 테두리 그늘
  G: '#bfe6f2', // 유리
  g: '#8cc8de', // 유리 아래
  i: '#e9f8fc', // 유리 반짝임
  d: '#a0673d', // 문
  D: '#7c4b2a', // 문 홈
  e: '#c28452', // 문 밝은 쪽
  y: '#f4c542', // 문손잡이
  s: '#a9b3b9', // 기단 돌
  S: '#7f8b93', // 돌 이음
  a: '#f27d5e', // 차양 산호색 줄, 간판 물고기 꼬리
  A: '#fbf1d6', // 차양 흰 줄, 간판 물고기
  o: '#c8925a', // 화분 윗면
  O: '#8a5a34', // 화분, 간판 줄, 선반
  f: '#3f7fa8', // 간판 아래 테
  F: '#2f6b7c', // 간판
  p: '#f28fae', // 분홍 꽃
  P: '#ffd76a', // 노란 꽃
  t: '#4e8a3e', // 잎
  c: '#9aa3a8', // 굴뚝
  x: '#6e7880', // 굴뚝 이음
}

const TILE_GRASS = sprite(GRASS, [
  'gggggggggggggggg',
  'gggggggggggggggg',
  'ggggdggggggggggg',
  'ggglddgggggggggg',
  'gggggggggggggggg',
  'ggggggggggglgggg',
  'gggggggggggdgdgg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'gggggdgggggggggg',
  'ggggldgdgggggggg',
  'gggggggggggggggg',
  'gggggggggggggdgg',
  'ggggggggggggldlg',
  'gggggggggggggggg',
  'gggggggggggggggg',
])

const TILE_GRASS_ALT = sprite(GRASS, [
  'gggggggggggggggg',
  'ggggggggggdggggg',
  'gggggggggldlgggg',
  'gggggggggggggggg',
  'ggdggggggggggggg',
  'gldlgggggggggggg',
  'gggggggggggggggg',
  'gggggggyggggggdg',
  'gggggggggggggldl',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'gggggggggdgggggg',
  'ggggyggggldggggg',
  'gggggggggggggggg',
  'ggggggggggggyggg',
  'gggggggggggggggg',
])

const TILE_PATH = sprite(PATH, [
  'pppppppppppppppp',
  'pppppppppppplppp',
  'ppdppppppppppppp',
  'pppppppppppppppp',
  'pppppplppppppppp',
  'ppppplnppppppdpp',
  'pppppppppppppppp',
  'pdpppppppppppppp',
  'pppppppppplppppp',
  'pppppppppldnpppp',
  'pppppppppppppppp',
  'pppplppppppppppp',
  'pppppppppppppdpp',
  'ppdppppppppppppp',
  'pppppppplppppppp',
  'pppppppppppppppp',
])

const TILE_SAND = sprite(SAND, [
  'ssssssssssssssss',
  'ssssssssssdsssss',
  'sslsssssssssssss',
  'ssssssssssssssss',
  'sssssdssssssslss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'sdssssssslssssss',
  'sssssssssssssdss',
  'ssssssssssssssss',
  'sssslsssssssssss',
  'ssssssssssssssss',
  'ssssssssdsssssss',
  'sssssssssssssssl',
  'ssdsssssssssssss',
  'ssssssssssssssss',
])

const TILE_FLOWER = sprite(FLOWER, [
  'gggggggggggggggg',
  'gggggggggggggggg',
  'ggggwgggggggggdg',
  'gggwcwgggggggggg',
  'ggggWggggggggggg',
  'ggggtgggggpggggg',
  'ggggtggggpcpgggg',
  'gggggggggtPggggg',
  'gggggggggtgggggg',
  'gggdgggggggggggg',
  'gggggggggggggggg',
  'gggggggwggggggpg',
  'ggggggwcwggggpcp',
  'gggggggWgggggtPg',
  'ggggggdtgggggtgg',
  'gggggggggggggggg',
])

const TILE_ROCK = sprite(ROCK_TILE, [
  '................',
  '................',
  '................',
  '................',
  '.....kkkkk......',
  '...kkGGGggkk....',
  '..kGGGgGggggk...',
  '..kGGggggggdkk..',
  '.kGgmmgggggddk..',
  '.kgmmggggdddddk.',
  '.kggggggdddddkk.',
  '.kdgggdddddddk..',
  '..kdddddddddkkx.',
  '..xkkkkkkkkkxxx.',
  '...xxxxxxxxxxx..',
  '................',
])

const TILE_FENCE = sprite(FENCE, [
  '................',
  '................',
  '................',
  '......kkkk......',
  '.....kwwwuk.....',
  'kkkkkkwuuUkkkkkk',
  'wwwwwkwuuUkwwwww',
  'uuuuukwuuUkuuuuu',
  'UUUUUkwuuUkUUUUU',
  'kkkkkkwuuUkkkkkk',
  'wwwwwkwuuUkwwwww',
  'uuuuukwuuUkuuuuu',
  'UUUUUkuuuUkUUUUU',
  'kkkkkkUUUUkkkkkk',
  'xxxxxxkkkkxxxxxx',
  '................',
])

const TILE_FENCE_V = sprite(FENCE, [
  '......kwUkx.....',
  '......kwUkx.....',
  '......kwUkx.....',
  '.....kkkkkkx....',
  '.....kwwwukx....',
  '.....kwuuUkx....',
  '.....kwuuUkx....',
  '.....kwuuUkx....',
  '.....kwuuUkx....',
  '.....kwuuUkx....',
  '.....kwuuUkx....',
  '.....kuuuUkx....',
  '.....kUUUUkx....',
  '.....kkkkkkx....',
  '......kwUkxx....',
  '......kwUkx.....',
])

const TILE_TREE = sprite(TREE, [
  '......kkkk......',
  '...kkkLLLTkkk...',
  '..kTLLhhLTTTTk..',
  '.kTLhhLLTTTTttk.',
  '.kTLhLLTTTkTttk.',
  'kTLLLTTTTTTktttk',
  'kTTLTTTTLLLTtttk',
  'ktTTTTTLhhLTTttk',
  'kttTTkTTLLTTTttk',
  '.ktTTTTTTTTTTtk.',
  'kTkttTTTTTTTtktk',
  'kLLTkttTTTTttTTk',
  'kLhLTTtttttTLLtk',
  'ktLLTTTtttTTLhtk',
  'kttTTTTttTTTTLtk',
  'kttttTTTTTTTtttk',
  '.ktttttTTTtttttk',
  '..kktttttttttkk.',
  '....kktkktttk...',
  '......kbqBk.....',
  '......kbqBk.....',
  '......kbqBk.....',
  '......kbqBk.....',
  '.....kbbqBBk....',
  '....kbbkqkBBk...',
  '...xkkkxkxkkkx..',
  '...xxxxxxxxxxxx.',
  '................',
  '................',
  '................',
  '................',
  '................',
])

const SHOP = sprite(SHOP_PALETTE, [
  '........................................................kkkkkkkkk...............',
  '........................................................kxxxxxxxk...............',
  '........................................................kxxxxxxxk...............',
  '........................................................kcccxccck...............',
  '........kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk........',
  '........CQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQC........',
  '........CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCkccccccckCCCCCCC........',
  '.......kCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCkcxcccxckCCCCCCCk.......',
  '.......kQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRkcxcccxckRRRQQRRk.......',
  '.......kRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRkxxxxxxxkRrRRRRRk.......',
  '......kRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRkccccccckRrRRRRRRk......',
  '......kRrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrkccccccckrrrrrrrRk......',
  '......kRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQkkkkkkkkkkkQRRRRQQk......',
  '.....kRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRrrrrrrrrrrrRRRrRRRRk.....',
  '.....kRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRk.....',
  '.....kRrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrRk.....',
  '....kRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQk....',
  '....kRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRk....',
  '....kRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRk....',
  '...kRrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrRk...',
  '...kRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRk...',
  '...kRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrk...',
  '..kRRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRk..',
  '..kRrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrRk..',
  '..kQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRk..',
  '.kRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRk.',
  '.kRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRk.',
  '.kRrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrRk.',
  'kRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQRRRRQQk',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'knnnnnnnnnnnnnnnnnnnnnnnnnnnnnOnnnnnnnnnnnnnnnnnnOnnnnnnnnnnnnnnnnnnnnnnnnnnnnnk',
  'knnnnnnnnnnnnnnnnnnnnnnnnnnnkkkkkkkkkkkkkkkkkkkkkkkknnnnnnnnnnnnnnnnnnnnnnnnnnnk',
  'kwwWBBBBBBBBBBBBBBBBBBBBBBBBkFFFFFFFFAAAFFFFFFFFFFFkBBBBBBBBBBBBBBBBBBBBBBBBwwWk',
  'kwwWbkkkkkkkkkkkkkkkkkkkkkkbkFFFFFFAAAAAAAFaaFFFFFFkbbbbbbbbbbbbbbbbbbbbbbbbwwWk',
  'kwwWBkaaaAAAaaaAAAaaaAAAaakBkFFFFFAkAAAAAAaaFFFFFFFkBBBBBBBBBBBBBBBBBBBBBBBBwwWk',
  'kwwWBkaaaAAAaaaAAAaaaAAAaakBkFFFFFFAAAAAAAFaaFFFFFFkBBOOOOOOOOOOOOOOOOOOOOBBwwWk',
  'kwwWBkaaaAAAaaaAAAaaaAAAaakBkffffffffWWWfffffffffffkBBBBBBBBBBBBBBBBBBBBBBBBwwWk',
  'kwwWbbaakAAkaakAAkaakAAkaakbkkkkkkkkkkkkkkkkkkkkkkkkbbbbbbbbbbbbbbbbbbbbbbbbwwWk',
  'kwwWBBBkkkkkkkkkkkkkkkkkkBBBBBBBkwwwwwwwwwwwwwwkBBBBBBBkkkkkkkkkkkkkkkkkkBBBwwWk',
  'kwwWBBBkwwwwwwwwwwwwwwwwkBBBBBBBkwwwwwwwwwwwwwwkBBBBBBBkwwwwwwwwwwwwwwwwkBBBwwWk',
  'kwwWBBBkwGGGGGGwwGGGGGGwkBBBBBBBkwwDDDDDDDDDDwwkBBBBBBBkwGGGGGGwwGGGGGGwkBBBwwWk',
  'kwwWbbbkwGiiGGGwwGiiGGGwkbbbbbbbkwwdeDddddDddwwkbbbbbbbkwGiiGGGwwGiiGGGwkbbbwwWk',
  'kwwWBBBkwGiGGGGwwGiGGGGwkBBBBBBBkwwdeDddddDddwwkBBBBBBBkwGiGGGGwwGiGGGGwkBBBwwWk',
  'kwwWBBBkwGGGGGGwwGGGGGGwkBBBBBBBkwwdeDkkkkDddwwkBBBBBBBkwGGGGGGwwGGGGGGwkBBBwwWk',
  'kwwWBBBkwwwwwwwwwwwwwwwwkBBBBBBBkwwdekiiGGkddwwkBBBBBBBkwwwwwwwwwwwwwwwwkBBBwwWk',
  'kwwWbbbkwggggggwwggggggwkbbbbbbbkwwdekGGGGkddwwkbbbbbbbkwggggggwwggggggwkbbbwwWk',
  'kwwWBBBkwggggggwwggggggwkBBBBBBBkwwdekGGGGkddwwkBBBBBBBkwggggggwwggggggwkBBBwwWk',
  'kwwWBBBkwggggggwwggggggwkBBBBBBBkwwdeDkkkkDddwwkBBBBBBBkwggggggwwggggggwkBBBwwWk',
  'kwwWBBBkwggggggwwggggggwkBBBBBBBkwwdeDddddDddwwkBBBBBBBkwggggggwwggggggwkBBBwwWk',
  'kwwWbbbkAggPggpwwAggpggPkbbbbbbbkwwdeDddddDddwwkbbbbbbbkwggggggwwggggggwkbbbwwWk',
  'kwwWBBBkppWPPWppWPPWppWPPBBBBBBBkwwdeDddddDddwwkBBBBBBBkWWWWWWWWWWWWWWWWkBBBwwWk',
  'kwwWBBBkttkttkttkttkttkttBBBBBBBkwwdeDddddDddwwkBBBBBBBkkkkkkkkkkkkkkkkkkBBBwwWk',
  'kwwWBBkkktkktkktkktkktkktkBBBBBBkwwdeDddddDddwwkBBBBBBBBBBBBBBBBBBBBBBBBBBBBwwWk',
  'kwwWbbkooooooooooooooooookbbbbbbkwwdeDddddDydwwkbbbbbbbbbbbbbbbbbbbbbbbbbbbbwwWk',
  'kwwWBBkOOOOOOOOOOOOOOOOOOkBBBBBBkwwdeDddddDDdwwkBBBBBBBBBBBBBBBBBBBBBBBBBBBBwwWk',
  'kwwWBBkkkkkkkkkkkkkkkkkkkkBBBBBBkwwdeDddddDddwwkBBBBBBBBBBBBBBBBBBBBBBBBBBBBwwWk',
  'kwwWBBBBBBBBBBBBBBBBBBBBBBBBBBBBkwwdeDddddDddwwkBBBBBBBBBBBBBBBBBBBBBBBBBBBBwwWk',
  'kwwWbbbbbbbbbbbbbbbbbbbbbbbbbbbbkwwdeDddddDddwwkbbbbbbbbbbbbbbbbbbbbbbbbbbbbwwWk',
  'kwwWBBBBBBBBBBBBBBBBBBBBBBBBBBBBkwwdeDddddDddwwkBBBBBBBBBBBBBBBBBBBBBBBBBBBBwwWk',
  'kwwWBBBBBBBBBBBBBBBBBBBBBBBBBBBBkwwdeDddddDddwwkBBBBBBBBBBBBBBBBBBBBBBBBBBBBwwWk',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkwwdeDddddDddwwkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'ksssSssssssSssssssSssssssSssssskSSSSSSSSSSSSSSSSkssssSssssssSssssssSssssssSssssk',
  'ksssSssssssSssssssSssssssSsssssksssssssssssssssskssssSssssssSssssssSssssssSssssk',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
])

// ── 강·연못·웅덩이·폭포·다리·절벽(2단계 지역 타일). 16×16, 0/1 쌍은 물결이 다르다 ──
const RIVER: Record<string, string> = {
  a: '#4fa6d6', // 바탕: 바다보다 밝다
  d: '#3f95c8', // 깊은 결
  b: '#7cc4e6', // 흐름 줄무늬
  c: '#d4f0fa', // 줄무늬 끝 반짝임
}
const POND: Record<string, string> = {
  a: '#245f8c', // 바탕: 짙고 잔잔하다
  d: '#1f5480', // 깊은 결
  b: '#2f7099', // 잔물결
  c: '#6fb0cf', // 아주 작은 반짝임
}
const BASIN: Record<string, string> = {
  a: '#3a8fc4', // 바탕
  b: '#8fd0ea', // 작은 거품
  c: '#f2fbff', // 흰 거품
}
const FALLS: Record<string, string> = {
  a: '#5aa9d8', // 바탕
  d: '#3b8abf', // 그늘 줄
  b: '#7cc4e6', // 물줄기
  c: '#e4f6fc', // 흰 물보라 줄
}

const RIVER_0 = sprite(RIVER, [
  'aaaaaaaaaaaaaaaa',
  'aabbbbbaaaaaaaaa',
  'aaaabbbbcaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaabbbbaa',
  'adddaaaaaaabccba',
  'aaaaaaaaaaaaaaaa',
  'abbbbaaaaaaaaaaa',
  'aabccbaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaabbbbbbaa',
  'aaaaaaaaaaabccaa',
  'aaaddaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaabbbaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
])

const RIVER_1 = sprite(RIVER, [
  'aaaaaaaaaaaaaaaa',
  'aaaaaaabbbbbaaaa',
  'aaaaaaaaabbbbcaa',
  'aaaaaaaaaaaaaaaa',
  'bbbaaaaaaaaaaaab',
  'bccbaadddaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaabbbbaaaaaa',
  'aaaaaaabccbaaaaa',
  'aaaaaaaaaaaaaaaa',
  'bbbaaaaaaaaaabbb',
  'bccaaaaaaaaaaaaa',
  'aaaaaaaaddaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaabbbaaa',
  'aaaaaaaaaaaaaaaa',
])

const POND_0 = sprite(POND, [
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaadd',
  'aaaacccaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'adaaaaaaaaaaaaaa',
  'aaaaaaaabbbaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aacccaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaddd',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
])

const POND_1 = sprite(POND, [
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaddaaaaaaaaaa',
  'aaaaaaaaaacccaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaadaaaaaaaa',
  'baaaaaaaaaaaaabb',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaacccaaaaa',
  'aaaaaaaaaaaaaaaa',
  'aaadddaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
])

const BASIN_0 = sprite(BASIN, [
  'aabcaaaabaaacbaa',
  'baaaacaaaaaaaaab',
  'aaacbaaaabcaaaaa',
  'caaaaaaabaaaacaa',
  'aabaaacaaaaaaaba',
  'aaaaabaaacbaaaaa',
  'bcaaaaaaaaaaabca',
  'aaaaacbaaabaaaaa',
  'aaabaaaaaaaaaaca',
  'caaaaaaacbaaabaa',
  'aaaaabaaaaaaaaaa',
  'abcaaaaaabaaacba',
  'aaaaaaacaaaaaaaa',
  'aacbaaaaaaaabaaa',
  'baaaaabaacaaaaca',
  'aaaacaaaaaaabaaa',
])

const BASIN_1 = sprite(BASIN, [
  'acabaaaaabaacaaa',
  'aaaaaaacaaaaaaab',
  'baaaabcaaaabaaac',
  'aabbaaaacaaaaaaa',
  'aaaaaacbaaaabcaa',
  'caacaaaaaaabaaaa',
  'abaaabaaacaaaaaa',
  'aaaaaaaabaaacbaa',
  'bcabcaaaaaaaaaaa',
  'aaaaaaaacbaaabaa',
  'acaaaabaaaaaaaaa',
  'baacaaaaaaacbaaa',
  'aaaaaaaabaaaaaaa',
  'cbaabcaaaaaabaaa',
  'aaaaaaaaaacaaaaa',
  'aaaaacbaaaaaaaab',
])

const FALLS_0 = sprite(FALLS, [
  'abbcaabccabbcaab',
  'abbcaabccabbcaab',
  'adbcaabcdabbcaab',
  'adbcaabccabbdaab',
  'abbcaadccabbcaab',
  'abbdaabccabbcaab',
  'abbcaabcdabbcaad',
  'abbcaabccabbcaab',
  'dbbcaabccadbcaab',
  'abbcaabccabbcaab',
  'abbcaabcdabbcaab',
  'abbcdabccabbcaab',
  'abbcaabccabbcaab',
  'abbcaabccdbbcaab',
  'abbcaabccabbcaab',
  'abbcaabccabbcaab',
])

const FALLS_1 = sprite(FALLS, [
  'abbcaabccdbbcaab',
  'abbcaabccabbcaab',
  'abbcaabccabbcaab',
  'abbcaabccabbcaab',
  'abbcaabccabbcaab',
  'adbcaabcdabbcaab',
  'adbcaabccabbdaab',
  'abbcaadccabbcaab',
  'abbdaabccabbcaab',
  'abbcaabcdabbcaad',
  'abbcaabccabbcaab',
  'dbbcaabccadbcaab',
  'abbcaabccabbcaab',
  'abbcaabcdabbcaab',
  'abbcdabccabbcaab',
  'abbcaabccabbcaab',
])

// 다리: 아래 강물 위에 얹는다. 가로 판자 줄, 양옆에 난간(바깥 한 칸은 투명해 물이 보인다)
const BRIDGE: Record<string, string> = {
  n: '#3b2a22', // 난간·틈
  U: '#e2b07a', // 판자 윗면 밝은 줄
  u: '#c8925a', // 판자
  g: '#a8723f', // 나뭇결
  G: '#86562f', // 판자 아래 그늘
}
const BRIDGE_PLANK = sprite(BRIDGE, [
  '.nUUUUUUUUUUUUn.',
  '.nuuuguuuuuguun.',
  '.nGGGGGGGGGGGGn.',
  '.nUUUUUUUUUUUUn.',
  '.nuguuuuuguuuun.',
  '.nGGGGGGGGGGGGn.',
  '.nUUUUUUUUUUUUn.',
  '.nuuuguuuuuguun.',
  '.nGGGGGGGGGGGGn.',
  '.nUUUUUUUUUUUUn.',
  '.nuguuuuguuuuun.',
  '.nGGGGGGGGGGGGn.',
  '.nUUUUUUUUUUUUn.',
  '.nuuuguuuuguuun.',
  '.nGGGGGGGGGGGGn.',
  '.nnnnnnnnnnnnnn.',
])

// 절벽: 바위 벽면. 가로 지층 띠와 갈라진 틈, 위쪽 모서리는 밝고 아래는 어둡다
const CLIFF: Record<string, string> = {
  k: '#3d3a44', // 틈
  h: '#b8b2ba', // 윗면 밝은 모서리
  r: '#8f8993', // 바위
  m: '#756f7b', // 바위 그늘
  d: '#5a5560', // 아래 어둠
}
const TILE_CLIFF = sprite(CLIFF, [
  'hhhhhhhhhhhhhhhh',
  'hrrrrrrrhrrrrrrh',
  'rrrmrrrrrrrrmrrr',
  'rrmmrrrkrrrrmmrr',
  'mmmmmrrkrrrmmmmm',
  'kkkkkkkkkkkkkkkk',
  'rrrrrrrrrrrrrrrr',
  'rmrrrrkrrrrrrrmr',
  'mmmrrrkrrrrmmmmm',
  'mmmmmmkmmmmmmmmm',
  'kkkkkkkkkkkkkkkk',
  'rrrrrrrrrrrrrrrr',
  'rrrmrrrrrrkrrrrr',
  'mrmmmrrrrrkrmmrm',
  'dmmmmmmmmmkmmmmd',
  'dddddddddddddddd',
])

// ── 찌 5종(상점·가방 아이콘, 16×16): 코르크 / 함정 / 가시 바늘 / 회전 / 호기심 ──
const TACKLE_CORK = sprite(
  { k: '#2b2118', R: '#e0483c', r: '#a82e2a', w: '#ff9a8a', C: '#c8935a', c: '#e6b87c', d: '#8f6238' },
  [
    '.......kk.......',
    '.......kk.......',
    '......kRRk......',
    '.....kRwRRk.....',
    '.....kRRRRk.....',
    '.....krRRrk.....',
    '....kkkkkkkk....',
    '...kcCCCCCCdk...',
    '..kcccCCCCCCdk..',
    '..kcCCCCCCdCdk..',
    '..kCCCCdCCCCdk..',
    '..kCCdCCCCCddk..',
    '...kCCCCCCdddk..',
    '....kddddddk....',
    '.....kkkkkk.....',
    '.......kk.......',
  ],
)

const TACKLE_TRAP = sprite(
  { k: '#2b2118', t: '#d8b878', T: '#a07a4a', n: '#5a4630', b: '#7a5a3a', B: '#523a24' },
  [
    '................',
    '....kkkkkkkk....',
    '...kbtttttTBk...',
    '..kbbbbbbbbBBk..',
    '..kkkkkkkkkkkk..',
    '..ktnttnttnttk..',
    '..kTtnttnttntk..',
    '..kttntttnttnk..',
    '..kntnnnnnntnk..',
    '..kTnttnttnttk..',
    '...kttntnttntk..',
    '...kTtnnnnnTTk..',
    '....kttntnttk...',
    '....kTTnTnTTk...',
    '.....kkkkkkk....',
    '................',
  ],
)

const TACKLE_BARBED = sprite(
  { k: '#1d2026', g: '#c4ccd6', G: '#7d8895', w: '#f4f8fc', r: '#d0443a' },
  [
    '......kkkk......',
    '.....kgwwGk.....',
    '.....kg..Gk.....',
    '.....kGkkGk.....',
    '......kgGk......',
    '.....kkgGk......',
    '....kwkgGk......',
    '.....kkgGkk.....',
    '......kgGkwk....',
    '......kgGkk.....',
    '......kgGk......',
    '.k....kgGk......',
    'kwk...kgGk......',
    'kgGk.kgGk.......',
    '.kgGGGgk........',
    '..kkkkk.........',
  ],
)

const TACKLE_SPINNER = sprite(
  { k: '#1d2026', s: '#dfe6ee', S: '#8e9db0', w: '#ffffff', y: '#f2c94c', Y: '#b88a1c', g: '#7d8895' },
  [
    '...kkk..........',
    '..k...k.........',
    '...kkk..........',
    '...kgk..kkkk....',
    '...kgggkswwsk...',
    '...kgk.kswSSk...',
    '...kyk.kssSSk...',
    '...kYk.kssSSk...',
    '...kgk.kssSSk...',
    '...kgggkssSSk...',
    '...kgk..kSSk....',
    '...kgk..kkkk....',
    '...kgk..........',
    '...kkk..........',
    '..k...k.........',
    '...kkk..........',
  ],
)

const TACKLE_CURIOUS = sprite(
  { k: '#2a1a40', P: '#8a4fd0', p: '#5e2f9e', l: '#b98cf0', w: '#f1e6ff', q: '#fff4a8', c: '#d8b878', C: '#8f7438' },
  [
    '.......kk.......',
    '......kCCk......',
    '.....kkccCkk....',
    '....kPPPPPPpk...',
    '...kPPlqqqPPpk..',
    '..kPllqPPqPPpk..',
    '..kPlPPPPqPPpk..',
    '..kPlPPPqPPPpk..',
    '..kPPPPqqPPPpk..',
    '..kPPPPqPPPppk..',
    '..kPPPPPPPPppk..',
    '..kPPPPqPPPppk..',
    '...kPPPPPPppk...',
    '....kppppppk....',
    '.....kkkkkk.....',
    '................',
  ],
)

export const SPRITES: Record<string, Sprite> = {
  'player-idle': PLAYER_IDLE,
  'player-cast': PLAYER_CAST,
  'player-reel': PLAYER_REEL,
  'player-idle-down': PLAYER_IDLE,
  'player-walk-down-0': PLAYER_WALK_DOWN_0,
  'player-walk-down-1': PLAYER_WALK_DOWN_1,
  'player-idle-up': PLAYER_IDLE_UP,
  'player-walk-up-0': PLAYER_WALK_UP_0,
  'player-walk-up-1': PLAYER_WALK_UP_1,
  'player-idle-side': PLAYER_IDLE_SIDE,
  'player-walk-side-0': PLAYER_WALK_SIDE_0,
  'player-walk-side-1': PLAYER_WALK_SIDE_1,
  'player-cast-up': PLAYER_CAST_UP,
  'player-reel-up': PLAYER_REEL_UP,
  'player-cast-side': PLAYER_CAST_SIDE,
  'player-reel-side': PLAYER_REEL_SIDE,
  'water-0': WATER_0,
  'water-1': WATER_1,
  'pier-plank': PIER_PLANK,
  'pier-post': PIER_POST,
  'river-0': RIVER_0,
  'river-1': RIVER_1,
  'pond-0': POND_0,
  'pond-1': POND_1,
  'basin-0': BASIN_0,
  'basin-1': BASIN_1,
  'falls-0': FALLS_0,
  'falls-1': FALLS_1,
  'bridge-plank': BRIDGE_PLANK,
  'tile-cliff': TILE_CLIFF,
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
  'fish-hairtail': FISH_HAIRTAIL,
  'fish-conger': FISH_CONGER,
  'fish-pufferfish': FISH_PUFFERFISH,
  'fish-octopus': FISH_OCTOPUS,
  'fish-pale-chub': FISH_PALE_CHUB,
  'fish-dark-chub': FISH_DARK_CHUB,
  'fish-skin-carp': FISH_SKIN_CARP,
  'fish-aucha-perch': FISH_AUCHA_PERCH,
  'fish-sweetfish': FISH_SWEETFISH,
  'fish-catfish': FISH_CATFISH,
  'fish-mandarin-fish': FISH_MANDARIN_FISH,
  'fish-eel': FISH_EEL,
  'fish-golden-mandarin': FISH_GOLDEN_MANDARIN,
  'fish-crucian': FISH_CRUCIAN,
  'fish-carp': FISH_CARP,
  'fish-bluegill': FISH_BLUEGILL,
  'fish-loach': FISH_LOACH,
  'fish-snakehead': FISH_SNAKEHEAD,
  'fish-stream-minnow': FISH_STREAM_MINNOW,
  'fish-lenok': FISH_LENOK,
  'fish-century-snakehead': FISH_CENTURY_SNAKEHEAD,
  'icon-sun': ICON_SUN,
  'icon-rain': ICON_RAIN,
  'icon-snow': ICON_SNOW,
  ...DIGITS,
  'digit-colon': DIGIT_COLON,
  'season-spring': SEASON_SPRING,
  'season-summer': SEASON_SUMMER,
  'season-autumn': SEASON_AUTUMN,
  'season-winter': SEASON_WINTER,
  'rod-1': ROD_1,
  'rod-2': ROD_2,
  'rod-3': ROD_3,
  'rod-4': ROD_4,
  'tackle-cork': TACKLE_CORK,
  'tackle-trap': TACKLE_TRAP,
  'tackle-barbed': TACKLE_BARBED,
  'tackle-spinner': TACKLE_SPINNER,
  'tackle-curious': TACKLE_CURIOUS,
  'tile-grass': TILE_GRASS,
  'tile-grass-alt': TILE_GRASS_ALT,
  'tile-path': TILE_PATH,
  'tile-sand': TILE_SAND,
  'tile-flower': TILE_FLOWER,
  'tile-rock': TILE_ROCK,
  'tile-fence': TILE_FENCE,
  'tile-fence-v': TILE_FENCE_V,
  'tile-tree': TILE_TREE,
  shop: SHOP,
}

const SILHOUETTE = '#1b1f2a'

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  scale: number,
  opts?: { silhouette?: boolean; flipX?: boolean },
): void {
  const sp = SPRITES[name]
  if (!sp) throw new Error(`unknown sprite: ${name}`)
  const silhouette = opts?.silhouette === true
  const flipX = opts?.flipX === true
  // 같은 색이 가로로 이어지면 한 번에 칠한다. flipX면 같은 상자 안에서 좌우를 뒤집는다
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
      const left = flipX ? sp.w - end : col
      ctx.fillStyle = color
      ctx.fillRect(x + left * scale, y + row * scale, (end - col) * scale, scale)
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
