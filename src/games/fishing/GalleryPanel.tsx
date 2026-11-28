// 낚시 경제 P2~P4 화면(경제 설계 r4 §2.2·2.4·2.5): 영구 전시, 지역 재료, 포션, 전시관 확장, 완료 후 목표·테마.
// 값과 규칙은 서버 view(gallery)와 gallery.ts를 그대로 보여 주고, 행동은 onAct로만 올린다. 기능 플래그가 꺼져 있으면 Game이 그리지 않는다.
import { SPECIES } from './data.ts'
import {
  ADV_CALM_ALT, ADV_POTIONS, CALM_ALT, DONATE_NEED, EXPANSIONS, MAT_AREAS, POTION_IDS, POTIONS, PROJECTS, SPECIAL_IDS, THEMES,
  expansionMats, exhibitFee, hasMats, newGallery, stageB, stageC, type Gallery, type MatArea, type PotionId, type Recipe,
} from './gallery.ts'
import type { Action, View } from './logic.ts'

const gold = (n: number) => `${n.toLocaleString('ko-KR')} JWD`
const AREA_NAMES: Record<MatArea, string> = { village: '마을', river: '강', forest: '숲', lake: '산 호수', cave: '동굴', island: '섬', tideflat: '갯벌', swamp: '늪지', summit: '산정', wreck: '난파선' }
const POTION_NAMES: Record<PotionId, string> = { luck: '행운 포션', gold: '금전 포션', calm: '안정 포션' }
const POTION_DESC: Record<PotionId, string> = {
  luck: '희귀 물고기가 더 잘 나와요(전설·신화 확률은 그대로)',
  gold: '켜진 동안 잡은 일반 물고기 판매가 +15%',
  calm: '찌 바가 조금 넓어져요',
}
const matsLabel = (m: Recipe['mats']) => Object.entries(m).map(([a, n]) => `${AREA_NAMES[a as MatArea]} ${n}`).join(' · ')
const minutes = (ms: number) => `${Math.ceil(ms / 60_000)}분`
export const galleryOf = (view: Pick<View, 'gallery'>): Gallery => view.gallery ?? newGallery()

type Props = { view: View; busy: boolean; onAct(a: Action, done: string): void }

export function GalleryPanel({ view, busy, onAct }: Props) {
  const g = galleryOf(view)
  const B = stageB(g)
  const C = stageC(g)
  const can = (r: Recipe) => hasMats(g.mats, r.mats) && view.gold >= r.gold
  return (
    <section className="fish-panel-body" aria-label="전시관">
      <p className="muted">{`전시 ${g.exhibits.length}/${SPECIAL_IDS.length} · ${C ? '13종 전시 완료' : B ? '첫 신화 전시 완료: 재료·포션·확장이 열렸어요' : '첫 신화를 전시하면 재료·포션·확장이 열려요'}`}</p>

      <h3 className="fish-panel-sub">영구 전시</h3>
      <ul className="fish-rods" aria-label="전시">
        {SPECIAL_IDS.map((id) => {
          const s = SPECIES.find((x) => x.id === id)!
          const found = view.legends.includes(id)
          const shown = g.exhibits.includes(id)
          const n = g.donated[id] ?? 0
          const fee = exhibitFee(id)!
          return (
            <li key={id} className={`fish-rod${shown ? ' fish-rod-owned' : ''}`}>
              <div className="fish-rod-info">
                <strong>{found ? s.name : '???'}</strong>
                <span className="muted">{shown ? '전시 중' : !found ? '아직 발견하지 않았어요' : `기증 ${n}/${DONATE_NEED} · 전시료 ${gold(fee)}`}</span>
              </div>
              {found && !shown && (
                <button type="button" className="btn btn-primary btn-sm" aria-label={`${s.name} 전시`} disabled={busy || n < DONATE_NEED || view.gold < fee} onClick={() => onAct({ type: 'exhibit', species: id, price: fee }, `${s.name}을(를) 전시했어요`)}>
                  전시
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="muted">연구로 다시 잡은 물고기를 가방 "기증" 모드에서 2마리 기증하면 전시할 수 있어요</p>

      {B && (
        <>
          <h3 className="fish-panel-sub">지역 재료</h3>
          <p className="muted">{MAT_AREAS.map((a) => `${AREA_NAMES[a]} ${g.mats[a] ?? 0}`).join(' · ')}</p>
          <p className="muted">가방 "재료" 모드에서 일반 물고기를 그 지역 재료로 바꿔요(흔함 1·드묾 2·희귀 3)</p>

          <h3 className="fish-panel-sub">포션</h3>
          <ul className="fish-rods" aria-label="포션">
            {POTION_IDS.map((id) => {
              const left = g.potions[id] ?? 0
              const recipes: { r: Recipe; label: string; a: Action }[] = [
                { r: POTIONS[id], label: '만들어 마시기', a: { type: 'brew', potion: id, price: POTIONS[id].gold } },
                ...(id === 'calm' ? [{ r: CALM_ALT, label: '산정 재료로', a: { type: 'brew', potion: id, price: CALM_ALT.gold, alt: true } as Action }] : []),
                ...(C ? [{ r: ADV_POTIONS[id], label: '3병 만들기', a: { type: 'brew', potion: id, price: ADV_POTIONS[id].gold, adv: true } as Action }] : []),
                ...(C && id === 'calm' ? [{ r: ADV_CALM_ALT, label: '3병(산정)', a: { type: 'brew', potion: id, price: ADV_CALM_ALT.gold, adv: true, alt: true } as Action }] : []),
              ]
              return (
                <li key={id} className="fish-rod">
                  <div className="fish-rod-info">
                    <strong>{`${POTION_NAMES[id]}${left > 0 ? ` · 남은 ${minutes(left)}` : ''}${(g.stock[id] ?? 0) > 0 ? ` · 보관 ${g.stock[id]}병` : ''}`}</strong>
                    <span className="muted">{`${POTION_DESC[id]} · ${recipes.map((x) => `${x.label} ${gold(x.r.gold)}(${matsLabel(x.r.mats)})`).join(' / ')}`}</span>
                  </div>
                  {recipes.map((x) => (
                    <button key={x.label} type="button" className="btn btn-primary btn-sm" aria-label={`${POTION_NAMES[id]} ${x.label}`} disabled={busy || !can(x.r)} onClick={() => onAct(x.a, `${POTION_NAMES[id]}: ${x.label}`)}>
                      {x.label}
                    </button>
                  ))}
                  {(g.stock[id] ?? 0) > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`${POTION_NAMES[id]} 마시기`} disabled={busy} onClick={() => onAct({ type: 'drink', potion: id }, `${POTION_NAMES[id]}을(를) 마셨어요`)}>
                      마시기
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="muted">포션 시간은 낚시하는 동안(던져서 거둘 때까지)만 줄어요</p>

          <h3 className="fish-panel-sub">{`전시관 확장 ${g.expansions}/${EXPANSIONS.length}`}</h3>
          {g.expansions < EXPANSIONS.length ? (() => {
            const stage = g.expansions + 1
            const e = EXPANSIONS[g.expansions]
            const r = { gold: e.gold, mats: expansionMats(stage) }
            return (
              <div className="fish-discard-confirm">
                <span>{`${stage}단계 ${gold(e.gold)} · ${matsLabel(r.mats)}`}</span>
                <button type="button" className="btn btn-primary btn-sm" aria-label={`전시관 ${stage}단계 확장`} disabled={busy || !can(r)} onClick={() => onAct({ type: 'expand', stage, price: e.gold }, `전시관을 ${stage}단계로 넓혔어요`)}>
                  확장
                </button>
              </div>
            )
          })() : <p className="muted">모두 넓혔어요</p>}
        </>
      )}

      {C && (
        <>
          <h3 className="fish-panel-sub">{`완료 후 목표 ${g.projects.length}/${PROJECTS.length}`}</h3>
          <ul className="fish-rods" aria-label="완료 후 목표">
            {PROJECTS.map((p) => {
              const owned = g.projects.includes(p.id)
              return (
                <li key={p.id} className={`fish-rod${owned ? ' fish-rod-owned' : ''}`}>
                  <div className="fish-rod-info">
                    <strong>{p.name}</strong>
                    <span className="muted">{owned ? '가지고 있어요' : `${gold(p.gold)} · ${matsLabel(p.mats)}`}</span>
                  </div>
                  {!owned && (
                    <button type="button" className="btn btn-primary btn-sm" aria-label={`${p.name} 사기`} disabled={busy || !can(p)} onClick={() => onAct({ type: 'buyProject', id: p.id, price: p.gold }, `${p.name}을(를) 샀어요`)}>
                      사기
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="fish-bag-modes" role="radiogroup" aria-label="테마">
            <button type="button" role="radio" aria-checked={g.theme === null} className={`btn btn-sm ${g.theme === null ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={() => onAct({ type: 'setTheme', theme: null }, '기본 테마로 바꿨어요')}>
              기본
            </button>
            {THEMES.filter((t) => g.projects.includes(`${t.id}-bg`)).map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={g.theme === t.id} className={`btn btn-sm ${g.theme === t.id ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={() => onAct({ type: 'setTheme', theme: t.id }, `${t.name} 테마로 바꿨어요`)}>
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
