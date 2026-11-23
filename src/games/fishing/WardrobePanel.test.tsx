import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { DEFAULT_AREAS } from './data.ts'
import type { View } from './logic.ts'
import { WardrobePanel } from './WardrobePanel.tsx'
import { DEFAULT_OUTFIT } from './wardrobe.ts'

function makeView(over: Partial<View> = {}): View {
  return {
    gold: 10_000, totalEarned: 0, rodTier: 1, bagTier: 1, areas: [...DEFAULT_AREAS], bag: [], dex: {}, legends: [], tackles: [], equipped: [],
    challenges: {}, wardrobe: [], outfit: { ...DEFAULT_OUTFIT }, pending: null, ...over,
  }
}
const setup = (over: Partial<View> = {}, atShop = true, busy = false) => {
  const onWear = vi.fn()
  const onBuy = vi.fn()
  render(<WardrobePanel view={makeView(over)} atShop={atShop} busy={busy} onWear={onWear} onBuy={onBuy} />)
  return { onWear, onBuy }
}
const row = (name: string) => screen.getByRole('button', { name: `${name} 입혀 보기` }).closest('li') as HTMLElement

describe('WardrobePanel', () => {
  test('부위 탭 6개, 처음은 모자, 입는 중 표시', () => {
    setup()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['모자', '상의', '하의', '머리 모양', '머리 색', '낚싯대'])
    expect(screen.getByRole('tab', { name: '모자' }).getAttribute('aria-selected')).toBe('true')
    expect(within(row('청록 비니')).getByText('입는 중')).toBeTruthy()
  })

  test('가진 무료 품목은 입기', () => {
    const { onWear } = setup()
    fireEvent.click(screen.getByRole('button', { name: '모자 없음 입기' }))
    expect(onWear).toHaveBeenCalledWith('hat', 'none')
  })

  test('상점 품목: 상점 앞이고 골드가 되면 사기, 아니면 꺼짐', () => {
    const { onBuy } = setup({ gold: 10_000 })
    fireEvent.click(screen.getByRole('button', { name: '남색 야구모자 사기' }))
    expect(onBuy).toHaveBeenCalledWith('hat', 'cap')
    expect((screen.getByRole('button', { name: '밀짚모자 사기' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(row('밀짚모자')).getByText('골드가 부족해요')).toBeTruthy()
  })

  test('상점 밖이면 사기가 꺼지고 어디서 사는지 알려 준다', () => {
    setup({ gold: 1_000_000 }, false)
    expect((screen.getByRole('button', { name: '남색 야구모자 사기' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/옷은 상점에서 살 수 있어요/)).toBeTruthy()
  })

  test('업적 품목은 조건 문구만, 채우면 입기', () => {
    setup()
    expect(within(row('전설의 왕관')).getByText('전설 물고기 잡기')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '전설의 왕관 사기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '전설의 왕관 입기' })).toBeNull()
  })

  test('업적을 채우면 입을 수 있다', () => {
    const { onWear } = setup({ legends: ['grouper'] })
    fireEvent.click(screen.getByRole('button', { name: '전설의 왕관 입기' }))
    expect(onWear).toHaveBeenCalledWith('hat', 'crown')
  })

  test('산 옷은 보유, 입고 있는 옷은 입는 중', () => {
    setup({ wardrobe: ['top:kit-stripes', 'top:kit-red'], outfit: { ...DEFAULT_OUTFIT, top: 'kit-red' } })
    fireEvent.click(screen.getByRole('tab', { name: '상의' }))
    expect(within(row('흑백 줄무늬 유니폼')).getByText('보유')).toBeTruthy()
    expect(within(row('새빨간 유니폼')).getByText('입는 중')).toBeTruthy()
    expect(screen.getByRole('button', { name: '흑백 줄무늬 유니폼 입기' })).toBeTruthy()
    // 유니폼 여섯 벌이 색 이름으로 보인다
    for (const n of ['클라렛·하늘 유니폼', '새빨간 유니폼', '빨강·흰 깃 유니폼', '흰·남색 유니폼', '로열 블루 유니폼', '흑백 줄무늬 유니폼']) expect(row(n)).toBeTruthy()
  })

  test('품목을 누르면 미리보기에 입혀 보고, 돌려 보기로 방향이 바뀐다', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '밀짚모자 입혀 보기' }))
    expect(screen.getByText('입혀 보는 중')).toBeTruthy()
    expect(screen.getByRole('img', { name: '캐릭터 미리보기 (앞)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '돌려 보기' }))
    expect(screen.getByRole('img', { name: '캐릭터 미리보기 (오른쪽)' })).toBeTruthy()
  })

  test('바쁠 때는 입기·사기가 꺼진다', () => {
    setup({}, true, true)
    expect((screen.getByRole('button', { name: '모자 없음 입기' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '남색 야구모자 사기' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('옛 서버 응답(옷장 필드 없음)에도 기본 옷차림으로 그린다', () => {
    const v = makeView() as Partial<View>
    delete v.wardrobe
    delete v.outfit
    render(<WardrobePanel view={v as View} atShop busy={false} onWear={() => {}} onBuy={() => {}} />)
    expect(within(row('청록 비니')).getByText('입는 중')).toBeTruthy()
  })
})
