// 경제 P1 화면: 미끼·연구 영역과 가방 어분 모드, 재포획 가격 표시.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { DEFAULT_AREAS } from './data.ts'
import type { Fish, View } from './logic.ts'
import { EconSection } from './EconPanel.tsx'
import { BagPanel } from './Menus.tsx'
import { DEFAULT_OUTFIT } from './wardrobe.ts'
import { newEcon } from './research.ts'

vi.mock('./sprites.ts', () => ({ spriteDataUrl: vi.fn((name: string) => `data:${name}`) }))

function makeView(over: Partial<View> = {}): View {
  return {
    gold: 100_000, totalEarned: 0, rodTier: 3, bagTier: 1, areas: [...DEFAULT_AREAS], bag: [], dex: {}, legends: [], tackles: [], equipped: [],
    challenges: {}, wardrobe: [], outfit: { ...DEFAULT_OUTFIT }, pending: null, ...over,
  }
}
const fish = (id: number, species: string, extra: Partial<Fish> = {}): Fish => ({ id, origin: 'normal', species, sizeCm: 12, perfect: false, ...extra })
const econ = (view: View, research = true, selected = null as Parameters<typeof EconSection>[0]['selected']) => {
  const on = { onSelect: vi.fn(), onMake: vi.fn(), onLicense: vi.fn(), onAutoMeal: vi.fn() }
  render(<EconSection view={view} busy={false} research={research} selected={selected} {...on} />)
  return on
}

describe('EconSection', () => {
  test('옛 서버(econ 없음)는 빈 econ으로: 어분 0, 만들기 막힘', () => {
    econ(makeView())
    expect(screen.getByText(/어분 0개/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '집어 미끼 만들기' }) as HTMLButtonElement).disabled).toBe(true)
  })
  test('어분이 있으면 집어 미끼 만들기 → onMake(attractor)', () => {
    const on = econ(makeView({ econ: { ...newEcon(), meal: 2 } }))
    fireEvent.click(screen.getByRole('button', { name: '집어 미끼 만들기' }))
    expect(on.onMake).toHaveBeenCalledWith('attractor')
  })
  test('최대로 만들기: 어분·골드로 만들 수 있는 만큼 → onMake(attractor, n), 개수와 총액을 보여 준다', () => {
    const on = econ(makeView({ gold: 120, econ: { ...newEcon(), meal: 10 } }))
    const max = screen.getByRole('button', { name: '집어 미끼 최대 2개 만들기' })
    expect(max.textContent).toContain('최대 2개')
    expect(screen.getByText(/2개 · 100 JWD \+ 어분 2/)).toBeTruthy()
    fireEvent.click(max)
    expect(on.onMake).toHaveBeenCalledWith('attractor', 2)
  })
  test('최대가 1개 이하면 최대로 만들기 버튼은 막힌다(만들기 버튼과 같다)', () => {
    econ(makeView({ gold: 1000, econ: { ...newEcon(), meal: 1 } }))
    expect((screen.getByRole('button', { name: /집어 미끼 최대 .*만들기/ }) as HTMLButtonElement).disabled).toBe(true)
  })
  test('자동 어분: 꺼져 있으면 꺼짐, 기준을 넣고 저장하면 onAutoMeal(값)', () => {
    const on = econ(makeView())
    const box = screen.getByRole('group', { name: '자동 어분' })
    expect(box.textContent).toContain('꺼짐')
    const input = within(box).getByRole('spinbutton', { name: '자동 어분 기준 판매가' })
    const save = within(box).getByRole('button', { name: '저장' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '0' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '40' } })
    fireEvent.click(save)
    expect(on.onAutoMeal).toHaveBeenCalledWith(40)
    expect(within(box).queryByRole('button', { name: '끄기' })).toBeNull()
  })
  test('자동 어분이 켜져 있으면 기준을 보여 주고 끄기 → onAutoMeal(null)', () => {
    const on = econ(makeView({ econ: { ...newEcon(), autoMeal: 30 } }))
    const box = screen.getByRole('group', { name: '자동 어분' })
    expect(box.textContent).toContain('30 JWD 이하')
    expect((within(box).getByRole('spinbutton') as HTMLInputElement).value).toBe('30')
    fireEvent.click(within(box).getByRole('button', { name: '끄기' }))
    expect(on.onAutoMeal).toHaveBeenCalledWith(null)
  })
  test('연구 해금: 전설 발견 전에는 막히고, 발견 뒤 누르면 onLicense', () => {
    econ(makeView())
    expect((screen.getByRole('button', { name: '해금' }) as HTMLButtonElement).disabled).toBe(true)
    document.body.innerHTML = ''
    const on = econ(makeView({ legends: ['grouper'] }))
    fireEvent.click(screen.getByRole('button', { name: '해금' }))
    expect(on.onLicense).toHaveBeenCalled()
  })
  test('해금 뒤 발견한 전설이 대상 목록에 보이고, 보장까지 남은 횟수와 고르기', () => {
    const on = econ(makeView({ legends: ['grouper'], econ: { ...newEcon(), license: true, baits: { attractor: 0, legend: 1, mythic: 0 }, pity: { grouper: 12 } } }))
    const list = screen.getByRole('list', { name: '전설 미끼 대상' })
    expect(within(list).getByText(/보장까지 38번/)).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: '다금바리 연구' }))
    expect(on.onSelect).toHaveBeenCalledWith({ bait: 'legend', target: 'grouper' })
  })
  test('research 플래그가 꺼져 있으면 해금·전설·신화 미끼를 보이지 않는다', () => {
    econ(makeView({ legends: ['grouper'] }), false)
    expect(screen.queryByRole('button', { name: '해금' })).toBeNull()
    expect(screen.queryByRole('button', { name: '전설 미끼 만들기' })).toBeNull()
  })
})

describe('BagPanel 어분 모드', () => {
  test('onGrind가 있으면 어분 모드: 일반 물고기만 고를 수 있고 확인하면 onGrind(칸)', () => {
    const onGrind = vi.fn()
    const view = makeView({ bag: [fish(1, 'anchovy'), fish(2, 'grouper', { origin: 'first', locked: true }), fish(3, 'goby')] })
    render(<BagPanel view={view} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} onGrind={onGrind} />)
    fireEvent.click(screen.getByRole('button', { name: '어분' }))
    expect((screen.getByRole('button', { name: /전설 다금바리 .*어분/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '잠기지 않은 것 모두 선택' }))
    expect(screen.getByText('2마리 → 어분 2개')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '어분 만들기 확인' }))
    expect(onGrind).toHaveBeenCalledWith([0, 2])
  })
  test('onGrind가 없으면(플래그 꺼짐) 어분 모드가 없다', () => {
    render(<BagPanel view={makeView({ bag: [fish(1, 'anchovy')] })} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} onBrag={() => {}} />)
    expect(screen.queryByRole('button', { name: '어분' })).toBeNull()
  })
  test('재포획 개체는 50% 가격으로 보이고 이름에 재포획이 붙는다', () => {
    const view = makeView({ bag: [fish(1, 'grouper', { origin: 'first', sizeCm: 100 }), fish(2, 'grouper', { origin: 'recatch', sizeCm: 100 })] })
    render(<BagPanel view={view} atShop={false} busy={false} onEquip={() => {}} onLock={() => {}} />)
    const cells = screen.getAllByRole('button', { name: /다금바리/ })
    const price = (el: HTMLElement) => Number((el.querySelector('.fish-cell-price')?.textContent ?? '').replace(/[^0-9]/g, ''))
    expect(price(cells[1])).toBe(Math.round(price(cells[0]) / 2))
    expect(cells[1].getAttribute('aria-label')).toMatch(/재포획/)
  })
})
