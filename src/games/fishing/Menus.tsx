// 낚시 메뉴(가방·상점·도감·지역 해금·도전과제·순간이동기). 값과 규칙은 서버 view를 그대로 보여 주고, 행동은 콜백으로만 올린다.
import { useEffect, useState, type ReactNode } from 'react'
import { AREAS, areaHasSpecies, BAGS, bagSize, BUFFS, CHALLENGES, RODS, rodAtLeast, RARITY_NAMES, SHOES, SPECIES, TACKLES, tackleSlots, UNLOCKS, type AreaId, type BuffId, type Species, type TackleId } from './data.ts'
import { SEASON_NAMES } from './clock.ts'
import { discardFee, fishSellPrice, freeBonus, sellRatePct, soldToday, teleporterOpen, type DiscardAt, type Fish, type View } from './logic.ts'
import { teleportFee } from './teleport.ts'
import { spriteDataUrl } from './sprites.ts'

const ICON_SCALE = 2
/** 신화를 뺀 어종이 요구하는 가장 높은 낚싯대. 이보다 높은 단계는 "고급 장비"(신화만 그 단계를 요구할 수 있다) */
const PREMIUM_ROD = Math.max(...SPECIES.filter((s) => s.rarity !== 'mythic').map((s) => s.minRod))
/** 그 낚싯대가 있어야 들어가는 지역 이름들(난파선 앞바다는 백골 이상) */
const areasNeeding = (tier: number) => AREAS.filter((a) => a.minRod === tier)
const gold = (n: number) => `${n.toLocaleString('ko-KR')} JWD`
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
// 연구로 다시 잡은 전설·신화(origin recatch)는 50%(fishSellPrice, v27)
type PricedFish = { species: string; sizeCm: number; perfect: boolean; origin?: Fish['origin'] }
const fishPrice = (f: PricedFish, buffs: readonly BuffId[] = []): number | null =>
  knownSpecies(f.species) ? fishSellPrice(f, buffs) : null
/**
 * 전부 팔기 예상(서버 sell과 같은 규칙, 판매 마릿수 감쇠 v15): 오늘 before마리 판 뒤 가방 순서대로 한 마리씩 배율.
 * 모르는 어종(화면이 서버보다 옛 데이터일 때)은 금액에서 빼고 순서 자리는 그대로 센다
 */
const saleEstimate = (fish: readonly PricedFish[], buffs: readonly BuffId[], before: number): number =>
  fish.reduce((sum, f, i) => {
    const v = fishPrice(f, buffs)
    return v === null ? sum : sum + Math.round((v * sellRatePct(before + i + 1)) / 100)
  }, 0)
const priceLabel = (f: PricedFish, buffs: readonly BuffId[] = []): string => {
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
  /** 자랑하기: 이 칸의 물고기를 든다(설계 2026-11-25-fishing-brag-discard). 없으면 모드를 보이지 않는다 */
  onBrag?(index: number): void
  /** 버리기(v21 여러 마리): 고른 칸(오름차순), 화면이 본 환경부담금 합계, 버리는 곳 */
  onDiscard?(indices: number[], fee: number, at: DiscardAt): void
  /** 버리는 곳(v18). 'trash'(마을회관 쓰레기통)면 버리기 모드로 열고 부담금 5%. 기본 'bag'(50%) */
  discardAt?: DiscardAt
  /** 어분 만들기(경제 P1, 플래그 bait): 고른 일반 물고기 칸(오름차순). 없으면 어분 모드를 보이지 않는다 */
  onGrind?(indices: number[]): void
  /** 재포획 기증(경제 P2, 플래그 exhibit): 칸 하나 */
  onDonate?(index: number): void
  /** 지역 재료 추출(경제 P2, 플래그 alchemy·첫 신화 전시 뒤): 고른 일반 물고기 칸 */
  onExtract?(indices: number[]): void
  /** 미끼·연구 영역(경제 P1). Game이 플래그가 켜졌을 때만 넘긴다 */
  econ?: ReactNode
}

type BagMode = 'lock' | 'brag' | 'discard' | 'grind' | 'donate' | 'extract'
const BAG_MODES: readonly { mode: BagMode; label: string }[] = [
  { mode: 'lock', label: '잠금' },
  { mode: 'brag', label: '자랑하기' },
  { mode: 'discard', label: '버리기' },
  { mode: 'grind', label: '어분' },
  { mode: 'extract', label: '재료' },
  { mode: 'donate', label: '기증' },
]
/** 여러 마리 골라 한 번에 하는 모드 */
const MULTI: readonly BagMode[] = ['discard', 'grind', 'extract']
/** 어분 재료: 전설·신화가 아닌 아는 어종 */
const isOrdinaryFish = (id: string) => knownSpecies(id) && !isLegend(id) && !isMythic(id)

/** atShop: 상점(마을회관 자판기) 앞에 서 있는가. 아니면 어디서 팔 수 있는지 알려 준다. 칸을 누르면 모드에 따라 잠금·자랑·버리기. */
export function BagPanel({ view, atShop, busy, onEquip, onLock, onWardrobe, onBrag, onDiscard, discardAt = 'bag', onGrind, onDonate, onExtract, econ }: BagProps) {
  const [mode, setMode] = useState<BagMode>(discardAt === 'trash' ? 'discard' : 'lock')
  /** 버리기 모드에서 고른 칸(오름차순). 가방이 바뀌면(버림·다른 탭) 칸이 밀리므로 비운다 */
  const [picked, setPicked] = useState<number[]>([])
  useEffect(() => {
    setPicked([])
  }, [view.bag])
  const togglePick = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i].sort((a, b) => a - b)))
  const pickable = view.bag.flatMap((f, i) => (!f.locked && (mode === 'grind' || mode === 'extract' ? isOrdinaryFish(f.species) : knownSpecies(f.species)) ? [i] : []))
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
      {econ}
      <p className="muted">
        {view.bag.length}/{bagSize(view.bagTier)}칸
      </p>
      {!atShop && <p className="fish-shop-note">마을회관 상점에서 팔 수 있어요</p>}
      {(onBrag || onDiscard || onGrind || onDonate || onExtract) && view.bag.length > 0 && (
        <div className="fish-bag-modes" role="group" aria-label="물고기를 누르면">
          {BAG_MODES.filter((m) => m.mode === 'lock' || ({ brag: onBrag, grind: onGrind, extract: onExtract, donate: onDonate, discard: onDiscard }[m.mode as Exclude<BagMode, 'lock'>])).map((m) => (
            <button
              key={m.mode}
              type="button"
              className={`btn btn-sm ${mode === m.mode ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={mode === m.mode}
              onClick={() => {
                setMode(m.mode)
                setPicked([])
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {view.bag.length > 0 && (
        <p className="muted">
          {mode === 'lock' ? '물고기를 누르면 잠가서 팔리지 않게 해요' : mode === 'brag' ? '들어 올릴 물고기를 골라요' : mode === 'grind' ? '어분으로 만들 물고기를 골라요 · 잠긴 물고기·전설·신화는 안 돼요' : mode === 'extract' ? '재료로 바꿀 물고기를 골라요 · 그 지역 재료가 흔함 1·드묾 2·희귀 3개 나와요' : mode === 'donate' ? '연구로 다시 잡은 물고기를 눌러 전시에 기증해요(되팔 수 없어요)' : '버릴 물고기를 골라요 · 잠긴 물고기는 못 버려요'}
        </p>
      )}
      {MULTI.includes(mode) && pickable.length > 0 && (
        <div className="fish-bag-modes" role="group" aria-label={mode === 'grind' ? '어분으로 만들 물고기 고르기' : mode === 'extract' ? '재료로 바꿀 물고기 고르기' : '버릴 물고기 고르기'}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(pickable)}>
            잠기지 않은 것 모두 선택
          </button>
          {picked.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked([])}>
              선택 해제
            </button>
          )}
        </div>
      )}
      {mode === 'discard' && picked.length > 0 && picked.every((i) => view.bag[i] && knownSpecies(view.bag[i].species)) && (() => {
        const fs = picked.map((i) => view.bag[i])
        const sum = (at: DiscardAt) => fs.reduce((a, f) => a + discardFee(f, buffsOf(view), at), 0)
        const fee = sum(discardAt)
        const what = fs.length === 1 ? `${speciesName(fs[0].species)} ${fs[0].sizeCm}cm` : `${fs.length}마리`
        const cheaper = discardAt === 'bag' ? ` · 쓰레기통에 버리면 ${gold(sum('trash'))}` : ''
        return (
          <div className="fish-discard-confirm">
            <span>{`${what} 버리기 · 환경부담금 ${gold(fee)}${cheaper}`}</span>
            <button type="button" className="btn btn-primary btn-sm" aria-label="버리기 확인" disabled={busy} onClick={() => { setPicked([]); onDiscard?.(picked, fee, discardAt) }}>
              버리기
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked([])}>
              취소
            </button>
          </div>
        )
      })()}
      {mode === 'grind' && picked.length > 0 && picked.every((i) => view.bag[i] && isOrdinaryFish(view.bag[i].species)) && (
        <div className="fish-discard-confirm">
          <span>{`${picked.length}마리 → 어분 ${picked.length}개`}</span>
          <button type="button" className="btn btn-primary btn-sm" aria-label="어분 만들기 확인" disabled={busy} onClick={() => { setPicked([]); onGrind?.(picked) }}>
            어분 만들기
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked([])}>
            취소
          </button>
        </div>
      )}
      {mode === 'extract' && picked.length > 0 && picked.every((i) => view.bag[i] && isOrdinaryFish(view.bag[i].species)) && (
        <div className="fish-discard-confirm">
          <span>{`${picked.length}마리를 재료로`}</span>
          <button type="button" className="btn btn-primary btn-sm" aria-label="재료 만들기 확인" disabled={busy} onClick={() => { setPicked([]); onExtract?.(picked) }}>
            재료 만들기
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked([])}>
            취소
          </button>
        </div>
      )}
      <ul className="fish-bag">
        {cells.map((f, i) =>
          f ? (
            <li key={i} className="fish-cell-slot">
              <button
                type="button"
                className={`fish-cell${f.locked ? ' fish-cell-locked' : ''}${isLegend(f.species) ? ' fish-cell-legend' : ''}${isMythic(f.species) ? ' fish-cell-mythic' : ''}`}
                aria-pressed={mode === 'lock' ? !!f.locked : MULTI.includes(mode) ? picked.includes(i) : undefined}
                aria-label={`${isLegend(f.species) ? '전설 ' : isMythic(f.species) ? '신화 ' : ''}${speciesName(f.species)} ${f.sizeCm}cm ${f.origin === 'recatch' ? ' 재포획' : ''} ${mode === 'brag' ? '자랑하기' : mode === 'discard' ? '버리기' : mode === 'grind' ? '어분' : mode === 'extract' ? '재료' : mode === 'donate' ? '기증' : f.locked ? '잠금 해제' : '잠금'}`}
                disabled={busy || (mode !== 'lock' && !knownSpecies(f.species)) || (mode === 'discard' && !!f.locked) || ((mode === 'grind' || mode === 'extract') && (!!f.locked || !isOrdinaryFish(f.species))) || (mode === 'donate' && f.origin !== 'recatch')}
                onClick={() => {
                  if (mode === 'brag') onBrag?.(i)
                  else if (MULTI.includes(mode)) togglePick(i)
                  else if (mode === 'donate') onDonate?.(i)
                  else onLock(i, !f.locked)
                }}
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

type ShopProps = { view: View; busy: boolean; onSell(): void; onBuy(tier: number): void; onBuyBag(tier: number): void; onBuyShoes?(tier: number): void; onBuyTackle(id: TackleId): void }

export function ShopPanel({ view, busy, onSell, onBuy, onBuyBag, onBuyShoes, onBuyTackle }: ShopProps) {
  // 잠긴 물고기는 팔리지 않는다 (서버 sell과 같은 규칙)
  const selling = view.bag.filter((f) => !f.locked)
  const lockedCount = view.bag.length - selling.length
  // 옛 서버 응답(sold 없음)·어제 기록은 0마리. 날짜는 브라우저 시계로 다시 본다
  const soldNow = soldToday(view.sold ?? { day: '', n: 0 }, Date.now())
  const bagValue = saleEstimate(selling, buffsOf(view), soldNow)
  const top = RODS[RODS.length - 1].tier
  const topBag = BAGS[BAGS.length - 1].tier
  // 옛 서버 응답(shoesTier 없음)은 기본 장화
  const shoesTier = view.shoesTier ?? 1
  const topShoes = SHOES[SHOES.length - 1].tier
  const slots = tackleSlots(view.rodTier)
  const ownedTackles = view.tackles ?? []
  const equippedTackles = view.equipped ?? []
  return (
    <section className="fish-panel-body" aria-label="상점">
      <div className="fish-shop-sell">
        <p className="muted">
          {`팔 물고기 ${selling.length}마리${lockedCount > 0 ? ` · 잠금 ${lockedCount}마리` : ''} · 예상 ${gold(bagValue)}`}
        </p>
        <p className="muted">{`오늘 판 물고기 ${soldNow.toLocaleString('ko-KR')}마리 · 지금 판매가 ${sellRatePct(soldNow + 1)}%`}</p>
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
                {!owned && areasNeeding(rod.tier).length > 0 && <span className="muted">{areasNeeding(rod.tier).map((a) => `${a.name}(${UNLOCKS[a.id]?.name ?? '해금'})`).join('·') + '를 열 수 있어요'}</span>}
                {rod.tier > PREMIUM_ROD && !owned && areasNeeding(rod.tier).length === 0 && <span className="muted">고급 장비 · 신화 말고는 없어도 모든 물고기를 낚아요</span>}
                {owned && <span className="fish-rod-state">{rod.tier === view.rodTier ? '사용 중' : '보유'}</span>}
                {next && short && <span className="fish-shop-note">JWD가 부족해요</span>}
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
                {next && short && <span className="fish-shop-note">JWD가 부족해요</span>}
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
      <h3 className="fish-panel-sub">신발</h3>
      {shoesTier >= topShoes && <p className="fish-shop-note">신발은 최고 단계예요</p>}
      <ul className="fish-rods" aria-label="신발 목록">
        {SHOES.map((sh) => {
          const owned = sh.tier <= shoesTier
          const next = sh.tier === shoesTier + 1
          const short = view.gold < sh.price
          return (
            <li key={sh.tier} className={`fish-rod${owned ? ' fish-rod-owned' : ''}`}>
              <div className="fish-rod-info">
                <strong>{sh.name}</strong>
                <span className="muted">{sh.price === 0 ? '기본' : gold(sh.price)}</span>
                <span className="muted">{`걷기 ×${sh.speed}`}</span>
                {owned && <span className="fish-rod-state">{sh.tier === shoesTier ? '사용 중' : '보유'}</span>}
                {next && short && <span className="fish-shop-note">JWD가 부족해요</span>}
                {!owned && !next && <span className="muted">이전 단계를 먼저 사야 해요</span>}
              </div>
              {next && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  aria-label={`${sh.name} 구매`}
                  disabled={busy || short}
                  onClick={() => onBuyShoes?.(sh.tier)}
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
      <p className="muted">옷은 마을회관 9번 방 옷 가게에서 사요</p>
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
            <span className={rodShort ? 'fish-shop-note' : 'muted'}>{`${rodAtLeast(unlock.minRod)}이 있어야 나갈 수 있어요`}</span>
          )}
          {short && <span className="fish-shop-note">JWD가 모자라요</span>}
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
      <p className="muted">과제를 깨면 그 지역 순간이동기가 켜지고, 미니게임(자유 플레이) JWD가 영구히 늘어요</p>
      <p className="fish-bonus-now">{`지금 미니게임 JWD ${bonusMultiplier(freeBonus({ challenges: progress }))}`}</p>
      <ul className="fish-rods" aria-label="도전과제 목록">
        {CHALLENGES.map((c) => {
          const finished = progress[c.id]?.done === true
          return (
            <li key={c.id} className={`fish-rod${finished ? ' fish-rod-owned' : ''}`}>
              <div className="fish-rod-info">
                <strong>{`${areaName(c.area)} · ${c.title}`}</strong>
                <span className="muted">{c.desc}</span>
                <span className="muted">{`미니게임 JWD +${c.freeBonusPct}%`}</span>
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

/** 도전과제 보너스 배율 표기(지갑 화면 formatMultiplier와 같은 모양): 140 → "×2.4" */
const bonusMultiplier = (pct: number) => `×${((100 + pct) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`

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
                  {short && <span className="fish-shop-note">JWD가 모자라요</span>}
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
                      {RARITY_NAMES[s.rarity]} · {entry.count}마리 · 최대 {entry.maxCm}cm
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
