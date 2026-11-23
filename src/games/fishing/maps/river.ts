// 마을 강 맵(river). 순수 모듈.
// 가운데를 가로로 굽이치는 강, 그 위에 나무 다리(H) 하나. 남쪽 들판은 마을로, 북쪽 들판은 서쪽 숲으로 이어진다.
import { defineMap } from '../map.ts'

// 테두리는 출구 두 곳(남쪽 tx 24~25, 서쪽 ty 6~7의 길)을 빼면 나무·강물이라 걸을 수 없다.
// 길(=): 남쪽 출구 → 위로 꺾여 다리 남단 → 다리(tx 31~32) → 북쪽 들판을 서쪽으로 → 서쪽 출구.
// 강가 모래톱(.)과 풀밭, 다리 위 어디서든 강물을 보면 낚시. 강 속 바위(o)는 찌가 멈추는 곳.
// 북쪽 가운데 절벽(c)은 3단계에서 산 호수로 가는 무너진 다리 자리. 지금은 막혀 있다.
export const RIVER = defineMap('river', [
  'TTTTTTTTTTTTTTTTTTTcccccccccccTTTTTTTTTTTTTTTTTT',
  'T,,T,,TT,,,,,,T,,TTcccccccccccTT,,TTTTT,,,TT,TTT',
  'TT,,,,,,,,,f,,TT,TocccccccccccoT,,,,,,,,,T,f,,,T',
  'TT,,TTTf,,,,,,,,ff,o,ccccccc,o,T,,f,,,,TTT,,,fTT',
  'TTf,TTTT,,,,,T,,,,,,f,,,,,,,,,,,,,,,,,TTTTT,,TTT',
  'T,,,TTT,,,,,,,,,T,,,ff,,,,,,,,,,,,,,f,,TTT,f,,,T',
  '=============,,,,,ff,,f,,,,T,,,,,,,,,,,,f,f,,,TT',
  '===,,,,,o,,,=============,,,,,,,,,,T,,,,,,o,,,,T',
  'T,,,,,,,,,,,,,,,,,,,,,,,=,,,,,,,,,TT,,,f,T,,f,TT',
  'TT,,,,,,,,,,,,,f,,,,,,,,========,,,T,,f,f,,,,,TT',
  'TT,,f,,,Tf,,f,,f,,,,,T,,,,,,,,,=,,,,,,,f,f,,TT,T',
  'TT,,,,,fT,,f,,,,T,,,,,,,rrrrrr,=,,,,,,,T,,,,,,fT',
  'T,T,,,,,f,,,,,,,,,,,,,rrrrrrrrrHHrr,o,,f,,,,,,TT',
  'T,,,,,,,,,,f,,,,,,,rrrorrrrrrrrHHrrrrr,,,,,f,TTT',
  'rr,,,,,,,,,,,,...rrrrrrrrrrrrrrHHrrrrrrrr,,,,,,T',
  'rrrorr,,,,,...rrrrrrrrrrrrrrrrrHHrrrrrrrrrrrrrrr',
  'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrHHrrrrrrrrrrrorrr',
  'rrrrrrrrrrrrrrrrrrrrrrrrrro,,,,=,,,,,..rrrrrrrrr',
  'rrrrrrrrrrrrrrorr...,,,,,,,,,,,=,,,,,,,...rrrrrr',
  'rrrrrrrrrrrr.....,,,,,,,,,,,,,,=,,,,,f,,,,...rrr',
  'Trrrrro.........,,,,,,,,,,,f,,,=,,,,,,,,,,,,,,,T',
  'TT,,,..,.,.T,,,,,,,,,,,,f,,,,,,=,,,,,,,,,T,,,T,T',
  'TT,,,,,,,f,,,f,,,,,,,,ff,,,ff,,=,,,,T,T,,,,,,,TT',
  'TT,,,,,,,,f,,,,,,T,,,,,,,,f,T,,=,fT,,,,,,,,,,,TT',
  'T,,,,f,,,,,f,,,TTTT,,,T,,,,,====f,,f,f,,,,,,,,,T',
  'T,,TTTf,,f,,f,,,,,,,,,,,ff,,=,,,,,f,,,,,,TTTT,TT',
  'TT,TTT,,fff,,,,,,,,,,,,,,,,,=,,f,,,,TT,,,TTTT,TT',
  'TT,TTT,,,Tf,,,f,,,,,,,,,=====,,,,,,,,,,,,TTTf,TT',
  'T,,,,,,,,,,,ff,T,,,,o,,,==,,,,,,,of,,,,,,,T,f,,T',
  'TT,,,,,,,,,,f,TT,T,,,,,,==f,,,,f,,,,T,,,T,,Tf,fT',
  'T,,,,,,,,,,,f,,,,,f,f,,,==,,,,,,,,,TTT,,,,,,f,fT',
  'T,,,,,T,,,,,,T,,,f,,,,,,==f,,,,,,,,,T,,,,,,ff,,T',
  'TTTT,,f,,,,,,f,T,fTT,T,T==,,TTT,TT,TTT,T,,TT,,,T',
  'TTTTTTTTTTTTTTTTTTTTTTTT==TTTTTTTTTTTTTTTTTTTTTT',
], {
  spots: { river: 'river' },
  exits: [
    // 남쪽 출구 → 마을 북쪽 출구 두 칸 안쪽
    { edge: 's', from: 24, to: 25, target: 'village', entry: { tx: 24, ty: 2, facing: 'down' } },
    // 서쪽 출구 → 숲 동쪽 출구 두 칸 안쪽
    { edge: 'w', from: 6, to: 7, target: 'forest', entry: { tx: 45, ty: 18, facing: 'left' } },
  ],
})
