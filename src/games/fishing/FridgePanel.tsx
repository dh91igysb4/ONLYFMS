// 마을회관 1번 방 냉장고 창(마을회관 설계 §5): 가방 물고기를 넣고, 냉장고 물고기를 꺼낸다. 보관만 한다(팔기·버리기는 가방에서).
import { bagSize, FRIDGE_SIZE, SPECIES, type BuffId } from './data.ts'
import { sellPrice, type Fish, type View } from './logic.ts'
import { spriteDataUrl } from './sprites.ts'

const ICON_SCALE = 2
const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id
const known = (id: string) => SPECIES.some((s) => s.id === id)
/** 판매 예상가(가방 상점 표시와 같은 sellPrice, 버프 포함). 모르는 어종이면 null(sellPrice는 모르는 id에 throw한다) */
const fishPrice = (f: Fish, buffs: readonly BuffId[]): number | null => (known(f.species) ? sellPrice(f, buffs) : null)

type Props = { view: View; busy: boolean; onStore(index: number): void; onTakeOut(index: number): void }

function FishRow({ f, buffs, verb, disabled, onClick }: { f: Fish; buffs: readonly BuffId[]; verb: '넣기' | '꺼내기'; disabled: boolean; onClick(): void }) {
  const price = fishPrice(f, buffs)
  const priceText = price === null ? null : `${price.toLocaleString('ko-KR')} JWD`
  return (
    <li className="fish-cell-slot">
      <button
        type="button"
        className={`fish-cell${f.locked ? ' fish-cell-locked' : ''}`}
        aria-label={`${speciesName(f.species)} ${f.sizeCm}cm ${verb}${priceText === null ? '' : `, 예상 ${priceText}`}`}
        disabled={disabled}
        onClick={onClick}
      >
        {f.locked && <span className="fish-cell-lock" aria-hidden="true" />}
        {known(f.species) && <img src={spriteDataUrl(`fish-${f.species}`, ICON_SCALE)} alt="" />}
        <span className="fish-cell-size">{f.sizeCm}cm</span>
        {priceText !== null && <span className="fish-cell-price">{priceText}</span>}
      </button>
    </li>
  )
}

export function FridgePanel({ view, busy, onStore, onTakeOut }: Props) {
  // 옛 서버 응답(v17 이하)에는 냉장고가 없다
  const fridge = view.fridge ?? []
  // 옛 서버 응답(buffs 없음)은 빈 목록
  const buffs = view.buffs ?? []
  const off = busy || view.pending !== null
  const fridgeFull = fridge.length >= FRIDGE_SIZE
  const bagFull = view.bag.length >= bagSize(view.bagTier)
  return (
    <section className="fish-panel-body fish-fridge" aria-label="냉장고">
      <h3 className="fish-panel-sub">{`냉장고 ${fridge.length}/${FRIDGE_SIZE}`}</h3>
      {view.pending !== null && <p className="fish-shop-note">낚시를 마친 뒤에 쓸 수 있어요</p>}
      {fridgeFull && <p className="fish-shop-note">냉장고가 가득 찼어요</p>}
      {fridge.length === 0 ? (
        <p className="muted">냉장고가 비어 있어요</p>
      ) : (
        <ul className="fish-bag">
          {fridge.map((f, i) => <FishRow key={i} f={f} buffs={buffs} verb="꺼내기" disabled={off || bagFull} onClick={() => onTakeOut(i)} />)}
        </ul>
      )}
      {bagFull && fridge.length > 0 && <p className="fish-shop-note">가방이 가득 차서 꺼낼 수 없어요</p>}
      <h3 className="fish-panel-sub">{`가방 ${view.bag.length}/${bagSize(view.bagTier)}`}</h3>
      {view.bag.length === 0 ? (
        <p className="muted">가방이 비어 있어요</p>
      ) : (
        <ul className="fish-bag">
          {view.bag.map((f, i) => <FishRow key={i} f={f} buffs={buffs} verb="넣기" disabled={off || fridgeFull} onClick={() => onStore(i)} />)}
        </ul>
      )}
    </section>
  )
}
