// 늪지 맵(swamp). 순수 모듈. 숲 서쪽 엉킨 덩굴을 걷어 내면(늪 나무 데크 60,000G) 열린다.
// 얕은 늪물(z) 사이로 나무 데크(d)가 이어지고, 고사목(X)·갈대(R)가 서 있다. 안쪽에 검은 수렁(Q) 웅덩이 둘. 안개가 낀다(장면 효과).
import { defineMap } from '../map.ts'

// 테두리는 동쪽 출구(ty 11~12의 길)를 빼면 나무라 걸을 수 없다.
// 동쪽 풀밭(도착) → 데크가 서쪽으로 길게: 북쪽 갈래 끝(tx 14, ty 5)에서 위를 보면 수렁 A,
// 남쪽 갈래 → 남쪽 풀밭 섬(순간이동기) → 동쪽 짧은 데크 끝(tx 35, ty 27)에서 오른쪽을 보면 수렁 B.
// 수렁 옆 걷는 칸은 데크뿐이라 수렁은 데크 끝에서만 보인다. 늪물은 데크·풀밭 어디서나 marsh.
export const SWAMP = defineMap('swamp', [
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTzzzzzzzzzzzQQQzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzTT',
  'TTzzzzzzzzRzQQQQQRzzzzzzzzzzzzzzzzzzzzzzzzzzzzTT',
  'TTzzzzXzzzRzQQQQQRzzzzzzzzzzXzzzzzzzzzzzzzzzzzTT',
  'TTzzzzzzzzzzzzdzzzzzXzzzzzzzzzzzzzzzzRzzzzzzzzTT',
  'TTzzzzzzzzzzzzdzzzzzzzzzzzzzzzzzzzzzzz,T,,,,,,TT',
  'TTzzzzzzzzzzzzdzzzzzzzzzzzzzzzzzzXzzzz,,,,,T,,TT',
  'TTzzzzzzzzzzzzdzzzzzzzXzzzzzzzzzzzzzzz,,,,f,,,TT',
  'TTzzz,,,zzzRRzdzzzzzzzzzzzzzzzzRRzzzzzR,,,,,,,TT',
  'TTzz,,,,,zzzzzdzzzzzzzzzzzzzzzzzzzzzzz,,,,,,,,TT',
  'TTzz,f,,,ddddddddddddddddddddddddddddd,,========',
  'TTzz,,,,,zzzzzzzzzzzzzzzdzzzzzzzzzzzzz,,========',
  'TTzzz,,,zzzzzzzzzzRRzzzzdzzzzzzzzzzzzR,,,,,,,,TT',
  'TTzzzzzzzzzzzzzzzzzzzzzzdzzRRzzzzzzzzzR,,,,,f,TT',
  'TTzzzzzzzzzzzzzzzzzzzzzzdzzzzzzzzzzzzz,,fT,,,,TT',
  'TTzzzzzzzzzzzzzzzzzzzzzzdzzzzzXzzzzzzz,,,,,,,TTT',
  'TTzzzzzzzzzzzzzzzzzzzzzzdzzzzzzzzzzzzzT,,,,,,,TT',
  'TTzzzzzzzXzzzzzzzzzzzzzzdzzzzzzzzzzzzzzzzzzzzzTT',
  'TTzzzzzzzzzzzzzzzzzzzzzzdzzzRzzzzzzzzzzzzzzzzzTT',
  'TTzzzRzzzzzzzzzzXzzzzzzzdzzzzzzzzzzXzzzzzzzzzzTT',
  'TTzzzRzzzzzzzzzzzzzzzzzzdzzzzzzzzzzzzzzzXzzzzzTT',
  'TTzzzzzzzzzzzzzzzzzzzzzzdzzzzzzzzzzzzzzzzzzzzzTT',
  'TTzzzzzzzzzzzzzzzzzzzzzzdzzzzzzzzzzzzzzzzzzzzzTT',
  'TTzzzzzzzzXzzzzzzzzz,,,,,,,,,,zzzzzzzzzzzzzzzzTT',
  'TTzzzzzzzzzzzzzzzzz,,,,,,,,f,,XzzzzzzQQQzzXzzzTT',
  'TTzzzzzzzzzzzzzRzz,,,f,,,,,,,,,,zzzzQQQQQRzzzzTT',
  'TTzzzzXzzzzzzzzRzz,,,,,,,,,,,,,,ddddQQQQQQRzzzTT',
  'TTzzzzzzzzzzzzzzzz,,f,,,,,,,,,,,zzzzzQQQQQzzzzTT',
  'TTzzzzzzzzzzzzzzzz,,,,,,f,,,,,,,zzzRzzQQQzzzzzTT',
  'TTzzzzzzzzzzXzzzzzzX,,,,,,,,,f,zzzzzRzzzzzzzXzTT',
  'TTzzzzzzzzzzzzzzzzzz,,,,,,,,,,zzzzzzzzzzzRRzzzTT',
  'TTzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzXzzzzzzzzzzzTT',
  'TTzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
], {
  fog: true,
  spots: { marsh: 'marsh', bog: 'bog' },
  // 동쪽 출구 → 숲 서쪽 문 앞(아래 칸은 나무 윗부분에 가려진다)
  exits: [{ edge: 'e', from: 11, to: 12, target: 'forest', entry: { tx: 2, ty: 11, facing: 'right' } }],
  teleporter: { tiles: { tx: 27, ty: 26, w: 2, h: 2 }, front: { tx: 27, ty: 28, facing: 'down' } },
  world: { tx: -96, ty: -34 },
})
