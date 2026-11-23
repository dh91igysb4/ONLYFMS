// 산 호수 맵(lake). 순수 모듈. 강 북쪽 무너진 다리를 고치면(5,000G) 열린다.
// 북쪽 산(절벽 c)에서 폭포(w)가 떨어지는 큰 호수(k). 호숫가 풀밭을 나무와 바위가 둘러싼다.
import { defineMap } from '../map.ts'

// 테두리는 남쪽 출구(tx 24~25의 길)를 빼면 나무·절벽이라 걸을 수 없다.
// 길(=): 남쪽 출구 → 숲길을 따라 위로 → 호수 남쪽 물가. 물가 풀밭 어디서든 호수를 보면 lake.
// 바위(o)는 물가 장식(물속 바위는 바다색 바탕이 깔려 호수에 두지 않는다). 폭포 앞은 낚시 불가.
export const LAKE = defineMap('lake', [
  'TTTTTTTTTTccccccccccccccccccwwccccccccccccTTTTTT',
  'TTTTTTTTccccccccccccccccccccwwccccccccccccccTTTT',
  'TTTTTTTcccccccccccccccccccccwwcccccccccccccccTTT',
  'TTTTTT,cccccccccccccccccccccwwccccccccccccccc,TT',
  'TTTTT,,,TTcccccccccccccccckkkkkkcccccccccccT,,TT',
  'TTTT,,f,,,TTcccccccckkkkkkkkkkkkkkkcccccTTT,f,TT',
  'TTT,,,,,,,,,,,occkkkkkkkkkkkkkkkkkkkkkcco,,,,,,T',
  'TT,,,f,,,,,,,,,kkkkkkkkkkkkkkkkkkkkkkkkk,,,f,,TT',
  'TT,,,,,,,,o,,kkkkkkkkkkkkkkkkkkkkkkkkkkkk,,,,,TT',
  'T,,T,,,,,,,,kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk,,T,,T',
  'T,TTT,,,f,,kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk,,,,T',
  'TTTTT,,,,,kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk,f,T',
  'TTTT,,,,,,kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk,,TT',
  'TTT,,f,,,,kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk,,TT',
  'TT,,,,,,,,kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk,,,T',
  'T,,,o,,,,,,kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk,,f,T',
  'TT,,,,,f,,,kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk,,,TT',
  'TT,f,,,,,,,,kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk,,,,TT',
  'TTT,,,,T,,,,,kkkkkkkkkkkkkkkkkkkkkkkkkkkk,,T,,TT',
  'TTTT,,TTT,,,,,kkkkkkkkkkkkkkkkkkkkkkkkkk,,TTT,TT',
  'TTTT,,,T,,,f,,,kkkkkkkkkkkkkkkkkkkkkkkk,,,,T,,,T',
  'TTT,,,,,,,,,,,,,,kkkkkkkkkkkkkkkkkkkk,,,,,,,,,TT',
  'TT,,f,,o,,,,,,,,,,,,kkkkkkkkkkkkkk,,,,,f,,,,,,TT',
  'TT,,,,,,,,,,f,,,,,,,,,,,=,,,,,,,,,,,,o,,,,f,,TTT',
  'TTT,,,,,,,,,,,,,,,,,,,,,=,,,,,,,,,,,,,,,,,,,,TTT',
  'TTTT,,T,,,,,,,,f,,,,,,,,=,,,,,,,f,,,,,,T,,,,TTTT',
  'TTTTTTT,,,f,,,,,,,,,,,,,=,,,,,,,,,,,,,,TTT,,TTTT',
  'TTTTTTTT,,,,,,,T,,,,,,,,=,,,,,,,T,,,,,TTTTTTTTTT',
  'TTTTTTTTT,,,TTTTT,,,,,,,=,,,,f,TTTT,,TTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTT,,,,,,=,,,TTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTT,,,,,==,TTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTT,,==,TTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTT==TTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTT==TTTTTTTTTTTTTTTTTTTTTT',
], {
  spots: { lake: 'lake' },
  // 남쪽 출구 → 강 북쪽 출구 한 칸 안쪽(골짜기 다리 북쪽 길)
  exits: [{ edge: 's', from: 24, to: 25, target: 'river', entry: { tx: 24, ty: 1, facing: 'down' } }],
})
