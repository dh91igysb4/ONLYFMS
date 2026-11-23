// 낚시 옷장 품목 목록(설계 2026-11-24-fishing-wardrobe §3). 순수 데이터·함수, 그림 없음(브라우저·Deno 공용).
// 그림 자료는 화면 전용 wearArt.ts, 합성은 outfit.ts. 이 파일은 world 함수 번들에 들어간다.
import { CHALLENGES, SPECIES } from './data.ts'

export const WEAR_SLOTS = ['hat', 'top', 'bottom', 'hair', 'hairColor', 'rodSkin'] as const
export type WearSlot = (typeof WEAR_SLOTS)[number]
export type Outfit = Record<WearSlot, string>

/** 업적 조건. 모두 되돌아가지 않는 값이라 소유를 저장하지 않고 매번 계산한다 */
export type Unlock =
  | { kind: 'challenge'; id: string }
  | { kind: 'allChallenges' }
  | { kind: 'legends'; count: number }
  /** 어느 한 지역이라도 그 지역 어종(전설 포함)을 모두 도감에 */
  | { kind: 'areaDex' }

/** price 0이고 unlock이 없으면 무료 기본, unlock이 있으면 업적 전용(골드로 못 산다) */
export type WearItem = { slot: WearSlot; id: string; name: string; price: number; unlock?: Unlock }

const item = (slot: WearSlot, id: string, name: string, price: number, unlock?: Unlock): WearItem =>
  unlock ? { slot, id, name, price, unlock } : { slot, id, name, price }

export const WEAR: readonly WearItem[] = [
  // 모자 — 상점 합 300,000
  item('hat', 'beanie', '청록 비니', 0),
  item('hat', 'none', '모자 없음', 0),
  item('hat', 'beanie-coral', '산호 비니', 2000),
  item('hat', 'cap', '남색 야구모자', 6000),
  item('hat', 'bucket', '카키 버킷햇', 12000),
  item('hat', 'straw', '밀짚모자', 20000),
  item('hat', 'captain', '선장 모자', 40000),
  item('hat', 'pirate', '해적 모자', 80000),
  item('hat', 'frog', '개구리 모자', 140000),
  item('hat', 'crown', '전설의 왕관', 0, { kind: 'legends', count: 1 }),
  item('hat', 'fish-hat', '물고기 모자', 0, { kind: 'areaDex' }),
  // 상의 — 상점 합 400,000. 유니폼은 색·무늬만(엠블럼·글자 없음), 이름도 색으로
  item('top', 'windbreaker', '겨자색 바람막이', 0),
  item('top', 'tee', '흰 티셔츠', 0),
  item('top', 'sweat', '회색 맨투맨', 2000),
  item('top', 'marine', '마린 줄무늬 티', 5000),
  item('top', 'flannel', '빨간 체크 셔츠', 10000),
  item('top', 'vest', '카키 낚시 조끼', 18000),
  item('top', 'kit-claret', '클라렛·하늘 유니폼', 30000),
  item('top', 'kit-red', '새빨간 유니폼', 28000),
  item('top', 'kit-redwhite', '빨강·흰 깃 유니폼', 28000),
  item('top', 'kit-white', '흰·남색 유니폼', 28000),
  item('top', 'kit-royal', '로열 블루 유니폼', 28000),
  item('top', 'kit-stripes', '흑백 줄무늬 유니폼', 33000),
  item('top', 'suit', '검은 정장', 60000),
  item('top', 'gold-robe', '금실 도포', 130000),
  item('top', 'lava-suit', '용암 작업복', 0, { kind: 'challenge', id: 'cave-deep' }),
  item('top', 'moss-vest', '이끼 조끼', 0, { kind: 'challenge', id: 'forest-variety' }),
  // 하의(신발 포함) — 상점 합 200,000
  item('bottom', 'jeans', '남색 바지', 0),
  item('bottom', 'shorts', '베이지 반바지', 0),
  item('bottom', 'black', '검은 바지', 2000),
  item('bottom', 'cargo', '카키 작업 바지', 5000),
  item('bottom', 'shorts-white', '흰 반바지', 8000),
  item('bottom', 'shorts-navy', '남색 반바지', 8000),
  item('bottom', 'shorts-black', '검은 반바지', 8000),
  item('bottom', 'shorts-red', '빨간 반바지', 8000),
  item('bottom', 'shorts-blue', '파란 반바지', 8000),
  item('bottom', 'check', '체크 바지', 15000),
  item('bottom', 'rainboots', '노란 장화 바지', 28000),
  item('bottom', 'suit-pants', '검은 정장 바지', 40000),
  item('bottom', 'gold-pants', '금실 바지', 70000),
  item('bottom', 'wave', '파도 바지', 0, { kind: 'challenge', id: 'island-big' }),
  // 머리 모양 — 상점 합 120,000
  item('hair', 'short', '짧은 머리', 0),
  item('hair', 'spiky', '삐죽 머리', 0),
  item('hair', 'bob', '단발', 3000),
  item('hair', 'long', '긴 생머리', 6000),
  item('hair', 'ponytail', '포니테일', 6000),
  item('hair', 'bun', '똥머리', 8000),
  item('hair', 'twin', '양갈래', 12000),
  item('hair', 'mohawk', '모히칸', 25000),
  item('hair', 'afro', '뽀글 머리', 60000),
  // 머리 색 — 상점 합 120,000
  item('hairColor', 'brown', '갈색', 0),
  item('hairColor', 'black', '검정', 0),
  item('hairColor', 'blonde', '금발', 2000),
  item('hairColor', 'red', '빨강', 3000),
  item('hairColor', 'ash', '잿빛', 5000),
  item('hairColor', 'pink', '분홍', 8000),
  item('hairColor', 'blue', '파랑', 8000),
  item('hairColor', 'green', '초록', 12000),
  item('hairColor', 'purple', '보라', 22000),
  item('hairColor', 'white', '백발', 60000),
  item('hairColor', 'gold', '황금빛', 0, { kind: 'legends', count: 3 }),
  item('hairColor', 'rain', '빗물 하늘색', 0, { kind: 'challenge', id: 'river-rain' }),
  // 낚싯대 겉모습(성능은 낚싯대 단계 그대로) — 상점 합 200,000
  item('rodSkin', 'bamboo', '대나무', 0),
  item('rodSkin', 'black', '검정', 3000),
  item('rodSkin', 'red', '빨강', 5000),
  item('rodSkin', 'blue', '파랑', 5000),
  item('rodSkin', 'white', '흰색', 7000),
  item('rodSkin', 'pink', '벚꽃', 20000),
  item('rodSkin', 'silver', '은빛', 40000),
  item('rodSkin', 'gold', '황금', 120000),
  item('rodSkin', 'coral', '산호', 0, { kind: 'challenge', id: 'pier-perfect' }),
  item('rodSkin', 'ice', '얼음', 0, { kind: 'challenge', id: 'lake-night' }),
  item('rodSkin', 'rainbow', '무지개', 0, { kind: 'allChallenges' }),
]

/** 지금 캐릭터 그림 그대로인 옷차림 */
export const DEFAULT_OUTFIT: Readonly<Outfit> = {
  hat: 'beanie',
  top: 'windbreaker',
  bottom: 'jeans',
  hair: 'short',
  hairColor: 'brown',
  rodSkin: 'bamboo',
}

export const SLOT_NAMES: Readonly<Record<WearSlot, string>> = {
  hat: '모자',
  top: '상의',
  bottom: '하의',
  hair: '머리 모양',
  hairColor: '머리 색',
  rodSkin: '낚싯대',
}

export const isWearSlot = (v: unknown): v is WearSlot => typeof v === 'string' && (WEAR_SLOTS as readonly string[]).includes(v)
export function wearItem(slot: string, id: unknown): WearItem | undefined {
  return typeof id === 'string' ? WEAR.find((w) => w.slot === slot && w.id === id) : undefined
}
/** 골드로 사는 품목인가 */
export const isShopItem = (w: WearItem): boolean => w.price > 0 && !w.unlock
/** 세이브 `wardrobe`에 넣는 키. 부위마다 id가 겹칠 수 있다(검정 바지·검정 머리·검정 낚싯대) */
export const wearKey = (slot: WearSlot, id: string): string => `${slot}:${id}`

/** 소유 판단에 쓰는 세이브 값(State의 일부. view에도 그대로 있다) */
export type OwnFacts = {
  wardrobe: readonly string[]
  legends: readonly string[]
  challenges: Readonly<Record<string, { done: boolean }>>
  dex: Readonly<Record<string, unknown>>
}

export function unlockMet(f: OwnFacts, u: Unlock): boolean {
  switch (u.kind) {
    case 'challenge':
      return f.challenges[u.id]?.done === true
    case 'allChallenges':
      return CHALLENGES.every((c) => f.challenges[c.id]?.done === true)
    case 'legends':
      return f.legends.length >= u.count
    case 'areaDex': {
      const areas = new Set(SPECIES.map((s) => s.area))
      return [...areas].some((a) => SPECIES.filter((s) => s.area === a).every((s) => Object.prototype.hasOwnProperty.call(f.dex, s.id)))
    }
  }
}

export function ownsWear(f: OwnFacts, slot: WearSlot, id: string): boolean {
  const w = wearItem(slot, id)
  if (!w) return false
  if (w.unlock) return unlockMet(f, w.unlock)
  if (w.price === 0) return true
  return f.wardrobe.includes(wearKey(slot, id))
}

/** 업적 조건 문구(화면용) */
export function unlockText(u: Unlock): string {
  switch (u.kind) {
    case 'challenge': {
      const c = CHALLENGES.find((x) => x.id === u.id)
      return c ? `도전과제 "${c.title}" 깨기` : '도전과제 깨기'
    }
    case 'allChallenges':
      return `도전과제 ${CHALLENGES.length}개 모두 깨기`
    case 'legends':
      return u.count === 1 ? '전설 물고기 잡기' : `전설 물고기 ${u.count}마리 잡기`
    case 'areaDex':
      return '한 지역 도감 완성하기'
  }
}
