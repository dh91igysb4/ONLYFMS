// 낚시 경제 P1 화면(경제 설계 r4 §2.2): 어분·미끼 만들기, 연구 해금, 다음 투척에 쓸 미끼·대상 고르기.
// 값과 규칙은 서버 view(econ)와 research.ts를 그대로 보여 주고, 행동은 콜백으로만 올린다. 기능 플래그가 꺼져 있으면 Game이 그리지 않는다.
import { SPECIES } from './data.ts'
import { useState } from 'react'
import { AUTO_MEAL_MAX, BAIT_RECIPES, LICENSE_PRICE, maxBait, newEcon, type BaitKind, type Econ } from './research.ts'
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
  /** count는 최대로 만들기에서만(없으면 1개) */
  onMake(kind: BaitKind, count?: number): void
  onLicense(): void
  /** 자동 어분 기준 저장(G), null이면 끈다(v30) */
  onAutoMeal(price: number | null): void
  /** 전시관 열기(경제 P2, 플래그 exhibit). 없으면 버튼을 보이지 않는다 */
  onOpenGallery?(): void
}

export const econOf = (view: Pick<View, 'econ'>): Econ => view.econ ?? newEcon()

export function EconSection({ view, busy, research, selected, onSelect, onMake, onLicense, onAutoMeal, onOpenGallery }: Props) {
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
      {onOpenGallery && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenGallery}>
          전시관
        </button>
      )}
      <p className="muted">{`어분 ${e.meal}개 · 일반 물고기를 "어분" 모드로 갈아 만들어요`}</p>
      <AutoMeal current={e.autoMeal} busy={busy} onSave={onAutoMeal} />
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
          const n = canMake(k) ? maxBait(k, e.meal, view.gold) : 0
          return (
            <li key={k} className="fish-rod">
              <div className="fish-rod-info">
                <strong>{`${BAIT_NAMES[k]} ${e.baits[k]}개`}</strong>
                <span className="muted">{`${BAIT_DESC[k]} · ${gold(r.gold)} + 어분 ${r.meal}`}</span>
                {n > 1 && <span className="muted">{`최대 ${n}개 · ${gold(r.gold * n)} + 어분 ${r.meal * n}`}</span>}
              </div>
              <div className="fish-bait-actions">
                <button type="button" className="btn btn-primary btn-sm" aria-label={`${BAIT_NAMES[k]} 만들기`} disabled={busy || !canMake(k)} onClick={() => onMake(k)}>
                  만들기
                </button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`${BAIT_NAMES[k]} 최대 ${n}개 만들기`} disabled={busy || n < 2} onClick={() => onMake(k, n)}>
                  {n > 1 ? `최대 ${n}개` : '최대'}
                </button>
              </div>
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

/** 자동 어분(v30): 판매가 기준 이하 일반 물고기는 잡자마자 어분. 처음 잡은 어종·최대 크기 기록은 가방에 남는다 */
function AutoMeal({ current, busy, onSave }: { current: number | undefined; busy: boolean; onSave(price: number | null): void }) {
  const [text, setText] = useState(current !== undefined ? String(current) : '')
  const n = Number(text)
  const valid = text.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= AUTO_MEAL_MAX
  return (
    <div className="fish-auto-meal" role="group" aria-label="자동 어분">
      <span>
        <strong>자동 어분</strong> <span className="muted">{current !== undefined ? `켜짐 · ${gold(current)} 이하` : '꺼짐'}</span>
      </span>
      <span className="muted">판매가가 기준 이하인 일반 물고기는 잡자마자 어분이 돼요. 처음 잡은 어종·최대 크기 기록은 가방에 남겨요</span>
      <span className="fish-auto-meal-row">
        <input
          className="input input-sm"
          type="number"
          inputMode="numeric"
          min={1}
          max={AUTO_MEAL_MAX}
          step={1}
          aria-label="자동 어분 기준 판매가"
          placeholder="예: 100"
          value={text}
          onChange={(ev) => setText(ev.target.value)}
        />
        <span>G 이하</span>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !valid || n === current} onClick={() => onSave(n)}>
          저장
        </button>
        {current !== undefined && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setText(''); onSave(null) }}>
            끄기
          </button>
        )}
      </span>
    </div>
  )
}
