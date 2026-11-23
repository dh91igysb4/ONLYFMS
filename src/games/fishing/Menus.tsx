// 낚시 메뉴(가방·상점·도감·지역 해금·도전과제·순간이동기). 값과 규칙은 서버 view를 그대로 보여 주고, 행동은 콜백으로만 올린다.
import { useState } from 'react'
import { AREAS, areaHasSpecies, BAGS, bagSize, BUFFS, CHALLENGES, RODS, SPECIES, TACKLES, tackleSlots, UNLOCKS, type AreaId, type BuffId, type Species, type TackleId } from './data.ts'
import { SEASON_NAMES } from './clock.ts'
import { sellPrice, teleporterOpen, type View } from './logic.ts'
import { teleportFee } from './teleport.ts'
import { spriteDataUrl } from './sprites.ts'

const ICON_SCALE = 2
/** 신화를 뺀 어종이 요구하는 가장 높은 낚싯대. 이보다 높은 단계는 "고급 장비"(신화만 그 단계를 요구할 수 있다) */
const PREMIUM_ROD = Math.max(...SPECIES.filter((s) => s.rarity !== 'mythic').map((s) => s.minRod))
/** 그 낚싯대가 있어야 들어가는 지역 이름들(난파선 앞바다는 백골 이상) */
const areasNeeding = (tier: number): string[] => AREAS.filter((a) => a.minRod === tier).map((a) => a.name)
const rodName = (tier: number) => RODS.find((r) => r.tier === tier)?.name ?? `${tier}단계 낚싯대`
const gold = (n: number) => `${n.toLocaleString('ko-KR')} G`
const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id
/** 이 판에 있는 어종인가. 더 새 서버가 준 모르는 id는 그림·가격 없이 이름(id)만 보인다 */
const knownSpecies = (id: string) => SPECIES.some((s) => s.id === id)
const rarityOf = (id: string) => SPECIES.find((s) => s.id === id)?.rarity
/** 전설(신화 아님)·신화. 모르는 어종(더 새 서버)은 둘 다 아니다 */
const isLegend = (id: string) => rarityOf(id) === 'legend'
const isMythic = (id: string) => rarityOf(id) === 'mythic'
/** 옛 서버 응답(buffs 없음)은 빈 목록으로 읽는다 */
export const buffsOf = (view: Pick<View, 'buffs'>): BuffId[] => view.buffs ?? []
/** 화면용 가격(실제로 팔리는 값, 용왕의 여의주 포함): 모르는 어종이면 null(price는 모르는 id에 throw한다) */
const fishPrice = (f: { species: string; sizeCm: number; perfect: boolean }, buffs: readonly BuffId[] = []): number | null =>
  knownSpecies(f.species) ? sellPrice(f, buffs) : null
const priceLabel = (f: { species: string; sizeCm: number; perfect: boolean }, buffs: readonly BuffId[] = []): string => {
  const v = fishPrice(f, buffs)
  return v === null ? '—' : gold(v)
}

/** 도감·지도 칸 테두리: 전설은 한 겹, 신화는 두 겹 */
export const dexItemClass = (s: Species) =>
  `fish-dex-item${s.rarity === 'mythic' ? ' fish-dex-item-mythic' : s.legend ? ' fish-dex-item-legend' : ''}`
/** 이름 옆 등급 배지(전설·신화). 신화는 전설과 색을 뒤집는다 */
export function RarityBadge({ s }: { s: Species }) {
  if (s.rarity === 'mythic') return <span className="fish-dex-mythic">신화</span>
  return s.legend ? <span className="fish-dex-legend">전설</span> : null
}
/** 잡은 신화가 준 힘 한 줄. 신화가 아니면 null */
export function buffLine(s: Species): string | null {
  const b = s.rarity === 'mythic' ? BUFFS.find((x) => x.id === s.legend?.buff) : undefined
  return b ? `신화의 힘: ${b.name} — ${b.desc}` : null
}

/** 가방 창 "신화의 힘": 얻은 버프는 그림·이름·설명, 못 얻은 칸은 자물쇠 + "???"(이름·효과 숨김) */
function BuffList({ buffs }: { buffs: readonly BuffId[] }) {
  const owned = BUFFS.filter((b) => buffs.includes(b.id)).length
  return (
    <div className="fish-buffs" role="group" aria-label="신화의 힘">
      <h3 className="fish-panel-sub">{`신화의 힘 ${owned}/${BUFFS.length}`}</h3>
      <ul className="fish-rods">
        {BUFFS.map((b, i) =>
          buffs.includes(b.id) ? (
            <li key={b.id} className="fish-rod fish-rod-owned">
              <img className="fish-buff-icon" src={spriteDataUrl(`buff-${b.id}`, ICON_SCALE)} alt="" />
              <div className="fish-rod-info">
                <strong>{b.name}</strong>
                <span className="muted">{b.desc}</span>
              </div>
            </li>
          ) : (
            <li key={`locked-${i}`} className="fish-rod fish-buff-locked">
              <span className="fish-buff-lock" aria-hidden="true" />
              <div className="fish-rod-info">
                <strong className="muted">???</strong>
                <span className="muted">신화를 잡으면 얻어요</span>
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

type BagProps = {
  view: View
  atShop: boolean
  busy: boolean
  onEquip(ids: TackleId[]): void
  onLock(index: number, locked: boolean): void
  /** 옷장 창 열기 */
  onWardrobe?(): void
}

/** atShop: 상점 문 앞에 서 있는가. 아니면 어디서 팔 수 있는지 알려 준다. 칸을 누르면 잠금을 뒤집는다. */
export function BagPanel({ view, atShop, busy, onEquip, onLock, onWardrobe }: BagProps) {
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
      {onWardrobe && (
        <button type="button" className="btn btn-ghost btn-sm fish-wear-open" disabled={busy} onClick={onWardrobe}>
          옷장
        </button>
      )}
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
      <BuffList buffs={buffsOf(view)} />
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
                className={`fish-cell${f.locked ? ' fish-cell-locked' : ''}${isLegend(f.species) ? ' fish-cell-legend' : ''}${isMythic(f.species) ? ' fish-cell-mythic' : ''}`}
                aria-pressed={!!f.locked}
                aria-label={`${isLegend(f.species) ? '전설 ' : isMythic(f.species) ? '신화 ' : ''}${speciesName(f.species)} ${f.sizeCm}cm ${f.locked ? '잠금 해제' : '잠금'}`}
                disabled={busy}
                onClick={() => onLock(i, !f.locked)}
              >
                {f.locked && <span className="fish-cell-lock" aria-hidden="true" />}
                {knownSpecies(f.species) && <img src={spriteDataUrl(`fish-${f.species}`, ICON_SCALE)} alt="" />}
                <span className="fish-cell-size">{f.sizeCm}cm</span>
                <span className="fish-cell-price">{priceLabel(f, buffsOf(view))}</span>
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

type ShopProps = { view: View; busy: boolean; onSell(): void; onBuy(tier: number): void; onBuyBag(tier: number): void; onBuyTackle(id: TackleId): void; onWardrobe?(): void }

export function ShopPanel({ view, busy, onSell, onBuy, onBuyBag, onBuyTackle, onWardrobe }: ShopProps) {
  // 잠긴 물고기는 팔리지 않는다 (서버 sell과 같은 규칙)
  const selling = view.bag.filter((f) => !f.locked)
  const lockedCount = view.bag.length - selling.length
  // 모르는 어종은 예상 금액에서 뺀다(서버가 팔 때 값을 정한다)
  const bagValue = selling.reduce((sum, f) => sum + (fishPrice(f, buffsOf(view)) ?? 0), 0)
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
                {!owned && areasNeeding(rod.tier).length > 0 && <span className="muted">{`${areasNeeding(rod.tier).join('·')}에 갈 수 있어요`}</span>}
                {rod.tier > PREMIUM_ROD && !owned && areasNeeding(rod.tier).length === 0 && <span className="muted">고급 장비 · 신화 말고는 없어도 모든 물고기를 낚아요</span>}
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
      {onWardrobe && (
        <>
          <h3 className="fish-panel-sub">옷 가게</h3>
          <p className="muted">모자·옷·머리·낚싯대 겉모습을 사고 입어 봐요. 성능은 그대로예요</p>
          <button type="button" className="btn btn-primary btn-sm fish-wear-open" disabled={busy} onClick={onWardrobe}>
            옷 가게 열기
          </button>
        </>
      )}
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
  // 낚싯대 요구(난파선 앞바다: 백골 이상). 서버도 unlockArea에서 need_rod로 막는다
  const rodShort = unlock.minRod !== undefined && view.rodTier < unlock.minRod
  return (
    <section className="fish-panel-body" aria-label="지역 열기">
      <div className="fish-rod">
        <div className="fish-rod-info">
          <strong>{unlock.name}</strong>
          <span className="muted">{areaName}에 갈 수 있어요</span>
          <span className="fish-unlock-price">{gold(unlock.price)}</span>
          <span className="muted">보유 {gold(view.gold)}</span>
          {unlock.minRod !== undefined && (
            <span className={rodShort ? 'fish-shop-note' : 'muted'}>{`${rodName(unlock.minRod)} 이상이 있어야 나갈 수 있어요`}</span>
          )}
          {short && <span className="fish-shop-note">골드가 모자라요</span>}
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || short || rodShort} onClick={onUnlock}>
          열기
        </button>
      </div>
    </section>
  )
}

const areaName = (id: AreaId) => AREAS.find((a) => a.id === id)?.name ?? id
/** 옛 서버 응답(challenges 없음)은 빈 진행으로 읽는다 */
const progressOf = (view: View) => view.challenges ?? {}
/** 진행 표시: 깬 뒤에는 count를 넘지 않는다 */
const progressLabel = (view: View, id: string, count: number) => `${Math.min(progressOf(view)[id]?.progress ?? 0, count)}/${count}`

/** 도전과제 목록: 지역 순서, 진행도, 깬 과제는 순간이동기가 켜졌다고 알려 준다 */
export function ChallengePanel({ view }: { view: View }) {
  const progress = progressOf(view)
  const done = CHALLENGES.filter((c) => progress[c.id]?.done).length
  return (
    <section className="fish-panel-body" aria-label="도전과제">
      <p className="muted">{`깬 과제 ${done}/${CHALLENGES.length}`}</p>
      <p className="muted">과제를 깨면 그 지역 순간이동기가 켜져요</p>
      <ul className="fish-rods" aria-label="도전과제 목록">
        {CHALLENGES.map((c) => {
          const finished = progress[c.id]?.done === true
          return (
            <li key={c.id} className={`fish-rod${finished ? ' fish-rod-owned' : ''}`}>
              <div className="fish-rod-info">
                <strong>{`${areaName(c.area)} · ${c.title}`}</strong>
                <span className="muted">{c.desc}</span>
                {finished
                  ? <span className="fish-rod-state">완료 · 순간이동기 켜짐</span>
                  : <span className="muted">{progressLabel(view, c.id, c.count)}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

type TeleportProps = { view: View; area: AreaId; busy: boolean; onTeleport(to: AreaId): void }

/**
 * 순간이동기 창. 꺼져 있으면 켜는 과제를, 켜져 있으면 켜진 다른 이동기와 요금(teleportFee, 서버와 같은 값)을 보여 준다.
 * 골드가 모자란 곳은 이동을 끈다.
 */
export function TeleportPanel({ view, area, busy, onTeleport }: TeleportProps) {
  const state = { areas: view.areas, challenges: progressOf(view) }
  const challenge = CHALLENGES.find((c) => c.area === area)
  if (!teleporterOpen(state, area)) {
    return (
      <section className="fish-panel-body" aria-label="순간이동기">
        <p className="fish-shop-note">아직 꺼져 있어요</p>
        <p className="muted">도전과제를 깨면 켜져요</p>
        {challenge && (
          <div className="fish-rod">
            <div className="fish-rod-info">
              <strong>{challenge.title}</strong>
              <span className="muted">{challenge.desc}</span>
              <span className="muted">{progressLabel(view, challenge.id, challenge.count)}</span>
            </div>
          </div>
        )}
      </section>
    )
  }
  const others = AREAS.filter((a) => a.id !== area && teleporterOpen(state, a.id))
  return (
    <section className="fish-panel-body" aria-label="순간이동기">
      <p className="muted">{`보유 ${gold(view.gold)}`}</p>
      {others.length === 0 ? (
        <p className="fish-shop-note">다른 지역의 순간이동기를 켜면 오갈 수 있어요</p>
      ) : (
        <ul className="fish-rods" aria-label="갈 수 있는 순간이동기">
          {others.map((a) => {
            const fee = teleportFee(area, a.id)
            const short = view.gold < fee
            return (
              <li key={a.id} className="fish-rod">
                <div className="fish-rod-info">
                  <strong>{a.name}</strong>
                  <span className="fish-unlock-price">{gold(fee)}</span>
                  {short && <span className="fish-shop-note">골드가 모자라요</span>}
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  aria-label={`${a.name} 이동`}
                  disabled={busy || short}
                  onClick={() => onTeleport(a.id)}
                >
                  이동
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** 낚시 자리 이름. 모르는 자리는 id 그대로 보인다. */
export const SPOT_NAMES: Record<string, string> = { pier: '부두', shore: '해안', river: '강', pond: '연못', waterfall: '폭포', lake: '호수', cave1: '얕은 웅덩이', cave2: '수정 웅덩이', cave3: '용암', sea: '바다', lagoon: '석호', estuary: '하구', creek: '갯골', marsh: '늪', bog: '수렁', ice: '얼음 구멍', hotspring: '온천', wreck: '난파선', abyss: '심해' }

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
          const needs = s.rarity === 'mythic' ? s.legend?.needs ?? [] : []
          const line = buffLine(s)
          return (
            <li key={s.id} className={dexItemClass(s)}>
              <img
                src={spriteDataUrl(`fish-${s.id}`, ICON_SCALE, { silhouette: !entry })}
                alt={entry ? s.name : '미발견 물고기'}
              />
              {entry ? (
                <>
                  <span className="fish-dex-info">
                    <strong>
                      {s.name}
                      <RarityBadge s={s} />
                    </strong>
                    <span className="muted">
                      {entry.count}마리 · 최대 {entry.maxCm}cm
                    </span>
                    <span className="muted">{conditionLabel(s)}</span>
                    {s.legend && <span className="muted">세이브당 한 마리 · 잡았어요</span>}
                    {line && <span className="fish-dex-buff">{line}</span>}
                  </span>
                </>
              ) : s.rarity === 'mythic' ? (
                // 안 잡은 신화: 이름·조건·버프와 먼저 잡을 전설 이름은 숨기고 수만 보인다
                <span className="fish-dex-info">
                  <strong className="muted">???</strong>
                  <span className="muted">신화 · 세이브당 한 마리</span>
                  <span className="muted">{`먼저 잡을 전설 ${needs.filter((id) => (view.legends ?? []).includes(id)).length}/${needs.length}`}</span>
                </span>
              ) : s.legend ? (
                <span className="fish-dex-info">
                  <strong className="muted">???</strong>
                  <span className="muted">세이브당 한 마리</span>
                </span>
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
