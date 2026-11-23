// 낚시 메뉴(가방·상점·도감). 값과 규칙은 서버 view를 그대로 보여 주고, 행동은 콜백으로만 올린다.
import { useState } from 'react'
import { AREAS, areaHasSpecies, BAGS, bagSize, RODS, SPECIES, type AreaId, type Species } from './data.ts'
import { SEASON_NAMES } from './clock.ts'
import { price, type View } from './logic.ts'
import { spriteDataUrl } from './sprites.ts'

const ICON_SCALE = 2
const gold = (n: number) => `${n.toLocaleString('ko-KR')} G`
const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id

/** atShop: 상점 문 앞에 서 있는가. 아니면 어디서 팔 수 있는지 알려 준다. */
export function BagPanel({ view, atShop }: { view: View; atShop: boolean }) {
  const cells = Array.from({ length: bagSize(view.bagTier) }, (_, i) => view.bag[i] ?? null)
  return (
    <section className="fish-panel-body" aria-label="가방">
      <p className="muted">
        {view.bag.length}/{bagSize(view.bagTier)}칸
      </p>
      {!atShop && <p className="fish-shop-note">상점에서 팔 수 있어요</p>}
      <ul className="fish-bag">
        {cells.map((f, i) =>
          f ? (
            <li key={i} className="fish-cell">
              <img src={spriteDataUrl(`fish-${f.species}`, ICON_SCALE)} alt={speciesName(f.species)} />
              <span className="fish-cell-size">{f.sizeCm}cm</span>
              <span className="fish-cell-price">{gold(price(f.species, f.sizeCm, f.perfect))}</span>
            </li>
          ) : (
            <li key={i} className="fish-cell fish-cell-empty" aria-hidden="true" />
          ),
        )}
      </ul>
    </section>
  )
}

type ShopProps = { view: View; busy: boolean; onSell(): void; onBuy(tier: number): void; onBuyBag(tier: number): void }

export function ShopPanel({ view, busy, onSell, onBuy, onBuyBag }: ShopProps) {
  const bagValue = view.bag.reduce((sum, f) => sum + price(f.species, f.sizeCm, f.perfect), 0)
  const top = RODS[RODS.length - 1].tier
  const topBag = BAGS[BAGS.length - 1].tier
  return (
    <section className="fish-panel-body" aria-label="상점">
      <div className="fish-shop-sell">
        <p className="muted">
          가방 {view.bag.length}마리 · 예상 {gold(bagValue)}
        </p>
        <button type="button" className="btn btn-primary" disabled={busy || view.bag.length === 0} onClick={onSell}>
          전부 팔기
        </button>
      </div>
      <h3 className="fish-panel-sub">낚싯대</h3>
      {view.rodTier >= top && <p className="fish-shop-note">최고 단계예요</p>}
      <ul className="fish-rods" aria-label="낚싯대 목록">
        {RODS.map((rod) => {
          const owned = rod.tier <= view.rodTier
          const next = rod.tier === view.rodTier + 1
          const short = view.gold < rod.price
          return (
            <li key={rod.tier} className={`fish-rod${owned ? ' fish-rod-owned' : ''}`}>
              <img src={spriteDataUrl(`rod-${rod.tier}`, ICON_SCALE)} alt="" />
              <div className="fish-rod-info">
                <strong>{rod.name}</strong>
                <span className="muted">{rod.price === 0 ? '기본' : gold(rod.price)}</span>
                {owned && <span className="fish-rod-state">{rod.tier === view.rodTier ? '사용 중' : '보유'}</span>}
                {next && short && <span className="fish-shop-note">골드가 부족해요</span>}
                {!owned && !next && <span className="muted">이전 단계를 먼저 사야 해요</span>}
              </div>
              {next && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy || short}
                  onClick={() => onBuy(rod.tier)}
                >
                  구매
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <h3 className="fish-panel-sub">가방</h3>
      {view.bagTier >= topBag && <p className="fish-shop-note">최고 단계예요</p>}
      <ul className="fish-rods" aria-label="가방 목록">
        {BAGS.map((bag) => {
          const owned = bag.tier <= view.bagTier
          const next = bag.tier === view.bagTier + 1
          const short = view.gold < bag.price
          const name = `${bag.size}칸 가방`
          return (
            <li key={bag.tier} className={`fish-rod${owned ? ' fish-rod-owned' : ''}`}>
              <div className="fish-rod-info">
                <strong>{name}</strong>
                <span className="muted">{bag.price === 0 ? '기본' : gold(bag.price)}</span>
                {owned && <span className="fish-rod-state">{bag.tier === view.bagTier ? '사용 중' : '보유'}</span>}
                {next && short && <span className="fish-shop-note">골드가 부족해요</span>}
                {!owned && !next && <span className="muted">이전 단계를 먼저 사야 해요</span>}
              </div>
              {next && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  aria-label={`${name} 구매`}
                  disabled={busy || short}
                  onClick={() => onBuyBag(bag.tier)}
                >
                  구매
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 낚시 자리 이름. 모르는 자리는 id 그대로 보인다. */
const SPOT_NAMES: Record<string, string> = { pier: '부두', shore: '해안', river: '강', pond: '연못', waterfall: '폭포' }

/** 도감에 보일 출현 조건: 자리(spots가 있는 어종) · 계절 · 시간 · 날씨 */
export function conditionLabel(s: Species): string {
  const parts: string[] = []
  if (s.spots) parts.push(s.spots.map((x) => SPOT_NAMES[x] ?? x).join(' · '))
  parts.push(s.seasons ? s.seasons.map((x) => SEASON_NAMES[x]).join(' · ') : '사계절')
  if (s.hours) parts.push(`${s.hours[0]}~${s.hours[1]}시`)
  if (s.weather) parts.push(s.weather === 'rain' ? '비' : '맑음')
  return parts.join(' · ')
}

/** currentArea: 처음 열 탭. 어종이 없는 지역이면 첫 탭으로 연다. */
export function DexPanel({ view, currentArea }: { view: View; currentArea?: AreaId }) {
  const tabs = AREAS.filter((a) => areaHasSpecies(a.id))
  const [picked, setPicked] = useState<AreaId | undefined>(currentArea)
  const active = tabs.find((a) => a.id === picked) ?? tabs[0]
  const found = SPECIES.filter((s) => view.dex[s.id]).length
  const inArea = (id: AreaId) => SPECIES.filter((s) => s.area === id)
  return (
    <section className="fish-panel-body" aria-label="도감">
      <p className="muted">
        {found}/{SPECIES.length}종
      </p>
      <div className="fish-dex-tabs" role="tablist" aria-label="지역">
        {tabs.map((a) => {
          const list = inArea(a.id)
          const on = a.id === active.id
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`fish-dex-tab${on ? ' fish-dex-tab-on' : ''}`}
              onClick={() => setPicked(a.id)}
            >
              {a.name} {list.filter((s) => view.dex[s.id]).length}/{list.length}
            </button>
          )
        })}
      </div>
      <ul className="fish-dex">
        {inArea(active.id).map((s) => {
          const entry = view.dex[s.id]
          return (
            <li key={s.id} className={`fish-dex-item${s.legend && !entry ? ' fish-dex-item-legend' : ''}`}>
              <img
                src={spriteDataUrl(`fish-${s.id}`, ICON_SCALE, { silhouette: !entry })}
                alt={entry ? s.name : '미발견 물고기'}
              />
              {entry ? (
                <>
                  <span className="fish-dex-info">
                    <strong>
                      {s.name}
                      {s.legend && <span className="fish-dex-legend">전설</span>}
                    </strong>
                    <span className="muted">
                      {entry.count}마리 · 최대 {entry.maxCm}cm
                    </span>
                    <span className="muted">{conditionLabel(s)}</span>
                  </span>
                </>
              ) : (
                <strong className="muted">???</strong>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
