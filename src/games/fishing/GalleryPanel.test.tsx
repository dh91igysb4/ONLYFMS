// 경제 P2~P4 화면: 전시관 패널과 가방 기증·재료 모드.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { DEFAULT_AREAS } from './data.ts'
import type { Fish, View } from './logic.ts'
import { GalleryPanel } from './GalleryPanel.tsx'
import { BagPanel } from './Menus.tsx'
import { DEFAULT_OUTFIT } from './wardrobe.ts'
import { SPECIAL_IDS, newGallery, type Gallery } from './gallery.ts'

vi.mock('./sprites.ts', () => ({ spriteDataUrl: vi.fn((name: string) => `data:${name}`) }))

function makeView(over: Partial<View> = {}, g: Partial<Gallery> = {}): View {
  return {
    gold: 10_000_000, totalEarned: 0, rodTier: 4, bagTier: 1, areas: [...DEFAULT_AREAS], bag: [], dex: {}, legends: [], tackles: [], equipped: [],
    challenges: {}, wardrobe: [], outfit: { ...DEFAULT_OUTFIT }, pending: null, ...over, gallery: { ...newGallery(), ...g },
  }
}
const fish = (id: number, species: string, extra: Partial<Fish> = {}): Fish => ({ id, origin: 'normal', species, sizeCm: 12, perfect: false, ...extra })
const panel = (view: View) => {
  const onAct = vi.fn()
  render(<GalleryPanel view={view} busy={false} onAct={onAct} />)
  return onAct
}

describe('GalleryPanel', () => {
  test('옛 서버(gallery 없음)도 그린다: 13종 모두 ??? , 재료·포션은 숨김', () => {
    render(<GalleryPanel view={{ ...makeView(), gallery: undefined }} busy={false} onAct={() => {}} />)
    expect(screen.getAllByText('???')).toHaveLength(13)
    expect(screen.queryByRole('list', { name: '포션' })).toBeNull()
  })
  test('기증 2마리가 찬 전설만 전시 버튼이 눌리고, 전시료를 보낸다', () => {
    const onAct = panel(makeView({ legends: ['grouper', 'golden-mandarin'] }, { donated: { grouper: 2, 'golden-mandarin': 1 } }))
    expect((screen.getByRole('button', { name: '황금 쏘가리 전시' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '다금바리 전시' }))
    expect(onAct).toHaveBeenCalledWith({ type: 'exhibit', species: 'grouper', price: 100_000 }, expect.any(String))
  })
  test('첫 신화 전시 뒤: 포션·확장이 보이고, 재료가 있으면 행운 포션·1단계 확장을 보낸다', () => {
    const mats = { village: 9, river: 9, forest: 9, lake: 9, cave: 9, tideflat: 9 }
    const onAct = panel(makeView({ legends: ['imugi'] }, { exhibits: ['imugi'], mats, potions: { luck: 125_000 } }))
    expect(screen.getByText(/행운 포션 · 남은 3분/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '행운 포션 만들어 마시기' }))
    expect(onAct).toHaveBeenLastCalledWith({ type: 'brew', potion: 'luck', price: 6000 }, expect.any(String))
    fireEvent.click(screen.getByRole('button', { name: '전시관 1단계 확장' }))
    expect(onAct).toHaveBeenLastCalledWith({ type: 'expand', stage: 1, price: 90_000 }, expect.any(String))
    expect(screen.queryByRole('list', { name: '완료 후 목표' })).toBeNull()
  })
  test('13종 전시 뒤: 3병 만들기·마시기, 완료 후 목표 사기, 산 배경 테마만 고를 수 있다', () => {
    const onAct = panel(makeView({ legends: [...SPECIAL_IDS] }, { exhibits: [...SPECIAL_IDS], mats: { village: 99, tideflat: 99, cave: 99 }, stock: { gold: 2 }, projects: ['sea-bg'] }))
    fireEvent.click(screen.getByRole('button', { name: '금전 포션 3병 만들기' }))
    expect(onAct).toHaveBeenLastCalledWith({ type: 'brew', potion: 'gold', price: 4500, adv: true }, expect.any(String))
    fireEvent.click(screen.getByRole('button', { name: '금전 포션 마시기' }))
    expect(onAct).toHaveBeenLastCalledWith({ type: 'drink', potion: 'gold' }, expect.any(String))
    fireEvent.click(screen.getByRole('button', { name: '바다 바닥 사기' }))
    expect(onAct).toHaveBeenLastCalledWith({ type: 'buyProject', id: 'sea-floor', price: 160_000 }, expect.any(String))
    const themes = screen.getByRole('radiogroup', { name: '테마' })
    expect(within(themes).getAllByRole('radio').map((b) => b.textContent)).toEqual(['기본', '바다'])
  })
})

describe('BagPanel 기증·재료 모드', () => {
  test('기증: 재포획 개체만 눌리고 onDonate(칸)', () => {
    const onDonate = vi.fn()
    const view = makeView({ bag: [fish(1, 'grouper', { origin: 'first', sizeCm: 100 }), fish(2, 'grouper', { origin: 'recatch', sizeCm: 100 })] })
    render(<BagPanel view={view} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} onDonate={onDonate} />)
    fireEvent.click(screen.getByRole('button', { name: '기증' }))
    const cells = screen.getAllByRole('button', { name: /다금바리/ })
    expect((cells[0] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(cells[1])
    expect(onDonate).toHaveBeenCalledWith(1)
  })
  test('재료: 일반 물고기를 골라 onExtract(칸)', () => {
    const onExtract = vi.fn()
    render(<BagPanel view={makeView({ bag: [fish(1, 'anchovy'), fish(2, 'goby')] })} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} onExtract={onExtract} />)
    fireEvent.click(screen.getByRole('button', { name: '재료' }))
    fireEvent.click(screen.getByRole('button', { name: '잠기지 않은 것 모두 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '재료 만들기 확인' }))
    expect(onExtract).toHaveBeenCalledWith([0, 1])
  })
})
