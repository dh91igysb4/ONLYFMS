// 섬 시설 외형(경제 설계 r4 §6.4 완료 후 목표). 순수 모듈.
// 시설은 수입 효과가 없는 외형이라 걷기·자원 칸을 바꾸지 않게 섬 둘레 바다 칸에만 그린다(scene.ts drawFacilities).
// 자리는 섬 모양마다 고정: 칸과 둘레 2칸이 모두 바다(~)이고 3칸 안에 땅이 있는 곳(facility.test.ts가 확인).
import type { IsleLayoutId } from './data.ts'
import { FACILITIES } from './gallery.ts'

export type FacilityId = (typeof FACILITIES)[number]['id']
/** 그림 크기(칸). 등대 탑은 위로 더 솟는다 */
export const FACILITY_SIZE: Readonly<Record<FacilityId, { w: number; h: number }>> = {
  lighthouse: { w: 3, h: 3 },
  spring: { w: 4, h: 3 },
  observatory: { w: 4, h: 3 },
}
/** 섬 모양별 시설 자리(왼쪽 위 칸) */
export const FACILITY_SPOTS: Readonly<Record<IsleLayoutId, Readonly<Record<FacilityId, { tx: number; ty: number }>>>> = {
  crescent: { lighthouse: { tx: 3, ty: 18 }, spring: { tx: 27, ty: 10 }, observatory: { tx: 35, ty: 30 } },
  twin: { lighthouse: { tx: 4, ty: 22 }, spring: { tx: 41, ty: 12 }, observatory: { tx: 38, ty: 30 } },
}
const IDS: readonly FacilityId[] = FACILITIES.map((f) => f.id)
export const isFacilityId = (v: unknown): v is FacilityId => typeof v === 'string' && (IDS as readonly string[]).includes(v)
/** 산 목표 목록에서 시설만(FACILITIES 순서) */
export function ownedFacilities(projects: readonly string[]): FacilityId[] {
  return IDS.filter((id) => projects.includes(id))
}
/** 그릴 시설: 섬 모양의 자리 + 가진 시설 */
export function facilityScene(layout: IsleLayoutId, owned: readonly unknown[]): { id: FacilityId; tx: number; ty: number }[] {
  return IDS.filter((id) => owned.includes(id)).map((id) => ({ id, ...FACILITY_SPOTS[layout][id] }))
}
