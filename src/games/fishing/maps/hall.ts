// 마을회관 1층(hall). 순수 모듈. 평면 v7(설계 docs/superpowers/specs/2026-11-25-village-hall-design.md §3).
// 행은 걷기만 정한다(F 바닥, Y 벽·가구). 그림은 backdrop 'hall-interior'(scripts/build-hall-art.py)가 그린다.
// 방 유리벽은 칸을 차지하지 않는 벽 모서리(walls)다. 1번 문 x11~12, 7번 문 x16~17, 9번 문 x29~30만 열려 있고 6·8번은 잠겨 있다.
// 7번 방 의자 칸(x15·x19)은 지나갈 수 있다(책상만 막는다). 명예의 전당(2~5 합침)은 복도 쪽 벽이 없다. 메인 복도는 x35 유리벽에서 끝나고, 엘리베이터·계단 구역은
// x31~34 복도에서 유리문(x35, y14~16)으로 들어간다.
import { defineMap, type Fixture, type FixtureAct, type Facing } from '../map.ts'

const at = (tx: number, ty: number, facing: Facing, act: FixtureAct): Fixture => ({ front: { tx, ty, facing }, act })
const many = (cells: readonly (readonly [number, number])[], facing: Facing, act: FixtureAct): Fixture[] => cells.map(([tx, ty]) => at(tx, ty, facing, act))

/** 회관 층마다 같은 자리(1·2층 공용): 계단 입구 칸과 다른 층에서 계단으로 오면 서는 칸, 엘리베이터에서 내리면 서는 칸 */
export const HALL_STAIRS = { at: { tx: 38, ty: 11, w: 1, h: 3 }, entry: { tx: 37, ty: 12, facing: 'left' } } as const
export const HALL_ELEVATOR_ENTRY = { tx: 37, ty: 4, facing: 'left' } as const

const FIXTURES: Fixture[] = [
  // 자판기 = 상점(왼쪽 벽, 오른쪽을 본다)
  ...many([[2, 1], [2, 2], [2, 3]], 'left', { kind: 'shop' }),
  // 1번 방: 냉장고(오른쪽 벽, 개인 보관함) · 쓰레기통(왼쪽 벽, 버리기 부담금 5%)
  ...many([[13, 1], [13, 2], [13, 3]], 'right', { kind: 'fridge' }),
  ...many([[11, 1], [11, 2], [11, 3]], 'left', { kind: 'trash' }),
  // 명예의 전당: 박제(최대어, 2칸) · 누적 수익 · 도감 · 도전과제, 게임 액자 11칸(x24~34)
  ...many([[16, 2], [17, 2]], 'up', { kind: 'fame', slot: { group: 'record', key: 'biggest' } }),
  at(18, 2, 'up', { kind: 'fame', slot: { group: 'record', key: 'total_earned' } }),
  at(19, 2, 'up', { kind: 'fame', slot: { group: 'record', key: 'dex' } }),
  at(20, 2, 'up', { kind: 'fame', slot: { group: 'record', key: 'challenges' } }),
  ...Array.from({ length: 11 }, (_, i) => at(24 + i, 2, 'up', { kind: 'fame', slot: { group: 'site', index: i } })),
  // 7번 방 노트북 두 대 → 게임 목록
  at(16, 11, 'down', { kind: 'laptop' }),
  at(18, 14, 'down', { kind: 'laptop' }),
  // 9번 방 옷 가게 행거
  ...many([[29, 12], [29, 13], [29, 14]], 'left', { kind: 'wardrobe' }),
  // 잠긴 6·8번 문(방은 복도 아래쪽이라 문을 아래로 본다)
  ...many([[11, 10], [12, 10]], 'down', { kind: 'notice', text: '곤의 라면가게 · 준비 중이에요' }),
  ...many([[21, 10], [22, 10]], 'down', { kind: 'notice', text: '들어갈 수 없어요' }),
  // 엘리베이터(문은 왼쪽 벽). 계단은 fixture가 아니라 출구(exits)
  ...many([[37, 3], [37, 4], [37, 5]], 'right', { kind: 'elevator' }),
]

export const HALL = defineMap('hall', [
  'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
  'YYFFFFFFYYYFFFYFYYYYYYYYYYYYYYYYYYYFFFYYYY',
  'YYFFFFFFYYYFFFYFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YYFFFFFFFFYFFFYFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFYFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFYYYFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFYFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYY',
  'YFFFFFFFFYFFFFFFYYYFYYYYYYYYYFYFFFFFFFFYYY',
  'YFFFFFFFFYFFFFFFYYYFYYYYYYYYYFYFFFFFFFFYYY',
  'YFFFFFFFFYFFFFFFFFFFFFFFFYYYYFYFFFFFFFYYYY',
  'YYFFFFFFYYFFFFFFYYYFYYYYYYYYYYYFFFFFFFYYYY',
  'YFFFFFFFFYFFFFFFYYYFYYYYYFFFFYYFFFFFFFYYYY',
  'YYYFFFYYYYYYYYYYYYYYYYYYYYYYYYYFFFYYYYYYYY',
], {
  indoor: true,
  onWorldMap: false,
  backdrop: 'hall-interior',
  // 세계 좌표는 마을 안 회관 건물 자리(순간이동 요금 계산용)
  world: { tx: 7, ty: 1 },
  // 왼쪽 벽 로비 이동기(과제 없이 켜진다, logic.version 18). 도착하면 앞 칸에서 오른쪽을 본다
  teleporter: { tiles: { tx: 1, ty: 8, w: 2, h: 2 }, front: { tx: 3, ty: 8, facing: 'right' } },
  exits: [
    // 계단(x38~40 y11~16, 왼쪽 위가 열림): 열린 칸(x38 y11~13)에 들어서면 바로 2층 같은 자리 계단 앞(HALL_STAIRS)
    { at: HALL_STAIRS.at, target: 'hall2', entry: HALL_STAIRS.entry },
    { edge: 's', from: 3, to: 5, target: 'village', entry: { tx: 13, ty: 8, facing: 'down' } },
    { edge: 's', from: 31, to: 33, target: 'village', entry: { tx: 13, ty: 8, facing: 'down' } },
  ],
  walls: {
    v: [[8, 1, 6], [10, 1, 6], [15, 1, 6], [35, 1, 13], [10, 11, 16], [15, 11, 16], [20, 11, 16], [25, 11, 16], [31, 11, 16]],
    h: [[7, 10, 10], [7, 13, 14], [11, 10, 15], [11, 18, 28], [11, 38, 40]],
  },
  fixtures: FIXTURES,
})
