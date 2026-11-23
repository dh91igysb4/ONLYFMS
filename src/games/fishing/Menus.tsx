// 낚시 메뉴(가방·상점·도감). 값과 규칙은 서버 view를 그대로 보여 주고, 행동은 콜백으로만 올린다.
import { bagSize, RODS, SPECIES } from './data.ts'
import { price, type View } from './logic.ts'
import { spriteDataUrl } from './sprites.ts'

const ICON_SCALE = 2
const gold = (n: number) => `${n.toLocaleString('ko-KR')} G`
const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id

export function BagPanel({ view }: { view: View }) {
  const cells = Array.from({ length: bagSize(view.bagTier) }, (_, i) => view.bag[i] ?? null)
  return (
    <section className="fish-panel-body" aria-label="가방">
      <p className="muted">
        {view.bag.length}/{bagSize(view.bagTier)}칸
      </p>
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

type ShopProps = { view: View; busy: boolean; onSell(): void; onBuy(tier: number): void }

export function ShopPanel({ view, busy, onSell, onBuy }: ShopProps) {
  const bagValue = view.bag.reduce((sum, f) => sum + price(f.species, f.sizeCm, f.perfect), 0)
  const top = RODS[RODS.length - 1].tier
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
      <ul className="fish-rods">
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
    </section>
  )
}

export function DexPanel({ view }: { view: View }) {
  const found = SPECIES.filter((s) => view.dex[s.id]).length
  return (
    <section className="fish-panel-body" aria-label="도감">
      <p className="muted">
        {found}/{SPECIES.length}종
      </p>
      <ul className="fish-dex">
        {SPECIES.map((s) => {
          const entry = view.dex[s.id]
          return (
            <li key={s.id} className="fish-dex-item">
              <img
                src={spriteDataUrl(`fish-${s.id}`, ICON_SCALE, { silhouette: !entry })}
                alt={entry ? s.name : '미발견 물고기'}
              />
              {entry ? (
                <>
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {entry.count}마리 · 최대 {entry.maxCm}cm
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
