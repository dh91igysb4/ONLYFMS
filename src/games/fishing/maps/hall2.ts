// 마을회관 2층(hall2) 전시관. 순수 모듈. 경제 설계 r4 §6.2(전시관은 마을회관 2층).
// 행은 걷기만 정한다(F 바닥, Y 벽·받침대·데스크·계단). 그림은 backdrop 'hall-gallery'(scripts/build-hall-art.py)가 그리고,
// 전시한 물고기·확장 안 한 구역의 공사 테이프는 게임이 HALL2_PEDESTALS·HALL2_WINGS 좌표로 덧그린다(scene.ts).
// 위 단상 받침대 3개 = 신화, 양쪽 두 줄 10개 = 전설(SPECIAL_IDS 순서), 가운데 데스크 = 전시관 창, 아래 띠 = 확장 1~5, 오른쪽 아래 계단 = 1층.
import { SPECIES } from '../data.ts'
import { defineMap, type Fixture } from '../map.ts'

const MYTHIC_AT: readonly (readonly [number, number])[] = [[10, 2], [12, 2], [14, 2]]
const LEGEND_AT: readonly (readonly [number, number])[] = [6, 9].flatMap((y) => [3, 6, 9, 16, 19].map((x) => [x, y] as const))
const mythics = SPECIES.filter((s) => s.rarity === 'mythic').map((s) => s.id)
const legends = SPECIES.filter((s) => s.rarity === 'legend').map((s) => s.id)
/** 어종 → 받침대 칸(못 걷는 칸). 앞 칸(아래)에서 위를 보면 전시관 창 */
export const HALL2_PEDESTALS: Readonly<Record<string, { tx: number; ty: number }>> = Object.fromEntries([
  ...mythics.map((id, i) => [id, { tx: MYTHIC_AT[i][0], ty: MYTHIC_AT[i][1] }]),
  ...legends.map((id, i) => [id, { tx: LEGEND_AT[i][0], ty: LEGEND_AT[i][1] }]),
])
/** 전시관 확장 1~5단계 구역(걷는 칸, 확장 전에는 공사 테이프만 덧그린다) */
export const HALL2_WINGS: readonly { tx: number; ty: number; w: number; h: number }[] = [1, 5, 9, 13, 17].map((tx) => ({ tx, ty: 13, w: 4, h: 2 }))
/** 1층 계단에서 올라오면 서는 칸 */
export const HALL2_ARRIVAL = { tx: 21, ty: 13, facing: 'left' } as const

const FIXTURES: Fixture[] = [
  ...Object.values(HALL2_PEDESTALS).map((p): Fixture => ({ front: { tx: p.tx, ty: p.ty + 1, facing: 'up' }, act: { kind: 'gallery' } })),
  { front: { tx: 12, ty: 12, facing: 'up' }, act: { kind: 'gallery' } },
  // 계단(오른쪽) → 1층 계단 앞
  ...[12, 13].map((ty): Fixture => ({ front: { tx: 21, ty, facing: 'right' }, act: { kind: 'stairs', target: 'hall', entry: { tx: 37, ty: 12, facing: 'left' } } })),
]

const ROWS = [
  'YYYYYYYYYYYYYYYYYYYYYYYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFYFYFYFFFFFFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFYFFYFFYFFFFFFYFFYFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFYFFYFFYFFFFFFYFFYFFFFFY',
  'YFFFFFFFFFFFFFFFFFFFFFFFFY',
  'YFFFFFFFFFFFYFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YFFFFFFFFFFFFFFFFFFFFFYYYY',
  'YYYYYYYYYYYYYYYYYYYYYYYYYY',
]
/** 테마 바닥을 덮는 칸: 걷는 대리석 칸 중 카펫·단상·확장 구역·계단 앞·화분 칸을 뺀 곳(그림 gallery.py와 맞춘다) */
const onCarpet = (tx: number, ty: number) => (tx >= 11 && tx <= 13 && ty >= 4 && ty <= 11) || (ty === 12 && tx >= 14 && tx <= 21) || (ty <= 3 && tx >= 9 && tx <= 15)
const covered = (tx: number, ty: number) => onCarpet(tx, ty) || (ty >= 13 && tx <= 20) || (tx >= 22 && ty >= 11) || (ty === 1 && (tx === 1 || tx === 23))
export const HALL2_THEME_FLOOR: readonly { tx: number; ty: number }[] = ROWS.flatMap((row, ty) =>
  [...row].flatMap((ch, tx) => (ch === 'F' && !covered(tx, ty) ? [{ tx, ty }] : [])),
)

export const HALL2 = defineMap('hall2', ROWS, {
  indoor: true,
  onWorldMap: false,
  backdrop: 'hall-gallery',
  // 세계 좌표는 1층과 같은 회관 건물 자리
  world: { tx: 7, ty: 1 },
  fixtures: FIXTURES,
})
