// 산정 호수 맵(summit). 순수 모듈. 산 호수 북동쪽 산길의 눈더미를 치우면(등산 장비 120,000G) 열린다.
// 일 년 내내 얼어 있는 산꼭대기 호수: 눈밭(s)과 눈 소나무(A), 북쪽 절벽(c)과 내려온 절벽 줄기, 눈 덮인 바위(o), 얼음판 가의 언 갈대(R). 가운데 큰 얼음판(i)은 걸을 수 있고,
// 얼음을 보고 "구멍 뚫기"(1.2초)를 하면 그 칸이 얼음 구멍(ice 자리)이 된다(화면 상태, 방문당 3개).
// 동쪽에는 김이 오르는 작은 온천(h, hotspring 자리)이 늘 녹아 있다.
import { defineMap } from '../map.ts'

// 테두리는 남쪽 출구(tx 22~23의 눈길)를 빼면 절벽·눈 소나무라 걸을 수 없다.
// 얼음판 둘레 눈밭이나 얼음 위 어디서든 얼음을 보면 drill. 온천은 둘레 눈밭에서 낚는다.
// 순간이동기(tx 30~31, ty 27~28)는 얼음판 남동쪽 눈밭.
export const SUMMIT = defineMap('summit', [
  'cccccccccccccccccccccccccccccccccccccccccccccccc',
  'cccccccccccccccccccccccccccccccccccccccccccccccc',
  'cccccccccccccccccccccccccccccccccccccccccccccccc',
  'cccccccccccccccccccccccccccccccccccccccccccccccc',
  'AAsAssAsccssAssAssAssAssAssAsscccAssAssAssAssAAA',
  'AAssssssAcssssssssssssssssssssccssssssssssssssAA',
  'AAAssssssssssoosssssssssssssssscssssAAssssssssAA',
  'AAssssssssssssosssssiiiiiiissssssssssssssssssAAA',
  'AAssssosssssssssiiiiiiiiiiiiiiisssRsssssssssssAA',
  'AAAssssssssssiiiiiiiiiiiiiiiiiiiiissssssssssssAA',
  'AAssssssssssiiiiiiiiiiiiiiiiiiiiiiissssossssssAA',
  'AAssssssssiiiiiiiiiiiiiiiiiiiiiiiiiiissshhhsosAA',
  'AAsAssssssiiiiiiiiiiiiiiiiiiiiiiiiiiissshhhhssAA',
  'AAsssssssiiiiiiiiiiiiiiiiiiiiiiiiiiiiissshhsssAA',
  'AAsssssRiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiossssssAA',
  'AAAssssRiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiisssssssAA',
  'AAsssssRiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiRssssssAA',
  'AAsssAAsiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiRssssssAA',
  'AAsssAssiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiisssssAsAA',
  'AAsssssssiiiiiiiiiiiiiiiiiiiiiiiiiiiiiRsssssssAA',
  'AAAsssssssiiiiiiiiiiiiiiiiiiiiiiiiiiisssssosssAA',
  'AAssssssssiiiiiiiiiiiiiiiiiiiiiiiiiiisssssssssAA',
  'AAssosssssssiiiiiiiiiiiiiiiiiiiiiiioossssssssAAA',
  'AAsssssssssssiiiiiiiiiiiiiiiiiiiiissosssssssssAA',
  'AAsAssssssssssssiiiiiiiiiiiiiiisssssssssAAssssAA',
  'AAsssssssssssssssssRiiiiiiissssssssssssssAssssAA',
  'AAsssssossssssssssssssssssssssssssssssssssssssAA',
  'AAssssssssssssssssssssssssssssssssssssssssssAsAA',
  'AAsssssssssssssssAAsssssssssssssssssosssssssssAA',
  'AAAsssssssssosssssssssssssssssssssssssssssssssAA',
  'AAssssssssoossssssssssssssssssssssssssssssssssAA',
  'AAsssAsssssssssssssssssssssAAssssssssssssssssAAA',
  'AAssssssssssssAsssssssssssssssssssssssAsssssssAA',
  'AAsAsssssAssssssssssssssssossssssAssssssssAsAsAA',
  'AAsssssssssssssssssssAssAsssssssssssssssssssssAA',
  'AAAAAAAAAAAAAAAAAAAAAAssAAAAAAAAAAAAAAAAAAAAAAAA',
], {
  snowy: true,
  spots: { hole: 'ice', hotspring: 'hotspring' },
  // 남쪽 출구 → 산 호수 북쪽 산길 한 칸 안쪽
  exits: [{ edge: 's', from: 22, to: 23, target: 'lake', entry: { tx: 45, ty: 1, facing: 'down' } }],
  teleporter: { tiles: { tx: 30, ty: 27, w: 2, h: 2 }, front: { tx: 30, ty: 29, facing: 'down' } },
  world: { tx: 0, ty: -104 },
})
