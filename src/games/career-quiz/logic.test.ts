import { describe, expect, test } from 'vitest'
import { HINT_PENALTY, initialsOf, logic, MAX_TRIES, type Action, type Puzzle, type State } from './logic.ts'
import { manifest } from './manifest.ts'
import { QUIZ } from './data.ts'

const ctx = { now: 0, startedAt: 0, deadline: null }
const P: Puzzle = {
  id: 'Q615', nameKo: '리오넬 메시', nameEn: 'Lionel Messi', tier: 'easy', mode: 'normal',
  lines: [[2004, 2021, 'FC Barcelona', 0], [2021, 2023, 'Paris Saint-Germain FC', 0], [2023, null, 'Inter Miami CF', 0]],
}
const C: Puzzle = { ...P, mode: 'challenge' }
const wrong = (n: number): Action => ({ type: 'guess', id: `Q${9000 + n}`, name: `선수${n}` })
const right: Action = { type: 'guess', id: 'Q615', name: '메시' }

function run(p: Puzzle, ...actions: Action[]): State {
  let s = logic.initState(p, ctx)
  for (const a of actions) {
    const r = logic.apply(p, s, a, ctx)
    if ('error' in r) throw new Error(r.error)
    s = r.state
  }
  return s
}
const err = (p: Puzzle, s: State, a: Action) => {
  const r = logic.apply(p, s, a, ctx)
  return 'error' in r ? r.error : null
}

describe('career-quiz data', () => {
  test('난이도 값이 manifest 선택지와 같고, 문제마다 1군 경력이 있다', () => {
    const tiers = manifest.options.find((o) => o.key === 'tier')!.choices.map((c) => c.value)
    expect(new Set(QUIZ.map((q) => q[3]))).toEqual(new Set(tiers))
    expect(new Set(QUIZ.map((q) => q[0])).size).toBe(QUIZ.length)
    for (const [id, nameKo, , , lines] of QUIZ) {
      expect(id).toMatch(/^Q\d+$/)
      expect(nameKo, id).not.toBe('')
      expect(new Set(lines.map((l) => l[2])).size, id).toBeGreaterThanOrEqual(1)
    }
  })

  test('pickPuzzle은 고른 난이도·모드에서 고른다', () => {
    const p = logic.pickPuzzle(() => 0.5, { tier: 'hard', mode: 'challenge' })
    expect(p.tier).toBe('hard')
    expect(p.mode).toBe('challenge')
    expect(QUIZ.find((q) => q[0] === p.id)?.[3]).toBe('hard')
    expect(logic.pickPuzzle(() => 0.999, {}).mode).toBe('normal')
    expect(logic.puzzleKey(p)).toBe(p.id)
  })
})

describe('career-quiz 일반 모드', () => {
  test('처음부터 전부 보이고, 맞히면 11 − 쓴 기회', () => {
    const s0 = run(P)
    expect(logic.publicState(s0).lines.every((l) => l[2] !== null)).toBe(true)
    expect(logic.score(run(P, right), ctx)).toBe(10)
    const s = run(P, wrong(1), wrong(2), right)
    expect(s.won).toBe(true)
    expect(s.guesses[2].name).toBe('Lionel Messi')
    expect(logic.score(s, ctx)).toBe(8)
    expect(logic.actionCount(s)).toBe(3)
    expect(logic.isFinished(s, ctx)).toBe(true)
  })

  test('줄 열기는 챌린지만', () => {
    expect(err(P, run(P), { type: 'open' })).toMatch(/챌린지/)
  })

  test('8번 틀리면 끝, 0점', () => {
    const s = run(P, ...Array.from({ length: MAX_TRIES }, (_, i) => wrong(i)))
    expect(logic.isFinished(s, ctx)).toBe(true)
    expect(logic.score(s, ctx)).toBe(0)
    expect(err(P, s, right)).toMatch(/끝난/)
  })

  test('잘못된 답·중복', () => {
    const s = run(P, wrong(1))
    expect(err(P, s, wrong(1))).toMatch(/이미/)
    expect(err(P, s, { type: 'guess', id: 'abc', name: 'x' })).toMatch(/목록/)
    expect(err(P, s, { type: 'guess', id: 'Q1', name: ' ' })).toMatch(/목록/)
  })

  test('포기하면 0점', () => {
    const s = run(P, { type: 'give_up' } as unknown as Action)
    expect(logic.isFinished(s, ctx)).toBe(true)
    expect(logic.score(s, ctx)).toBe(0)
  })
})

describe('career-quiz 챌린지 모드', () => {
  test('첫 줄만 열리고, 가린 줄은 연도만 보낸다', () => {
    const pub = logic.publicState(run(C))
    expect(pub.opened).toBe(1)
    expect(pub.lines).toEqual([[2004, 2021, 'FC Barcelona', 0], [2021, 2023, null, null], [2023, null, null, null]])
    expect(JSON.stringify(pub)).not.toContain('Paris')
  })

  test('틀리면 다음 줄이 열리고, 첫 줄만 보고 맞히면 10점', () => {
    expect(logic.score(run(C, right), ctx)).toBe(10)
    const s = run(C, wrong(1))
    expect(s.opened).toBe(2)
    expect(logic.score(run(C, wrong(1), right), ctx)).toBe(9)
  })

  test('버튼으로 열면 기회를 쓰고, 다 열리면 더 못 연다', () => {
    const s = run(C, { type: 'open' }, { type: 'open' })
    expect(s.opened).toBe(3)
    expect(s.opens).toBe(2)
    expect(err(C, s, { type: 'open' })).toMatch(/모든 줄/)
    const t = run(C, { type: 'open' }, { type: 'open' }, wrong(1), right)
    expect(t.opened).toBe(3)
    expect(logic.score(t, ctx)).toBe(8)
    expect(logic.actionCount(t)).toBe(4)
  })

  test('열기와 답을 합쳐 8번', () => {
    const s = run(C, { type: 'open' }, { type: 'open' }, ...Array.from({ length: 6 }, (_, i) => wrong(i)))
    expect(logic.isFinished(s, ctx)).toBe(true)
  })
})

describe('career-quiz 이니셜 힌트', () => {
  test('선수를 3번 답한 뒤 한 번, 3점 감점, 최저 1점', () => {
    expect(initialsOf('Lionel Messi')).toBe('L. M.')
    expect(err(P, run(P, wrong(1), wrong(2)), { type: 'hint' })).toMatch(/3번/)
    // 줄 열기는 세지 않는다
    expect(err(C, run(C, { type: 'open' }, wrong(1), wrong(2)), { type: 'hint' })).toMatch(/3번/)
    const s = run(P, wrong(1), wrong(2), wrong(3), { type: 'hint' })
    expect(s.initials).toBe('L. M.')
    expect(err(P, s, { type: 'hint' })).toMatch(/한 번/)
    expect(logic.score(run(P, wrong(1), wrong(2), wrong(3), { type: 'hint' }, right), ctx)).toBe(7 - HINT_PENALTY)
    const late = run(P, ...Array.from({ length: 7 }, (_, i) => wrong(i)), { type: 'hint' }, right)
    expect(logic.score(late, ctx)).toBe(1)
  })
})

test('reveal은 정답과 전체 경력', () => {
  expect(logic.reveal(C)).toEqual({ id: 'Q615', nameKo: '리오넬 메시', nameEn: 'Lionel Messi', lines: C.lines })
})
