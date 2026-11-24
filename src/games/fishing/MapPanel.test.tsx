import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { DEFAULT_LAYERS, MapPanel, RARITY_NAMES, type MapLayers } from './MapPanel.tsx'
import { conditionLabel } from './Menus.tsx'
import { SPECIES, type AreaId } from './data.ts'
import { SEASON_ANCHOR_MS, conditionsAt, type Season } from './clock.ts'
import { minimapUrl } from './minimap.ts'
import type { View } from './logic.ts'
import { teleportFee } from './teleport.ts'
import type { Facing } from './map.ts'

vi.mock('./minimap.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./minimap.ts')>()
  return { ...orig, minimapUrl: vi.fn(() => 'data:mini'), spotHighlightUrl: vi.fn(() => 'data:hl'), minimapScale: vi.fn(() => 2) }
})
vi.mock('./sprites.ts', () => ({
  spriteDataUrl: vi.fn((name: string, _scale: number, opts?: { silhouette?: boolean }) =>
    `data:${name}${opts?.silhouette ? ':silhouette' : ''}`),
}))

function makeView(over: Partial<View> = {}): View {
  return { gold: 1234, totalEarned: 0, rodTier: 1, bagTier: 1, areas: ['village', 'river', 'forest'], bag: [], dex: {}, legends: [], tackles: [], equipped: [], challenges: {}, pending: null, ...over }
}
const dexOf = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, { count: 1, maxCm: 30 }]))

/** 그 계절·맑은 날의 그 게임 시각(분)이 되는 실제 시각을 찾는다 */
function timeAt(season: Season, gameMinute: number): number {
  const week = 604_800_000
  const idx = ['spring', 'summer', 'autumn', 'winter'].indexOf(season)
  for (let t = SEASON_ANCHOR_MS + idx * week; t < SEASON_ANCHOR_MS + (idx + 1) * week; t += 1000) {
    const c = conditionsAt(t)
    if (c.gameMinute === gameMinute && c.weather === 'sun' && c.season === season) return t
  }
  throw new Error('no time')
}

type Here = { area: AreaId; tx: number; ty: number; facing: Facing }
const VILLAGE_HERE: Here = { area: 'village', tx: 5, ty: 20, facing: 'down' }

function Harness({ view, here, layers0 }: { view: View; here: Here; layers0?: MapLayers }) {
  const [layers, setLayers] = useState<MapLayers>(layers0 ?? DEFAULT_LAYERS)
  return <MapPanel view={view} here={here} now={Date.now} innerWidth={300} layers={layers} onLayers={setLayers} />
}
const mount = (view = makeView(), here = VILLAGE_HERE, layers0?: MapLayers) => render(<Harness view={view} here={here} layers0={layers0} />)
const panel = () => screen.getByRole('region', { name: '지도' })
const tab = (name: RegExp) => within(panel()).getByRole('tab', { name })
const spotMarker = (name: string) => within(screen.getByTestId('fish-map')).getByRole('button', { name: new RegExp(`^${name} 낚시 자리`) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(timeAt('spring', 600))
  vi.mocked(minimapUrl).mockImplementation(() => 'data:mini')
})
afterEach(() => {
  vi.useRealTimers()
})

describe('MapPanel', () => {
  it('처음 탭은 지금 지역, 탭 6개, 잠긴 지역은 "· 잠김"', () => {
    mount()
    const tabs = within(panel()).getAllByRole('tab')
    expect(tabs).toHaveLength(6)
    expect(within(panel()).getByRole('tab', { selected: true })).toHaveTextContent('바닷가 마을')
    expect(tab(/산 호수/)).toHaveTextContent('산 호수 · 잠김')
    expect(screen.getByTestId('fish-map-now')).toHaveTextContent('봄 · 맑음 · 10:00 · 대나무 낚싯대')
  })

  it('기본 레이어: 마을의 길 표시·낚시 자리·현재 위치; 길을 끄면 길 표시만, 낚시 자리를 끄면 자리 표시·칩이 사라진다', () => {
    mount()
    const map = () => within(screen.getByTestId('fish-map'))
    expect(map().getByRole('button', { name: '상점' })).toBeInTheDocument()
    expect(map().getByRole('button', { name: '마을 강으로 가는 길' })).toBeInTheDocument()
    expect(map().getByRole('button', { name: '선착장 · 섬' })).toBeInTheDocument()
    expect(map().getByRole('button', { name: '순간이동기' })).toBeInTheDocument()
    expect(spotMarker('부두')).toBeInTheDocument()
    expect(spotMarker('해안')).toBeInTheDocument()
    expect(map().getByLabelText('현재 위치')).toBeInTheDocument()
    expect(screen.getByTestId('fish-map').querySelector('img.fish-map-img')).toHaveAttribute('src', 'data:mini')

    fireEvent.click(within(panel()).getByRole('button', { name: '길' }))
    expect(map().queryByRole('button', { name: '상점' })).not.toBeInTheDocument()
    expect(map().getByLabelText('현재 위치')).toBeInTheDocument()
    expect(spotMarker('해안')).toBeInTheDocument()

    fireEvent.click(within(panel()).getByRole('button', { name: '낚시 자리' }))
    expect(map().queryByRole('button', { name: /낚시 자리/ })).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('group', { name: '낚시 자리' })).not.toBeInTheDocument()
  })

  it('해안을 누르면 목록: 잡은 망둥어는 이름·조건, 안 잡은 물고기는 실루엣·???·등급만(이름·그림·조건이 어디에도 없다)', () => {
    mount(makeView({ dex: dexOf('goby') }))
    fireEvent.click(spotMarker('해안'))
    const p = panel()
    expect(within(p).getByRole('heading', { name: /^해안 · 지금/ })).toBeInTheDocument()
    expect(within(p).getByText('망둥어')).toBeInTheDocument()
    expect(within(p).getByAltText('망둥어')).toHaveAttribute('src', 'data:fish-goby')
    expect(within(p).getAllByAltText('미발견 물고기').length).toBeGreaterThan(0)
    expect(within(p).getAllByText('???').length).toBeGreaterThan(0)
    expect(within(p).getAllByText(new RegExp(RARITY_NAMES.uncommon)).length).toBeGreaterThan(0)

    const goby = SPECIES.find((s) => s.id === 'goby')!
    const unfound = SPECIES.filter((s) => s.area === 'village' && (!s.spots || s.spots.includes('shore')) && s.id !== 'goby')
    const text = p.textContent ?? ''
    const attrs = [...p.querySelectorAll('*')].flatMap((el) => ['alt', 'aria-label', 'title', 'src'].map((a) => el.getAttribute(a) ?? ''))
    for (const s of unfound) {
      expect(text, s.id).not.toContain(s.name)
      for (const a of attrs) {
        expect(a, s.id).not.toContain(s.name)
        if (a.startsWith(`data:fish-${s.id}`)) expect(a, s.id).toContain(':silhouette')
      }
      const label = conditionLabel(s)
      if (label !== conditionLabel(goby)) expect(text, s.id).not.toContain(label)
    }
  })

  it('전설 칸 테두리는 잡은 뒤에도 남는다(안 잡았을 때도 테두리)', () => {
    const legendItem = () => [...panel().querySelectorAll('li.fish-dex-item')].filter((li) => li.classList.contains('fish-dex-item-legend'))
    const { unmount } = mount()
    fireEvent.click(spotMarker('부두'))
    expect(legendItem()).toHaveLength(1)
    expect(legendItem()[0]).toHaveTextContent('???')
    unmount()
    mount(makeView({ dex: dexOf('grouper'), legends: ['grouper'] }))
    fireEvent.click(spotMarker('부두'))
    expect(legendItem()).toHaveLength(1)
    expect(legendItem()[0]).toHaveTextContent('다금바리')
    expect(legendItem()[0]).toHaveTextContent('전설')
  })

  it('지금 잡히는: 봄 5:50에 숭어(6~19시)는 없고, 게임 시각이 6시를 넘으면 목록·머리줄이 바뀐다', async () => {
    vi.setSystemTime(timeAt('spring', 350))
    mount(makeView({ dex: dexOf('goby', 'mullet', 'mackerel') }))
    fireEvent.click(within(panel()).getByRole('button', { name: '지금 잡히는' }))
    fireEvent.click(spotMarker('해안'))
    expect(within(panel()).getByText('망둥어')).toBeInTheDocument()
    expect(within(panel()).queryByText('숭어')).not.toBeInTheDocument()
    expect(within(panel()).queryByText('고등어')).not.toBeInTheDocument()
    expect(screen.getByTestId('fish-map-now')).toHaveTextContent('05:50')
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000) })
    expect(screen.getByTestId('fish-map-now')).toHaveTextContent('06:00')
    expect(within(panel()).getByText('숭어')).toBeInTheDocument()
  })

  it('지금 + 미발견: 배지가 교집합 수, 0인 자리는 흐리게', () => {
    const shore = SPECIES.filter((s) => s.area === 'village' && !s.spots).map((s) => s.id)
    mount(makeView({ dex: dexOf(...shore) }), VILLAGE_HERE, { ...DEFAULT_LAYERS, now: true, undiscovered: true })
    expect(spotMarker('해안')).toHaveAccessibleName('해안 낚시 자리 0')
    expect(spotMarker('해안')).toHaveClass('fish-map-marker-dim')
  })

  it('강, 산 호수 잠김: 잠긴 문 상세(이름·가격·보유), 버튼은 지도 보기뿐; 열리면 문 대신 북쪽 출구', () => {
    const { unmount } = mount(makeView(), { area: 'river', tx: 30, ty: 25, facing: 'up' })
    fireEvent.click(within(screen.getByTestId('fish-map')).getByRole('button', { name: '잠긴 문 · 무너진 다리 수리' }))
    const detail = panel().querySelector('.fish-map-detail') as HTMLElement
    expect(within(detail).getByRole('heading', { name: '잠긴 문 · 무너진 다리 수리' })).toBeInTheDocument()
    expect(within(detail).getByText('5,000 G')).toBeInTheDocument()
    expect(within(detail).getByText(/보유 1,234 G/)).toBeInTheDocument()
    expect(within(detail).getAllByRole('button').map((b) => b.textContent)).toEqual(['산 호수 지도 보기'])
    unmount()
    mount(makeView({ areas: ['village', 'river', 'forest', 'lake'] }), { area: 'river', tx: 30, ty: 25, facing: 'up' })
    const map = within(screen.getByTestId('fish-map'))
    expect(map.queryByRole('button', { name: /잠긴 문/ })).not.toBeInTheDocument()
    fireEvent.click(map.getByRole('button', { name: '산 호수로 가는 길' }))
    expect(within(panel()).getByText('산 호수로 가는 길 · 북쪽')).toBeInTheDocument()
  })

  it('잠긴 산 호수 탭: 지도 그림 없이 잠김 카드, [마을 강 지도 보기]는 강 탭의 문을 고른다, 목록은 실루엣만', () => {
    mount()
    fireEvent.click(tab(/산 호수/))
    expect(screen.queryByTestId('fish-map')).not.toBeInTheDocument()
    expect(within(panel()).getByText('산 호수는 아직 못 가요')).toBeInTheDocument()
    expect(within(panel()).getByText('5,000 G')).toBeInTheDocument()
    expect(within(panel()).getByText(/마을 강의 잠긴 문 앞에서/)).toBeInTheDocument()
    expect(within(panel()).getAllByAltText('미발견 물고기')).toHaveLength(SPECIES.filter((s) => s.area === 'lake').length)
    fireEvent.click(within(panel()).getByRole('button', { name: '마을 강 지도 보기' }))
    expect(within(panel()).getByRole('tab', { selected: true })).toHaveTextContent('마을 강')
    expect(within(screen.getByTestId('fish-map')).getByRole('button', { name: '잠긴 문 · 무너진 다리 수리' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('잠긴 지역 목록은 등급만: "지금" 칩이 없고, 지금 잡히는 필터를 켜면 비며, 이름·그림·조건이 어디에도 없다', () => {
    mount()
    fireEvent.click(tab(/산 호수/))
    const p = panel()
    expect(within(p).queryByText('지금')).not.toBeInTheDocument()
    expect(within(p).queryByText(/지금은 안 나와요/)).not.toBeInTheDocument()
    const lake = SPECIES.filter((s) => s.area === 'lake')
    const text = p.textContent ?? ''
    const attrs = [...p.querySelectorAll('*')].flatMap((el) => ['alt', 'aria-label', 'title', 'src'].map((a) => el.getAttribute(a) ?? ''))
    for (const s of lake) {
      expect(text, s.id).not.toContain(s.name)
      expect(text, s.id).not.toContain(conditionLabel(s))
      for (const a of attrs) {
        expect(a, s.id).not.toContain(s.name)
        if (a.startsWith(`data:fish-${s.id}`)) expect(a, s.id).toContain(':silhouette')
      }
    }
    fireEvent.click(within(p).getByRole('button', { name: '지금 잡히는' }))
    expect(within(p).queryAllByAltText('미발견 물고기')).toHaveLength(0)
    expect(within(p).getByText('조건에 맞는 물고기가 없어요')).toBeInTheDocument()
  })

  it('레이어를 끄면 그 레이어에서 고른 표시의 상세가 사라진다', () => {
    mount(makeView(), { area: 'river', tx: 30, ty: 25, facing: 'up' })
    const title = () => panel().querySelector('.fish-map-detail-title')
    fireEvent.click(within(screen.getByTestId('fish-map')).getByRole('button', { name: '잠긴 문 · 무너진 다리 수리' }))
    expect(title()).toHaveTextContent('잠긴 문 · 무너진 다리 수리')
    fireEvent.click(within(panel()).getByRole('button', { name: '길' }))
    expect(title()).toHaveTextContent('마을 강')
    expect(within(panel()).queryByText('5,000 G')).not.toBeInTheDocument()
    fireEvent.click(spotMarker('강'))
    expect(title()).toHaveTextContent(/^강 · 지금/)
    fireEvent.click(within(panel()).getByRole('button', { name: '낚시 자리' }))
    expect(title()).toHaveTextContent('마을 강')
    expect(within(panel()).queryByRole('list', { name: '물고기 목록' })).not.toBeInTheDocument()
  })

  it('aria-live는 상세 제목 줄 하나뿐(목록 전체를 읽지 않는다)', () => {
    mount()
    fireEvent.click(spotMarker('해안'))
    const live = panel().querySelectorAll('[aria-live]')
    expect(live).toHaveLength(1)
    expect(live[0]).toHaveClass('fish-map-detail-title')
  })

  it('가장자리 표시는 그림 안쪽으로 묶인다(clamp)', () => {
    mount(makeView(), { area: 'river', tx: 30, ty: 25, facing: 'up' })
    const west = within(screen.getByTestId('fish-map')).getByRole('button', { name: '숲으로 가는 길' })
    expect(west.getAttribute('style')).toMatch(/left:\s*clamp\(14px,/)
    expect(screen.getByLabelText('현재 위치').getAttribute('style')).toMatch(/clamp\(9px,/)
  })

  it('숲에서 섬 탭 → 가는 길, 숲 탭으로 돌아오면 강으로 가는 출구가 강조된다', () => {
    mount(makeView({ areas: ['village', 'river', 'forest', 'island'] }), { area: 'forest', tx: 40, ty: 18, facing: 'right' })
    fireEvent.click(tab(/^섬/))
    expect(within(panel()).getByText('가는 길: 숲 → 마을 강 → 바닷가 마을 → (배) 섬')).toBeInTheDocument()
    fireEvent.click(tab(/^숲/))
    expect(within(screen.getByTestId('fish-map')).getByRole('button', { name: '마을 강으로 가는 길' })).toHaveClass('fish-map-marker-hop')
  })

  it('잠긴 섬으로 가는 길은 선착장까지, 마을 탭에서 선착장이 강조된다', () => {
    mount()
    fireEvent.click(tab(/^섬/))
    fireEvent.click(tab(/바닷가 마을/))
    expect(within(screen.getByTestId('fish-map')).getByRole('button', { name: '선착장 · 섬' })).toHaveClass('fish-map-marker-hop')
  })

  it('지도 그림의 강물 칸을 누르면 강 자리를 고른다', () => {
    mount(makeView(), { area: 'river', tx: 30, ty: 25, facing: 'up' })
    const el = screen.getByTestId('fish-map')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 288, 204))
    fireEvent.click(el, { clientX: 20.5 * 6, clientY: 16.5 * 6 })
    expect(within(panel()).getByRole('heading', { name: /^강 · 지금/ })).toBeInTheDocument()
    expect(el.querySelectorAll('img.fish-map-img')).toHaveLength(2)
  })

  it('축소 그림을 못 만들면(null) 그림 없이 표시만', () => {
    vi.mocked(minimapUrl).mockImplementation(() => null)
    mount()
    expect(screen.getByTestId('fish-map').querySelector('img.fish-map-img')).toBeNull()
    expect(spotMarker('해안')).toBeInTheDocument()
  })

  describe('순간이동기', () => {
    const DONE = { progress: 3, done: true }
    const tp = () => within(screen.getByTestId('fish-map')).getByRole('button', { name: '순간이동기' })
    const detail = () => panel().querySelector('.fish-map-detail') as HTMLElement

    it('꺼짐: 과제 제목·설명·진행, 버튼 없음', () => {
      mount(makeView({ challenges: { 'pier-perfect': { progress: 2, done: false } } }))
      fireEvent.click(tp())
      expect(within(detail()).getByText('순간이동기 · 꺼짐')).toBeInTheDocument()
      expect(within(detail()).getByText('부두의 명수')).toBeInTheDocument()
      expect(within(detail()).getByText('부두에서 완벽하게 3마리 낚기')).toBeInTheDocument()
      expect(within(detail()).getByText('진행 2/3')).toBeInTheDocument()
      expect(within(detail()).queryAllByRole('button')).toHaveLength(0)
    })

    it('challenges가 없는 옛 응답에도 그려지고 꺼짐·진행 0', () => {
      const old = makeView() as Partial<View>
      delete old.challenges
      mount(old as View)
      fireEvent.click(tp())
      expect(within(detail()).getByText('순간이동기 · 꺼짐')).toBeInTheDocument()
      expect(within(detail()).getByText('진행 0/3')).toBeInTheDocument()
    })

    it('켜짐: 지금 지역 이동기도 켜졌으면 요금 줄(teleportFee와 같은 값)', () => {
      mount(makeView({ challenges: { 'pier-perfect': DONE, 'river-rain': { progress: 5, done: true } } }))
      fireEvent.click(tab(/마을 강/))
      fireEvent.click(tp())
      expect(within(detail()).getByText('순간이동기 · 켜짐')).toBeInTheDocument()
      expect(within(detail()).getByText(`바닷가 마을 이동기에서 오면 ${teleportFee('village', 'river').toLocaleString('ko-KR')} G`)).toBeInTheDocument()
      expect(within(detail()).queryAllByRole('button')).toHaveLength(0)
    })

    it('켜졌어도 지금 지역 이동기가 꺼져 있으면 요금 줄 없음', () => {
      mount(makeView({ challenges: { 'river-rain': { progress: 5, done: true } } }))
      fireEvent.click(tab(/마을 강/))
      fireEvent.click(tp())
      expect(within(detail()).getByText('순간이동기 · 켜짐')).toBeInTheDocument()
      expect(within(detail()).queryByText(/이동기에서 오면/)).not.toBeInTheDocument()
    })

    it('가는 길: 두 이동기 모두 켜짐이면 "순간이동기로도 갈 수 있어요"', () => {
      const { unmount } = mount(makeView({ challenges: { 'pier-perfect': DONE, 'forest-variety': DONE } }))
      fireEvent.click(tab(/^숲/))
      expect(within(panel()).getByText(/순간이동기로도 갈 수 있어요/)).toBeInTheDocument()
      unmount()
      mount(makeView({ challenges: { 'forest-variety': DONE } }))
      fireEvent.click(tab(/^숲/))
      expect(within(panel()).queryByText(/순간이동기로도/)).not.toBeInTheDocument()
    })
  })
})
