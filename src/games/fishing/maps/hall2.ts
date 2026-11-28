// 마을회관 2층(hall2) 전시관. 순수 모듈. 경제 설계 r4 §6.2(전시관은 마을회관 2층).
// 1층(maps/hall.ts)과 같은 42×18칸 건물. 오른쪽 엘리베이터·계단 구역(x35~41)은 1층과 칸·벽·그림이 같고(HALL_STAIRS·HALL_ELEVATOR_ENTRY 공용),
// 전시관은 그 왼쪽(x1~34)이며 유리벽 x35의 유리문(y14~16)으로 이어진다.
// 행은 걷기만 정한다(F 바닥, Y 벽·받침대·데스크). 그림은 backdrop 'hall-gallery'(scripts/hall-art/gallery.py)가 그리고,
// 전시한 물고기·확장 안 한 구역의 공사 테이프는 게임이 HALL2_PEDESTALS·HALL2_WINGS 좌표로 덧그린다(scene.ts).
// 위 단상 받침대 3개 = 신화, 양쪽 두 줄 10개 = 전설(SPECIAL_IDS 순서), 가운데 데스크 = 전시관 창, 아래 띠 = 확장 1~5.
import { SPECIES } from '../data.ts'
import { defineMap, type Fixture } from '../map.ts'
import { HALL_STAIRS } from './hall.ts'

const MYTHIC_AT: readonly (readonly [number, number])[] = [[15, 3], [17, 3], [19, 3]]
const LEGEND_AT: readonly (readonly [number, number])[] = [7, 10].flatMap((y) => [8, 11, 14, 21, 24].map((x) => [x, y] as const))
const mythics = SPECIES.filter((s) => s.rarity === 'mythic').map((s) => s.id)
const legends = SPECIES.filter((s) => s.rarity === 'legend').map((s) => s.id)
/** 어종 → 받침대 칸(못 걷는 칸). 앞 칸(아래)에서 위를 보면 전시관 창 */
export const HALL2_PEDESTALS: Readonly<Record<string, { tx: number; ty: number }>> = Object.fromEntries([
  ...mythics.map((id, i) => [id, { tx: MYTHIC_AT[i][0], ty: MYTHIC_AT[i][1] }]),
  ...legends.map((id, i) => [id, { tx: LEGEND_AT[i][0], ty: LEGEND_AT[i][1] }]),
])
/** 안내 데스크(전시관 창) 칸 */
export const HALL2_DESK = { tx: 17, ty: 12 } as const
/** 전시관 확장 1~5단계 구역(걷는 칸, 확장 전에는 공사 테이프만 덧그린다) */
export const HALL2_WINGS: readonly { tx: number; ty: number; w: number; h: number }[] = [6, 10, 14, 18, 22].map((tx) => ({ tx, ty: 14, w: 4, h: 2 }))
/** 전시관 오른쪽 끝(이 열까지가 전시관, 다음 열 x35가 유리벽) */
export const HALL2_GALLERY_RIGHT = 34

const ROWS = [
  'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFYFYFYFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFYFFYFFYFFFFFFYFFYFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFYFFYFFYFFFFFFYFFYFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYY',
  'YFFFFFFFFFFFFFFFFYFFFFFFFFFFFFFFFFFFFFFYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
]
/** 테마 바닥을 덮는 칸: 전시관(x1~34)의 걷는 칸 중 카펫·단상·확장 구역·화분 칸을 뺀 곳(그림 gallery.py와 맞춘다) */
const onCarpet = (tx: number, ty: number) =>
  (tx >= 16 && tx <= 18 && ty >= 5 && ty <= 12) || (ty === 13 && tx >= 19 && tx <= 34) || (tx >= 33 && tx <= 34 && ty >= 13 && ty <= 16) || (ty >= 2 && ty <= 4 && tx >= 14 && tx <= 20)
const covered = (tx: number, ty: number) => onCarpet(tx, ty) || HALL2_WINGS.some((w) => tx >= w.tx && tx < w.tx + w.w && ty >= w.ty && ty < w.ty + w.h) || (ty === 1 && (tx === 1 || tx === 34))
export const HALL2_THEME_FLOOR: readonly { tx: number; ty: number }[] = ROWS.flatMap((row, ty) =>
  [...row].flatMap((ch, tx) => (tx <= HALL2_GALLERY_RIGHT && ch === 'F' && !covered(tx, ty) ? [{ tx, ty }] : [])),
)

const FIXTURES: Fixture[] = [
  ...Object.values(HALL2_PEDESTALS).map((p): Fixture => ({ front: { tx: p.tx, ty: p.ty + 1, facing: 'up' }, act: { kind: 'gallery' } })),
  { front: { tx: HALL2_DESK.tx, ty: HALL2_DESK.ty + 1, facing: 'up' }, act: { kind: 'gallery' } },
  // 엘리베이터(1층과 같은 자리, 문은 왼쪽 벽)
  ...[3, 4, 5].map((ty): Fixture => ({ front: { tx: 37, ty, facing: 'right' }, act: { kind: 'elevator' } })),
]

export const HALL2 = defineMap('hall2', ROWS, {
  indoor: true,
  onWorldMap: false,
  backdrop: 'hall-gallery',
  // 세계 좌표는 1층과 같은 회관 건물 자리
  world: { tx: 7, ty: 1 },
  // 계단(1층과 같은 자리): 열린 칸에 들어서면 바로 1층 계단 앞
  exits: [{ at: HALL_STAIRS.at, target: 'hall', entry: HALL_STAIRS.entry }],
  // 1층과 같은 벽: 유리벽 x35(유리문 y14~16은 열림), 계단 위쪽 벽
  walls: { v: [[35, 1, 13]], h: [[11, 38, 40]] },
  fixtures: FIXTURES,
})
