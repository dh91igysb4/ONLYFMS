// 갯벌 맵(tideflat). 순수 모듈. 마을 서쪽 끝 통나무 더미를 치우면(갯벌 장화 30,000G) 열린다.
// 북쪽은 풀밭과 모래 둑, 서쪽에서 강(r, 하구)이 흘러 남쪽 바다(~)로 빠진다. 가운데 넓은 진흙(m)에 굽은 갯골(g) 두 줄.
import { defineMap } from '../map.ts'

// 테두리는 동쪽 출구(ty 15~17의 모래)를 빼면 나무·강·바다라 걸을 수 없다.
// 진흙(m)은 물때를 따른다: 썰물(2~6시·14~18시)에는 걷는 땅, 밀물에는 하구 물(estuary 낚시).
// 갯골(g)은 늘 물이고 늘 걷는 칸(모래·풀)과 붙지 않는다: 갯골 낚시는 썰물에 진흙으로 걸어 들어가야만 된다.
// 진흙 덩어리는 모두 북쪽 둑이나 동쪽 모래사장에 닿아 있어 밀물이 들어오면 가장 가까운 땅(nearestDryTile)으로 나온다.
// 강·바다는 모래 둑·동쪽 모래사장에서 밀물·썰물 모두 하구(estuary)로 낚는다.
// 순간이동기(tx 24~25, ty 6~7)는 북쪽 모래 둑 가운데.
export const TIDEFLAT = defineMap('tideflat', [
  'TTTrrrrTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTrrrrTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTrrrrR,,T,,,,,,,,,,T,,,,,,,,,,,,,,T,,,,,,,,T,T',
  'TTTrrrrR,,,,,,,T,,,,,,,,,,,,,T,,,,,,,,,,T,,,,,,T',
  'TTTrrrrRR,,,,f,,,,,,,,,,,,,f,,,,,,,,,,f,,,,,R,,T',
  'TTTrrrr........................................T',
  'TTTrrrr........................................T',
  'TTTrrrr........................................T',
  'TTTrrrr........................................T',
  'TTTrrrr........................................T',
  'TTTrrrrR.RR........R...........R.R.............T',
  'TTTrrrrRRRRRR.....RRRR........RRRRR.......R....T',
  'TTTrrrrmmmmmmm...mmmmmmmmmm...mmmmm..mm........T',
  'TTTrrrrmmmmmmmm.mmmmmmmmmmmm.mmmmmmmmmmm.......T',
  'TTTrrrrmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm..o...T',
  'TTTrrrrmmmmmmmggmmmmmmmmmmmmmmmggmmmmmmmm.......',
  'TTTrrrrmmmmmmmggmmmmmmmmmmmmmmggmmmmmmmm........',
  'TTTrrrrmmmmmmmmggmmmmmmmmmmmmggmmmmmmmm.........',
  'TTTrrrrmmmmmmmmmggmmmmmmmmmmmggmmmmmmmmm.......T',
  'TTTrrrrmmmmmmmmmmggmmmmmmmmmmmggmmmmmmmmm......T',
  'TTTrrrrmmmmmmmmmmggmmmmmmmmggmmggmmmmmmmmm.....T',
  'TTTrrrrmmmmmmmmmmggmmmmmmmmmggmmggmmmmmmmm.....T',
  'TTTrrrrmmmmmmmmmmmggmmmmmmmmmmmmmggmmmmmm...o..T',
  'TTTrrrrmmmmmmmmmmmmggmmmmmmmmmmmmggmmmmm.......T',
  'TTrrrrrmmmmmmmmmmmmmggmmmmmmmmmmmmggmmmm.......T',
  'TTrrrrrmmmmmmmmmmmmmmggmmmmmmmmmmmmggmmmm......T',
  'TTrrrrrmmmmmmmmmmmmmmggmmmmmmmmmmmmggmmmmm.....T',
  'TTrrrrrmmmmmmmmmmmmmmmggmmmmmmmmmmmmggmmm......T',
  'TTrrrrrmmmmmmmmmmmmmmmmggmmmmmmmmmmmggmm.......T',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~o~~~~~~~',
  '~~~~~~~~~~~~o~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~o~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
], {
  tidal: true,
  spots: { river: 'estuary', water: 'estuary', mud: 'estuary', creek: 'creek' },
  // 동쪽 출구 → 마을 서쪽 문 앞(문 칸 바로 안쪽)
  exits: [{ edge: 'e', from: 15, to: 17, target: 'village', entry: { tx: 2, ty: 20, facing: 'right' } }],
  teleporter: { tiles: { tx: 24, ty: 6, w: 2, h: 2 }, front: { tx: 24, ty: 8, facing: 'down' } },
  world: { tx: -48, ty: 4 },
})
