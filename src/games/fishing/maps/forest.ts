// 숲 맵(forest). 순수 모듈.
// 빽빽한 나무 사이 오솔길. 북쪽 절벽(c)에서 폭포(w)가 웅덩이(b)로 떨어지고, 남서쪽 빈터에 연못(p)이 있다.
import { defineMap } from '../map.ts'

// 테두리는 동쪽 출구(ty 18~19의 길)를 빼면 나무·절벽이라 걸을 수 없다.
// 길(=): 동쪽 출구 → 서쪽으로 갈라져 위로는 폭포 웅덩이 빈터, 아래로는 연못 빈터, 남동쪽 꽃 빈터.
// 웅덩이 가 풀밭에서 웅덩이를 보면 waterfall, 연못 가에서 연못을 보면 pond. 폭포·절벽 앞은 낚시 불가.
// 동굴 입구 자리: 웅덩이 동쪽 작은 빈터 위 절벽(tx 35, ty 5). 3단계에서 연다. 지금은 절벽으로 막혀 있다.
export const FOREST = defineMap('forest', [
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTcccccccccccccccccwwwccccccccccccccccccTTTTT',
  'TTTTTcccccccccccccccccwwwccccccccccccccccccTTTTT',
  'TTTTTcccccccccccccccccwwwccccccccccccccccccTTTTT',
  'TTTTTcccccccccccccccccwwwccccccccccccccccccTTTTT',
  'TTTTTTTTTcccTTT,T,ccccwwwccc,,,fTccccccTTTTTTTTT',
  'TTTTTTTTTTTTTTT,f,,,obbbbb,,,,T,To,,,TTTTTTTTTTT',
  'TTTTTTTTTTTTTTT,T,obbbbbbbbboT,,T,,,T,,TTTTTTTTT',
  'TTTTTTTTTTTTTTf,,f,bbbbbbbbb,,,f,,f,,,,TTTTTTTTT',
  'TTTTTTTTTTTTTT,f,,,bbbbbbbbbf,,Tf,,,,fTTTTTTTTTT',
  'TTTTTTTTT,,TTT,,,,,ofbbbbb,o,,,,,,,,TTTTTTTTTTTT',
  'TTTTTT,,,,,Tf,T,f,,,,,,f,,,,,f,,TTTTTTTTTTTTTTTT',
  'TTTTTTf,,,,,,,,T,,T,,,,f,,,,,,,,TTTTTTTTTTTTTTTT',
  'TTTTTT,,,,f,,,,,,,,,,,,,,,,,,=,,,,,,,,TTTTTTTTTT',
  'TTTTT,,,f,,f,,,T,TTT,T,,,f,f,=========,TTTTTTTTT',
  'TTTTTT,T,ff,,fffTTTTTTTTT,T,T,,,,,,,,=,TTTTTTTTT',
  'TTTTTTTT,,T,,,,fTTTTTTTTTTTTTTTTTTTT,=,TTTTTTTTT',
  'TTTTTTTTTTT,,,T,TTTTTTTTTTTTTTTTTTTT,=,,,,,,,,,T',
  'TTTTTTTTTTTTT,,fTTTTTTTTTTTTTTTTTTTT,===========',
  'TTTTTTTTTTTTT,,,TTTTTTTTTTTTTTTTTTTT,=,,,,,,,,==',
  'TTTTTTTTTTT,T,,,TTTTTTTTTTTTTTTTTTTT,=,TTTTTTTTT',
  'TTTTTTTTTT,,,,,T,,T,,TTTTTTTTTTTTTTT,=,TTTTTTTTT',
  'TTTTTTTTTTf,,,,,,,,,,,TTTT,,,,,,,,,,,=,TTTTTTTTT',
  'TTTTTTTT,f,,,,,,,,,,,,fTT,============,TTTTTTTTT',
  'TTTTT,T,,pppppppp,ff,,,TT,=,,,,,,,,,,=,TTTTTTTTT',
  'TTTTT,f,,poppppppp,,,,,,,,=,TTTTTTTT,=,TTTTTTTTT',
  'TTTTTTT,ppppppppopp,,======,TTTTTTTT,=,T,T,TTTTT',
  'TTTTTT,,ppppppppppp,,,,,,,,TTTTTTTTT,=,,,,,fTTTT',
  'TTTTTf,,,ppppppppp,fTT,TTTTTTTTTTTTT,=,,,,,,TTTT',
  'TTTTTTT,,f,,,pp,,,,ffTTTTTTTTTTTTTTT,====,,,,TTT',
  'TTTTTTTT,,,,,,,,,f,fTTTTTTTTTTTTTTTT,,,,,,,,,TTT',
  'TTTTTTTT,T,f,,,,,,TTTTTTTTTTTTTTTTTTTTTT,,,,TTTT',
  'TTTTTTTTTTT,TT,TTTTTTTTTTTTTTTTTTTTTTTTT,T,TTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
], {
  spots: { pond: 'pond', basin: 'waterfall' },
  // 동쪽 출구 → 강 서쪽 출구 두 칸 안쪽
  exits: [{ edge: 'e', from: 18, to: 19, target: 'river', entry: { tx: 2, ty: 6, facing: 'right' } }],
})
