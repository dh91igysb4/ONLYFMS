// 낚시 5부 M1: 신화 표시(도감·가방·지도 목록)와 신화의 힘(버프) 화면. 합성 신화(testFixtures)로 검사한다.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { BagPanel, DexPanel, ShopPanel } from './Menus.tsx'
import { FishList } from './MapPanel.tsx'
import { spotFish, areaFish } from './atlas.ts'
import { sellPrice, type Fish, type View } from './logic.ts'
import { BUFFS, SPECIES } from './data.ts'
import { DEFAULT_OUTFIT } from './wardrobe.ts'
import { M1_FIXTURE, TMP_MYTH, withTempData } from './testFixtures.ts'
import { PALETTES, PALETTE_IDS } from '../../app/palettes.ts'
import fishingCss from './fishing.css?raw'

vi.mock('./sprites.ts', () => ({
  spriteDataUrl: vi.fn((name: string, _scale: number, opts?: { silhouette?: boolean }) => `data:${name}${opts?.silhouette ? ':silhouette' : ''}`),
}))

const makeView = (over: Partial<View> = {}): View => ({
  gold: 0, totalEarned: 0, rodTier: 5, bagTier: 1, areas: ['village', 'river', 'forest'], bag: [], dex: {}, legends: [], tackles: [], equipped: [], challenges: {}, wardrobe: [], outfit: { ...DEFAULT_OUTFIT }, pending: null, ...over,
})
const BUFF_NAMES = BUFFS.flatMap((b) => [b.name, b.desc])
const noop = () => {}
const cond = { gameMinute: 600, gameDay: 0, season: 'spring' as const, weather: 'sun' as const }

describe('신화 표시', () => {
  withTempData(M1_FIXTURE)

  it('도감: 안 잡은 신화는 이름·그림·조건 없이 "신화"와 먼저 잡을 전설 수만', () => {
    const { container } = render(<DexPanel view={makeView({ legends: ['grouper'] })} currentArea={TMP_MYTH} />)
    const item = within(container).getAllByRole('listitem').find((li) => li.textContent?.includes('먼저 잡을 전설 1/2'))!
    expect(item).toBeDefined()
    expect(item.className).toContain('fish-dex-item-mythic')
    expect(item.textContent).toContain('???')
    expect(item.textContent).toContain('신화')
    expect(container.textContent).not.toContain('시험 신화')
    expect(container.textContent).not.toContain('시험 전설') // 먼저 잡을 전설 이름도 숨김
    expect(within(item).getByRole('img').getAttribute('alt')).toBe('미발견 물고기')
    expect(within(item).getByRole('img').getAttribute('src')).toContain(':silhouette')
    for (const t of BUFF_NAMES) expect(container.innerHTML).not.toContain(t)
  })

  it('도감: 잡은 신화는 이중 테두리·"신화" 배지·버프 이름', () => {
    const view = makeView({ dex: { 'tmp-mythic': { count: 1, maxCm: 420 } }, legends: ['tmp-legend', 'grouper', 'tmp-mythic'], buffs: ['imugi-scale'] })
    const { container } = render(<DexPanel view={view} currentArea={TMP_MYTH} />)
    const item = within(container).getAllByRole('listitem').find((li) => li.textContent?.includes('시험 신화'))!
    expect(item.className).toContain('fish-dex-item-mythic')
    expect(within(item).getByText('신화').className).toContain('fish-dex-mythic')
    expect(item.textContent).toContain('이무기의 비늘')
  })

  it('가방: 신화 칸은 fish-cell-mythic, aria-label "신화 …"; 전설은 그대로', () => {
    const bag: Fish[] = [{ id: 901, origin: 'normal' as const, species: 'tmp-mythic', sizeCm: 400, perfect: false, locked: true }, { id: 902, origin: 'normal' as const, species: 'tmp-legend', sizeCm: 20, perfect: false, locked: true }]
    render(<BagPanel view={makeView({ bag })} atShop={false} busy={false} onEquip={noop} onLock={noop} />)
    const m = screen.getByRole('button', { name: /^신화 시험 신화 400cm/ })
    expect(m.className).toContain('fish-cell-mythic')
    expect(m.className).not.toContain('fish-cell-legend')
    expect(screen.getByRole('button', { name: /^전설 시험 전설 20cm/ }).className).toContain('fish-cell-legend')
  })

  it('지도 목록: 안 잡은 신화 행은 실루엣 + "신화", alt "미발견 물고기"; 잡은 신화 행은 버프 이름', () => {
    const rows = spotFish(TMP_MYTH, 'den', { dex: {}, legends: [], rodTier: 5 }, cond)
    const { container, unmount } = render(<FishList rows={rows} view={makeView()} />)
    const item = within(container).getAllByRole('listitem').find((li) => li.querySelector('img')?.getAttribute('src')?.includes('fish-tmp-mythic'))!
    expect(item.textContent).toContain('신화')
    expect(item.textContent).not.toContain('시험 신화')
    expect(within(item).getByRole('img').getAttribute('alt')).toBe('미발견 물고기')
    for (const t of BUFF_NAMES) expect(container.innerHTML).not.toContain(t)
    unmount()
    const caught = makeView({ dex: { 'tmp-mythic': { count: 1, maxCm: 420 } }, legends: ['tmp-legend', 'grouper', 'tmp-mythic'] })
    const rows2 = spotFish(TMP_MYTH, 'den', { dex: caught.dex, legends: caught.legends, rodTier: 5 }, cond)
    render(<FishList rows={rows2} view={caught} />)
    expect(screen.getByText(/이무기의 비늘/)).toBeInTheDocument()
  })

  it('atlas: 먼저 잡을 전설이 남은 신화는 "지금"이 아니고(이유 needs), 다 잡으면 지금', () => {
    const row = (legends: string[]) => spotFish(TMP_MYTH, 'den', { dex: {}, legends, rodTier: 5 }, cond).find((r) => r.species.id === 'tmp-mythic')!
    expect(row([])).toMatchObject({ now: false, reason: 'needs' })
    expect(row(['tmp-legend', 'grouper'])).toMatchObject({ now: true, reason: null })
    expect(areaFish(TMP_MYTH, { dex: {}, legends: ['grouper'], rodTier: 5 }, cond).find((r) => r.species.id === 'tmp-mythic2')).toMatchObject({ now: true })
  })
})

describe('신화의 힘(버프) 화면', () => {
  it('버프 없음: "신화의 힘 0/3"과 자물쇠 + "???" 셋, 이름·설명은 어디에도(alt·aria-label 포함) 없다', () => {
    const { container } = render(<BagPanel view={makeView()} atShop={false} busy={false} onEquip={noop} onLock={noop} />)
    const group = screen.getByRole('group', { name: '신화의 힘' })
    expect(within(group).getByText('신화의 힘 0/3')).toBeInTheDocument()
    expect(within(group).getAllByText('???')).toHaveLength(3)
    for (const t of BUFF_NAMES) expect(container.innerHTML).not.toContain(t)
  })
  it('옛 서버 응답(buffs 없음)도 0/3', () => {
    const v = makeView()
    delete (v as Partial<View>).buffs
    render(<BagPanel view={v} atShop={false} busy={false} onEquip={noop} onLock={noop} />)
    expect(screen.getByText('신화의 힘 0/3')).toBeInTheDocument()
  })
  it('용왕의 여의주가 있으면 그림·이름·설명, 나머지는 ???', () => {
    render(<BagPanel view={makeView({ buffs: ['dragon-pearl'] })} atShop={false} busy={false} onEquip={noop} onLock={noop} />)
    const group = screen.getByRole('group', { name: '신화의 힘' })
    expect(within(group).getByText('신화의 힘 1/3')).toBeInTheDocument()
    expect(within(group).getByText('용왕의 여의주')).toBeInTheDocument()
    expect(within(group).getByText('물고기를 8% 비싸게 팔아요')).toBeInTheDocument()
    expect(within(group).getAllByText('???')).toHaveLength(2)
    expect(group.querySelector('img[src="data:buff-dragon-pearl"]')).not.toBeNull()
    expect(group.innerHTML).not.toContain('이무기의 비늘')
  })
  it('상점: 용왕의 여의주면 예상가가 sellPrice 합', () => {
    const bag: Fish[] = [{ id: 903, origin: 'normal' as const, species: 'anchovy', sizeCm: 8, perfect: false }, { id: 904, origin: 'normal' as const, species: 'goby', sizeCm: 13, perfect: true }, { id: 905, origin: 'normal' as const, species: 'grouper', sizeCm: 100, perfect: false }]
    const total = bag.reduce((n, f) => n + sellPrice(f, ['dragon-pearl']), 0)
    render(<ShopPanel view={makeView({ bag, buffs: ['dragon-pearl'] })} busy={false} onSell={noop} onBuy={noop} onBuyBag={noop} onBuyTackle={noop} />)
    expect(screen.getByText(new RegExp(`예상 ${total.toLocaleString('ko-KR')} JWD`))).toBeInTheDocument()
    expect(total).toBeGreaterThan(bag.reduce((n, f) => n + sellPrice(f), 0))
  })
  it('팔레트 대비: 모든 팔레트에서 --ink 위 --bg 글자 대비 4.5:1 이상(신화 배지)', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    for (const id of PALETTE_IDS) for (const mode of ['dark', 'light'] as const) {
      const t = PALETTES[id][mode]
      const [hi, lo] = [lum(t.ink), lum(t.bg)].sort((a, b) => b - a)
      expect((hi + 0.05) / (lo + 0.05), `${id}/${mode}`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('SPECIES에 테스트 어종이 남지 않는다', () => {
    expect(SPECIES.some((s) => s.id.startsWith('tmp-'))).toBe(false)
  })
})

describe('신화 테두리 CSS', () => {
  const rule = (sel: string) => fishingCss.match(new RegExp(`(^|\\n)${sel.replace(/[.*]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[2] ?? ''
  it('신화 칸·도감 칸은 강조색 2px · 바탕색 틈 · 강조색 6px의 진짜 이중 테두리, 잠긴 신화는 안쪽에 잉크 한 겹', () => {
    const double = 'inset 0 0 0 2px var(--accent-strong), inset 0 0 0 4px var(--panel), inset 0 0 0 6px var(--accent-strong)'
    expect(rule('.fish-cell-mythic')).toContain(double)
    expect(rule('.fish-dex-item-mythic')).toContain(double)
    expect(rule('.fish-cell-mythic.fish-cell-locked')).toContain(`${double}, inset 0 0 0 7px var(--ink)`)
    // 잠긴 전설(4px 한 띠)과 다르다
    expect(rule('.fish-cell-legend.fish-cell-locked')).not.toContain('var(--panel)')
  })
})
