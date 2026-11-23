// 낚시 메뉴(가방·상점·도감·지역 해금). 값과 규칙은 서버 view를 그대로 보여 주고, 행동은 콜백으로만 올린다.
import { useState } from 'react'
import { AREAS, areaHasSpecies, BAGS, bagSize, RODS, SPECIES, TACKLES, tackleSlots, UNLOCKS, type AreaId, type Species, type TackleId } from './data.ts'
import { SEASON_NAMES } from './clock.ts'
import { price, type View } from './logic.ts'
import { spriteDataUrl } from './sprites.ts'

const ICON_SCALE = 2
const gold = (n: number) => `${n.toLocaleString('ko-KR')} G`
const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id

type BagProps = {
  view: View
  atShop: boolean
  busy: boolean
  onEquip(ids: TackleId[]): void
  onLock(index: number, locked: boolean): void
}

/** atShop: 상점 문 앞에 서 있는가. 아니면 어디서 팔 수 있는지 알려 준다. 칸을 누르면 잠금을 뒤집는다. */
export function BagPanel({ view, atShop, busy, onEquip, onLock }: BagProps) {
  const cells = Array.from({ length: bagSize(view.bagTier) }, (_, i) => view.bag[i] ?? null)
  const slots = tackleSlots(view.rodTier)
  const fishing = view.pending !== null
  const locked = busy || fishing
  // 옛 서버 응답(찌 필드 없음)에도 죽지 않게 빈 목록으로 읽는다
  const owned = view.tackles ?? []
  const equipped = view.equipped ?? []
  const full = equipped.length >= slots
  const toggle = (id: TackleId) => onEquip(equipped.includes(id) ? equipped.filter((x) => x !== id) : [...equipped, id])
  return (
    <section className="fish-panel-body" aria-label="가방">
      {(owned.length > 0 || slots > 0) && (
        <div className="fish-gear" role="group" aria-label="장비">
          <h3 className="fish-panel-sub">장비</h3>
          {fishing && <p className="fish-shop-note">낚시 중에는 바꿀 수 없어요</p>}
          {slots === 0 && <p className="muted">카본 낚싯대부터 낄 수 있어요</p>}
          <ul className="fish-slots" aria-label="낀 찌">
            {Array.from({ length: slots }, (_, i) => {
              const id = equipped[i]
              return (
                <li key={i} data-testid="fish-slot" className={`fish-slot${id ? '' : ' fish-slot-empty'}`}>
                  {id && <img src={spriteDataUrl(`tackle-${id}`, ICON_SCALE)} alt="" />}
                </li>
              )
            })}
          </ul>
          <ul className="fish-rods" aria-label="보유 찌">
            {TACKLES.filter((t) => owned.includes(t.id)).map((t) => {
              const on = equipped.includes(t.id)
              return (
                <li key={t.id} className={`fish-rod${on ? ' fish-rod-owned' : ''}`}>
                  <img src={spriteDataUrl(`tackle-${t.id}`, ICON_SCALE)} alt="" />
                  <div className="fish-rod-info">
                    <strong>{t.name}</strong>
                    <span className="muted">{t.desc}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    aria-label={t.name}
                    aria-pressed={on}
                    disabled={locked || slots === 0 || (!on && full)}
                    onClick={() => toggle(t.id)}
                  >
                    {on ? '빼기' : '끼우기'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <p className="muted">
        {view.bag.length}/{bagSize(view.bagTier)}칸
      </p>
      {!atShop && <p className="fish-shop-note">상점에서 팔 수 있어요</p>}
      {view.bag.length > 0 && <p className="muted">물고기를 누르면 잠가서 팔리지 않게 해요</p>}
      <ul className="fish-bag">
        {cells.map((f, i) =>
          f ? (
            <li key={i} className="fish-cell-slot">
              <button
                type="button"
                className={`fish-cell${f.locked ? ' fish-cell-locked' : ''}`}
                aria-pressed={!!f.locked}
                aria-label={`${speciesName(f.species)} ${f.sizeCm}cm ${f.locked ? '잠금 해제' : '잠금'}`}
                disabled={busy}
                onClick={() => onLock(i, !f.locked)}
              >
                {f.locked && <span className="fish-cell-lock" aria-hidden="true" />}
                <img src={spriteDataUrl(`fish-${f.species}`, ICON_SCALE)} alt="" />
                <span className="fish-cell-size">{f.sizeCm}cm</span>
                <span className="fish-cell-price">{gold(price(f.species, f.sizeCm, f.perfect))}</span>
              </button>
            </li>
          ) : (
            <li key={i} className="fish-cell fish-cell-empty" aria-hidden="true" />
          ),
        )}
      </ul>
    </section>
  )
}

type ShopProps = { view: View; busy: boolean; onSell(): void; onBuy(tier: number): void; onBuyBag(tier: number): void; onBuyTackle(id: TackleId): void }

export function ShopPanel({ view, busy, onSell, onBuy, onBuyBag, onBuyTackle }: ShopProps) {
  // 잠긴 물고기는 팔리지 않는다 (서버 sell과 같은 규칙)
  const selling = view.bag.filter((f) => !f.locked)
  const lockedCount = view.bag.length - selling.length
  const bagValue = selling.reduce((sum, f) => sum + price(f.species, f.sizeCm, f.perfect), 0)
  const top = RODS[RODS.length - 1].tier
  const topBag = BAGS[BAGS.length - 1].tier
  const slots = tackleSlots(view.rodTier)
  const ownedTackles = view.tackles ?? []
  const equippedTackles = view.equipped ?? []
  return (
    <section className="fish-panel-body" aria-label="상점">
      <div className="fish-shop-sell">
        <p className="muted">
          {`팔 물고기 ${selling.length}마리${lockedCount > 0 ? ` · 잠금 ${lockedCount}마리` : ''} · 예상 ${gold(bagValue)}`}
        </p>
        <button type="button" className="btn btn-primary" disabled={busy || selling.length === 0} onClick={onSell}>
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
      <h3 className="fish-panel-sub">찌</h3>
      {slots === 0 && <p className="fish-shop-note">사 둘 수 있고, 카본 낚싯대부터 낄 수 있어요</p>}
      <ul className="fish-rods" aria-label="찌 목록">
        {TACKLES.map((t) => {
          const owned = ownedTackles.includes(t.id)
          const on = equippedTackles.includes(t.id)
          return (
            <li key={t.id} className={`fish-rod${owned ? ' fish-rod-owned' : ''}`}>
              <img src={spriteDataUrl(`tackle-${t.id}`, ICON_SCALE)} alt="" />
              <div className="fish-rod-info">
                <strong>{t.name}</strong>
                <span className="muted">{t.desc}</span>
                <span className="muted">{gold(t.price)}</span>
              </div>
              {owned ? (
                <span className="fish-rod-state">{on ? '장착 중' : '보유 중 · 가방에서 낄 수 있어요'}</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  aria-label={`${t.name} 사기`}
                  disabled={busy || view.gold < t.price}
                  onClick={() => onBuyTackle(t.id)}
                >
                  사기
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

type UnlockProps = { view: View; area: AreaId; busy: boolean; onUnlock(): void }

/** 잠긴 문·선착장 앞에서 여는 해금 창: 무엇을 사는지, 가격, 보유 골드, 열기. 골드가 모자라면 열기를 끈다. */
export function UnlockPanel({ view, area, busy, onUnlock }: UnlockProps) {
  const unlock = UNLOCKS[area]
  if (!unlock) return null
  const areaName = AREAS.find((a) => a.id === area)?.name ?? area
  const short = view.gold < unlock.price
  return (
    <section className="fish-panel-body" aria-label="지역 열기">
      <div className="fish-rod">
        <div className="fish-rod-info">
          <strong>{unlock.name}</strong>
          <span className="muted">{areaName}에 갈 수 있어요</span>
          <span className="fish-unlock-price">{gold(unlock.price)}</span>
          <span className="muted">보유 {gold(view.gold)}</span>
          {short && <span className="fish-shop-note">골드가 모자라요</span>}
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || short} onClick={onUnlock}>
          열기
        </button>
      </div>
    </section>
  )
}

/** 낚시 자리 이름. 모르는 자리는 id 그대로 보인다. */
const SPOT_NAMES: Record<string, string> = { pier: '부두', shore: '해안', river: '강', pond: '연못', waterfall: '폭포', lake: '호수', cave1: '얕은 웅덩이', cave2: '수정 웅덩이', cave3: '용암', sea: '바다', lagoon: '석호' }

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
