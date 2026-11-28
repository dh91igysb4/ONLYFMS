// 낚시 경제 P1 화면(경제 설계 r4 §2.2): 어분·미끼 만들기, 연구 해금, 다음 투척에 쓸 미끼·대상 고르기.
// 값과 규칙은 서버 view(econ)와 research.ts를 그대로 보여 주고, 행동은 콜백으로만 올린다. 기능 플래그가 꺼져 있으면 Game이 그리지 않는다.
import { SPECIES } from './data.ts'
import { BAIT_RECIPES, LICENSE_PRICE, newEcon, type BaitKind, type Econ } from './research.ts'
import type { View } from './logic.ts'

const gold = (n: number) => `${n.toLocaleString('ko-KR')} G`
const BAIT_NAMES: Record<BaitKind, string> = { attractor: '집어 미끼', legend: '전설 미끼', mythic: '신화 미끼' }
const BAIT_DESC: Record<BaitKind, string> = {
  attractor: '다음 투척 한 번, 희귀 물고기가 조금 더 잘 나와요(전설·신화 확률은 그대로)',
  legend: '발견한 전설을 골라 다시 낚아요. 50번째 투척엔 꼭 입질해요',
  mythic: '발견한 신화를 골라 다시 낚아요. 100번째 투척엔 꼭 입질해요',
}
export type CastBait = { bait: BaitKind; target?: string }

type Props = {
  view: View
  busy: boolean
  /** 연구(전설·신화 미끼·해금)까지 보여 줄지(플래그 research) */
  research: boolean
  selected: CastBait | null
  onSelect(b: CastBait | null): void
  onMake(kind: BaitKind): void
  onLicense(): void
}

export const econOf = (view: Pick<View, 'econ'>): Econ => view.econ ?? newEcon()

export function EconSection({ view, busy, research, selected, onSelect, onMake, onLicense }: Props) {
  const e = econOf(view)
  const found = (rarity: 'legend' | 'mythic') => SPECIES.filter((s) => s.rarity === rarity && view.legends.includes(s.id))
  const kinds: BaitKind[] = research ? ['attractor', 'legend', 'mythic'] : ['attractor']
  const canMake = (k: BaitKind) => {
    const r = BAIT_RECIPES[k]
    if (e.meal < r.meal || view.gold < r.gold) return false
    return k === 'attractor' || (e.license && found(k).length > 0)
  }
  const pity = (id: string) => e.pity[id] ?? 0
  return (
    <div className="fish-gear" role="group" aria-label="미끼·연구">
      <h3 className="fish-panel-sub">미끼·연구</h3>
      <p className="muted">{`어분 ${e.meal}개 · 일반 물고기를 "어분" 모드로 갈아 만들어요`}</p>
      {research && !e.license && (
        <div className="fish-discard-confirm">
          <span>{`연구 해금 ${gold(LICENSE_PRICE)} · 발견한 전설·신화를 다시 낚을 수 있어요`}</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || found('legend').length === 0 || view.gold < LICENSE_PRICE} onClick={onLicense}>
            해금
          </button>
          {found('legend').length === 0 && <span className="muted">전설을 하나 발견하면 열려요</span>}
        </div>
      )}
      <ul className="fish-rods" aria-label="미끼">
        {kinds.map((k) => {
          const r = BAIT_RECIPES[k]
          return (
            <li key={k} className="fish-rod">
              <div className="fish-rod-info">
                <strong>{`${BAIT_NAMES[k]} ${e.baits[k]}개`}</strong>
                <span className="muted">{`${BAIT_DESC[k]} · ${gold(r.gold)} + 어분 ${r.meal}`}</span>
              </div>
              <button type="button" className="btn btn-primary btn-sm" aria-label={`${BAIT_NAMES[k]} 만들기`} disabled={busy || !canMake(k)} onClick={() => onMake(k)}>
                만들기
              </button>
            </li>
          )
        })}
      </ul>
      <h3 className="fish-panel-sub">다음 투척</h3>
      <div className="fish-bag-modes" role="radiogroup" aria-label="다음 투척에 쓸 미끼">
        <button type="button" role="radio" aria-checked={!selected} className={`btn btn-sm ${!selected ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onSelect(null)}>
          미끼 없음
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={selected?.bait === 'attractor'}
          className={`btn btn-sm ${selected?.bait === 'attractor' ? 'btn-primary' : 'btn-ghost'}`}
          disabled={e.baits.attractor < 1}
          onClick={() => onSelect({ bait: 'attractor' })}
        >
          집어 미끼
        </button>
      </div>
      {research && e.license && (['legend', 'mythic'] as const).map((k) =>
        found(k).length > 0 ? (
          <ul key={k} className="fish-rods" aria-label={`${BAIT_NAMES[k]} 대상`}>
            {found(k).map((s) => {
              const on = selected?.bait === k && selected.target === s.id
              const g = k === 'mythic' ? 100 : 50
              return (
                <li key={s.id} className={`fish-rod${on ? ' fish-rod-owned' : ''}`}>
                  <div className="fish-rod-info">
                    <strong>{s.name}</strong>
                    <span className="muted">{`보장까지 ${Math.max(0, g - pity(s.id))}번 · 지역·자리·힘은 그대로, 계절·시간·날씨는 상관없어요`}</span>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" aria-pressed={on} aria-label={`${s.name} 연구`} disabled={!on && e.baits[k] < 1} onClick={() => onSelect(on ? null : { bait: k, target: s.id })}>
                    {on ? '선택됨' : '고르기'}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null,
      )}
    </div>
  )
}
