// 밸런스 테스트용 봇. 틱마다 지금 상태를 보고 명령 하나(또는 null)를 고른다. 외부 의존 없음.
import { N_Q, PROG_MAX } from './constants.ts'
import { getExam, type Exam } from './exam.ts'
import { correctCount, scoreOf } from './logic.ts'
import { applyCmd, canApply, gainOf, initSim, step, type Cmd, type SimState } from './sim.ts'

/** 틱마다 불린다. known[i]는 문제 i의 공개된 정답, 아직이면 −1. null이면 명령 없음 */
export type Bot = (s: SimState, exam: Exam, known: number[]) => Cmd | null

// 지금 문제가 풀렸으면 마킹 → 다음 안 풀린 문제로 → 다 풀었으면 제출. 지금 문제가 안 풀렸으면 null.
function advance(s: SimState, known: number[]): Cmd | null {
  if (known[s.q] < 0) return null
  if (s.marks[s.q] !== known[s.q]) return ['m', s.q, known[s.q]]
  for (let k = 1; k < N_Q; k++) {
    const q = (s.q + k) % N_Q
    if (known[q] < 0) return ['q', q]
  }
  return ['x']
}

// 지금 도구에서 want로 바꾸는 명령. 다른 도구가 켜져 있으면 먼저 끄고, 숨기기가 끝난 뒤 켠다.
function switchTo(s: SimState, want: 0 | 1 | 2 | 3): Cmd | null {
  if (s.tool === want || s.stow > 0) return null
  return s.tool !== 0 ? ['t', 0] : ['t', want]
}

export const idleBot: Bot = () => null

export const recklessBot: Bot = (s, _exam, known) => (s.tool === 0 && s.stow === 0 ? ['t', 3] : advance(s, known))

const FAST_FIRST = [3, 2, 1] as const

function carefulTool(s: SimState, type: 0 | 1 | 2): 0 | 1 | 2 | 3 {
  for (const k of FAST_FIRST) if (gainOf({ ...s, tool: k }, type) === 0) return k
  if (s.susp < 2000) for (const k of FAST_FIRST) if (gainOf({ ...s, tool: k }, type) <= 10) return k
  return 0
}

export const carefulBot: Bot = (s, exam, known) => {
  const want = carefulTool(s, exam.proctorType)
  // 끄기는 마킹보다 먼저(노출을 한 틱이라도 줄인다), 켜기는 마킹·넘기기 다음.
  if (s.tool !== 0 && s.stow === 0 && s.tool !== want) return ['t', 0]
  return advance(s, known) ?? switchTo(s, want)
}

// 안경만 쓴다. 켜 두면 의심을 사는 상황이면 끈다. 의심도가 낮을 때는 아주 약한 노출(틱당 10 이하)은 감수한다.
export const glassesBot: Bot = (s, exam, known) => {
  const g = gainOf({ ...s, tool: 1 }, exam.proctorType)
  const risky = g > 10 || (g > 0 && s.susp >= 3000)
  if (risky && s.tool === 1) return ['t', 0]
  return advance(s, known) ?? (risky ? null : switchTo(s, 1))
}

/** lag > 0이면 봇은 감독관을 lag틱 전 모습으로 본다(사람의 반응 지연 흉내). 자기 도구·진행 상태는 지금 그대로다. */
export function runBot(seed: string, bot: Bot, lag = 0): { sim: SimState; score: number; correct: number } {
  const exam = getExam(seed)
  let sim = initSim(exam)
  const seen = [sim.proctor]
  while (sim.end === null) {
    const known = sim.prog.map((p, i) => (p === PROG_MAX ? exam.answers[i] : -1))
    const view = lag > 0 ? { ...sim, proctor: seen[Math.max(0, seen.length - 1 - lag)] } : sim
    const cmd = bot(view, exam, known)
    if (cmd !== null && canApply(sim, cmd)) sim = applyCmd(sim, cmd)
    if (sim.end === null) sim = step(sim, exam)
    if (lag > 0) seen.push(sim.proctor)
  }
  return { sim, score: scoreOf(sim, exam), correct: correctCount(sim, exam) }
}
