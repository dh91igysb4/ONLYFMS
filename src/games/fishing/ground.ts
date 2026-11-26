// 낚시 맵 바탕 땅 분류(칸 아래 깔리는 땅). 순수 모듈: 그리기(scene.ts)와 걷기(shore.ts)가 같은 분류를 쓴다.
import { tileAt, type MapDef, type TileKind } from './map.ts'
import type { Tide } from './clock.ts'

/** cave: 동굴 바닥·입구. 풀 가장자리를 받지도 주지도 않고, 물에 모래 거품을 만들지 않는다. snow: 눈 땅(물가에 눈 턱) */
export type Ground = 'water' | 'sand' | 'grass' | 'cave' | 'snow'

// 땅이 물로 치는 타일: 바다·강·연못·웅덩이·폭포·호수·동굴 물·수정·용암·석호, 부두·다리·선착장(아래가 물).
// 물가 거품·풀 가장자리 규칙이 그대로 적용된다.
export const WATER_GROUND: ReadonlySet<TileKind> = new Set<TileKind>([
  'water', 'river', 'pond', 'basin', 'falls', 'pier', 'bridge', 'lake', 'cave-pool', 'crystal', 'lava', 'lagoon', 'dock',
  'creek', 'marsh', 'bog', 'boardwalk',
  // 낚시 5부 M3: 온천·심해, 갑판·선체·돛대(난파선은 바다 위에 떠 있다 — 둘레 바다에 모래 거품이 생기지 않게)
  'hotspring', 'deep', 'deck', 'hull', 'mast',
])

function baseGround(map: MapDef, tx: number, ty: number, tide: Tide = 'high'): Ground | null {
  const kind = tileAt(map, tx, ty)
  if (kind === null || kind === 'rock' || kind === 'reed' || kind === 'deadtree' || kind === 'cliff' || kind === 'cave-wall') return null
  // 진흙: 밀물이면 물(물가 거품을 받는다), 썰물이면 모래처럼(둘레 물에 젖은 띠·거품)
  if (kind === 'mud') return tide === 'high' ? 'water' : 'sand'
  // 얼음은 눈 땅으로 친다(얼음판 가의 바위·갈대가 눈 위에 놓이게). 얼음 칸 자체는 drawTile이 따로 그린다
  if (kind === 'ice' || kind === 'snow' || kind === 'snowpine') return 'snow'
  if (WATER_GROUND.has(kind)) return 'water'
  if (kind === 'sand' || kind === 'palm') return 'sand'
  if (kind === 'cave-floor' || kind === 'cave-mouth') return 'cave'
  return 'grass'
}

/** 이웃 물 그림을 빌려 쓰는 타일: 바위, 갈대·고사목(늪 속 갈대는 늪물 위에) */
export const ON_NEIGHBOUR_GROUND: ReadonlySet<TileKind> = new Set<TileKind>(['rock', 'reed', 'deadtree'])

/** 바위는 이웃 땅 중 가장 많은 것 위에 놓는다(같으면 모래 > 풀 > 물 > 동굴). */
function rockGround(map: MapDef, tx: number, ty: number, tide: Tide): Ground {
  const count: Record<Ground, number> = { sand: 0, grass: 0, water: 0, cave: 0, snow: 0 }
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const g = baseGround(map, tx + dx, ty + dy, tide)
    if (g) count[g]++
  }
  let best: Ground = 'sand'
  for (const g of ['grass', 'water', 'cave', 'snow'] as Ground[]) if (count[g] > count[best]) best = g
  return best
}

/** 갈대·고사목: 이웃에 땅(풀 > 모래 > 동굴)이 하나라도 있으면 그 땅, 모두 물이면 물(늪 한가운데 갈대) */
function tallGround(map: MapDef, tx: number, ty: number, tide: Tide): Ground {
  const near = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => baseGround(map, tx + dx, ty + dy, tide))
  for (const g of ['grass', 'sand', 'cave', 'snow'] as Ground[]) if (near.includes(g)) return g
  return near.includes('water') ? 'water' : 'grass'
}

/** 맵 전체의 바탕 땅(행 우선). 맵 캐시와 함께 만들고 버린다. */
export function computeGround(map: MapDef, tide: Tide): (Ground | null)[] {
  const ground: (Ground | null)[] = []
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const kind = tileAt(map, tx, ty)
      ground.push(kind === 'rock' ? rockGround(map, tx, ty, tide) : kind === 'reed' || kind === 'deadtree' ? tallGround(map, tx, ty, tide) : baseGround(map, tx, ty, tide))
    }
  }
  return ground
}
