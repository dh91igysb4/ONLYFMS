import { Fragment, useState } from 'react'
import type { DuelGameProps } from '../ui.ts'
import type { YAction, YState } from './logic.ts'
import { allowed, CATEGORIES, scoreFor, total, type Category, type Sheet } from './scoring.ts'
import './yacht.css'

const LABEL: Record<Category, string> = {
  aces: '에이스',
  twos: '투',
  threes: '쓰리',
  fours: '포',
  fives: '파이브',
  sixes: '식스',
  choice: '초이스',
  threeKind: '3 오브 어 카인드',
  fourKind: '4 오브 어 카인드',
  fullHouse: '풀 하우스',
  smallStraight: '스몰 스트레이트',
  largeStraight: '라지 스트레이트',
  yacht: '요트',
}

const UPPER = CATEGORIES.slice(0, 6)
const upperSum = (s: Sheet) => UPPER.reduce((a, c) => a + (s[c] ?? 0), 0)

// 3x3 칸 번호(0~8) 중 눈마다 점이 찍히는 자리
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

function Face({ value }: { value: number | null }) {
  return (
    <svg className="yacht-face" viewBox="0 0 60 60" aria-hidden="true">
      {value !== null && (PIPS[value] ?? []).map((p) => (
        <circle key={p} cx={15 + (p % 3) * 15} cy={15 + Math.floor(p / 3) * 15} r="5" className="yacht-pip" />
      ))}
    </svg>
  )
}

export function Game({ view, mySeat, toMove, finished, busy, error, onAction, names }: DuelGameProps) {
  const v = view as YState
  const turnKey = v.sheets.reduce((n, s) => n + Object.keys(s).length, 0)
  const [keptState, setKept] = useState<{ k: number; idx: number[] }>({ k: turnKey, idx: [] })
  const kept = keptState.k === turnKey && v.rolls > 0 ? keptState.idx : []

  const mine = !finished && !busy && mySeat !== null && toMove === mySeat && v.seat === mySeat
  const rolled = v.rolls > 0
  const canKeep = mine && rolled && v.rolls < 3
  const canRoll = mine && v.rolls < 3
  const can: Category[] = mine && rolled && mySeat !== null ? allowed(v.dice, v.sheets[mySeat]) : []

  function toggle(i: number) {
    if (!canKeep) return
    setKept({ k: turnKey, idx: kept.includes(i) ? kept.filter((x) => x !== i) : [...kept, i].sort((a, b) => a - b) })
  }

  const slots = [0, 1, 2, 3, 4]
  return (
    <div className="yacht">
      <div className="yacht-dice" role="group" aria-label="주사위">
        {slots.map((i) => {
          const val = rolled ? v.dice[i] : null
          const on = kept.includes(i)
          return (
            <button
              key={i}
              type="button"
              className={`yacht-die${on ? ' yacht-kept' : ''}`}
              aria-pressed={on}
              aria-label={val === null ? '주사위, 아직 굴리지 않음' : `주사위 ${val}${on ? ', 고정됨' : ''}`}
              disabled={!canKeep}
              onClick={() => toggle(i)}
            >
              <Face value={val} />
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="btn btn-primary yacht-roll"
        disabled={!canRoll}
        onClick={() => onAction({ type: 'roll', keep: v.rolls === 0 ? [] : kept } satisfies YAction)}
      >
        굴리기 ({v.rolls}/3)
      </button>
      {mine && rolled && <p className="muted yacht-hint">고정할 주사위를 눌러 두고 다시 굴리거나, 칸을 골라 기록하세요</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <table className="yacht-sheet">
        <thead>
          <tr>
            <th scope="col"><span className="yacht-vh">칸</span></th>
            {names.map((n, s) => (
              <th key={s} scope="col" className={!finished && v.seat === s ? 'yacht-active' : ''} aria-current={!finished && v.seat === s ? 'true' : undefined}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c, ci) => (
            <Fragment key={c}>
              <tr>
                <th scope="row">{LABEL[c]}</th>
                {[0, 1].map((s) => {
                  const done = v.sheets[s][c]
                  if (done !== undefined) return <td key={s} className="yacht-done">{done}</td>
                  if (s === mySeat && can.includes(c)) {
                    const pts = scoreFor(v.dice, c, v.sheets[s])
                    return (
                      <td key={s}>
                        <button
                          type="button"
                          className="yacht-cell"
                          aria-label={`${LABEL[c]} 칸에 ${pts}점 기록`}
                          disabled={!mine}
                          onClick={() => onAction({ type: 'score', category: c } satisfies YAction)}
                        >
                          {pts}
                        </button>
                      </td>
                    )
                  }
                  return <td key={s} className="yacht-empty">·</td>
                })}
              </tr>
              {ci === 5 && (
                <tr key="upper" className="yacht-sub">
                  <th scope="row">위 칸 합 (63↑ 보너스)</th>
                  {[0, 1].map((s) => <td key={s}>{upperSum(v.sheets[s])}/63</td>)}
                </tr>
              )}
              {ci === 5 && (
                <tr key="bonus" className="yacht-sub">
                  <th scope="row">위 칸 보너스</th>
                  {[0, 1].map((s) => <td key={s} data-testid={`bonus-${s}`}>{upperSum(v.sheets[s]) >= 63 ? 35 : 0}</td>)}
                </tr>
              )}
            </Fragment>
          ))}
          <tr className="yacht-sub">
            <th scope="row">추가 요트 보너스</th>
            {[0, 1].map((s) => <td key={s} data-testid={`yacht-bonus-${s}`}>{v.bonus[s]}</td>)}
          </tr>
          <tr className="yacht-total">
            <th scope="row">총점</th>
            {[0, 1].map((s) => <td key={s} data-testid={`total-${s}`}>{total(v.sheets[s], v.bonus[s])}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
