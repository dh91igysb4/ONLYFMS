import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { bagSize, DEFAULT_AREAS } from './data.ts'
import { sellPrice, type Fish, type View } from './logic.ts'
import { FridgePanel } from './FridgePanel.tsx'
import { DEFAULT_OUTFIT } from './wardrobe.ts'

vi.mock('./sprites.ts', async (orig) => ({ ...(await orig<typeof import('./sprites.ts')>()), spriteDataUrl: () => 'data:x' }))

const mk = (sizeCm: number): Fish => ({ id: 901, origin: 'normal' as const, species: 'mackerel', sizeCm, perfect: false })
function makeView(over: Partial<View> = {}): View {
  return {
    gold: 0, totalEarned: 0, rodTier: 1, bagTier: 1, areas: [...DEFAULT_AREAS], bag: [], dex: {}, legends: [], tackles: [], equipped: [],
    challenges: {}, wardrobe: [], outfit: { ...DEFAULT_OUTFIT }, pending: null, ...over,
  }
}
const setup = (over: Partial<View> = {}, busy = false) => {
  const onStore = vi.fn()
  const onTakeOut = vi.fn()
  render(<FridgePanel view={makeView(over)} busy={busy} onStore={onStore} onTakeOut={onTakeOut} />)
  return { onStore, onTakeOut }
}

describe('FridgePanel', () => {
  test('넣기·꺼내기는 그 칸 index로', () => {
    const { onStore, onTakeOut } = setup({ bag: [mk(30), mk(31)], fridge: [mk(50)] })
    expect(screen.getByText('냉장고 1/15')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^고등어 31cm 넣기/ }))
    expect(onStore).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: /^고등어 50cm 꺼내기/ }))
    expect(onTakeOut).toHaveBeenCalledWith(0)
  })
  test('냉장고가 가득이면 넣기가 꺼지고 안내, 가방이 가득이면 꺼내기가 꺼진다', () => {
    setup({ bag: Array.from({ length: bagSize(1) }, (_, i) => mk(10 + i)), fridge: Array.from({ length: 15 }, (_, i) => mk(40 + i)) })
    expect(screen.getByText('냉장고가 가득 찼어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^고등어 10cm 넣기/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^고등어 40cm 꺼내기/ })).toBeDisabled()
  })
  test('옛 서버 응답(fridge 없음)이면 빈 냉장고', () => {
    setup({ bag: [mk(30)] })
    expect(screen.getByText('냉장고 0/15')).toBeInTheDocument()
    expect(screen.getByText('냉장고가 비어 있어요')).toBeInTheDocument()
  })
  test('낚는 중·요청 중에는 버튼이 꺼진다', () => {
    setup({ bag: [mk(30)], fridge: [mk(50)] }, true)
    expect(screen.getByRole('button', { name: /^고등어 30cm 넣기/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^고등어 50cm 꺼내기/ })).toBeDisabled()
  })
  test('가방·냉장고 칸에 판매 예상가(sellPrice, 버프 포함)를 보이고 aria-label에도 넣는다', () => {
    const fish = mk(30)
    const big = mk(500)
    setup({ bag: [fish], fridge: [big], buffs: ['dragon-pearl'] })
    const p = sellPrice(fish, ['dragon-pearl']).toLocaleString('ko-KR')
    const q = sellPrice(big, ['dragon-pearl']).toLocaleString('ko-KR')
    expect(screen.getByRole('button', { name: `고등어 30cm 넣기, 예상 ${p} G` })).toHaveTextContent(`${p} G`)
    expect(screen.getByRole('button', { name: `고등어 500cm 꺼내기, 예상 ${q} G` })).toHaveTextContent(`${q} G`)
  })
  test('모르는 어종이면 가격을 보이지 않는다', () => {
    setup({ bag: [{ ...mk(30), species: 'no-such-fish' }] })
    const b = screen.getByRole('button', { name: 'no-such-fish 30cm 넣기' })
    expect(b).not.toHaveTextContent('G')
  })
})
