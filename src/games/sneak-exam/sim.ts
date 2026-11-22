// 몰래 수능 틱 시뮬: 의심도·도구·풀이 진행도·명령·종료 조건. 정수만 쓰고 입력 객체는 바꾸지 않는다.
import { MID2, ME_X, ME_Z, N_Q, NEAR2, PROCTORS, PROG_MAX, SUSP_DECAY, SUSP_MAX, TOOLS, TOTAL_TICKS } from './constants.ts'
import type { Exam } from './exam.ts'
import { initProctor, stepProctor, type Proctor } from './proctor.ts'

export type Cmd = ['t', number] | ['q', number] | ['m', number, number] | ['x']
export type End = null | 'submit' | 'timeout' | 'caught' | 'give_up'
export type SimState = {
  tick: number
  rng: number
  proctor: Proctor
  susp: number
  tool: 0 | 1 | 2 | 3
  stow: number
  q: number
  prog: number[]
  marks: number[]
  end: End
}

export function initSim(exam: Exam): SimState {
  return {
    tick: 0,
    rng: exam.rng0,
    proctor: initProctor(),
    susp: 0,
    tool: 0,
    stow: 0,
    q: 0,
    prog: Array(N_Q).fill(0),
    marks: Array(N_Q).fill(-1),
    end: null,
  }
}

// (x, z)에서 내 자리까지의 거리 구역. 0 near, 1 mid, 2 far.
export function zoneOf(x: number, z: number): 0 | 1 | 2 {
  const dx = ME_X - x
  const dz = ME_Z - z
  const d2 = dx * dx + dz * dz
  return d2 <= NEAR2 ? 0 : d2 <= MID2 ? 1 : 2
}

export function sees(p: Proctor): boolean {
  if (p.dozing) return false
  const px = ME_X - p.x
  const pz = ME_Z - p.z
  let along: number
  let side: number
  switch (p.face) {
    case 0: along = -pz; side = px; break
    case 1: along = pz; side = px; break
    case 2: along = -px; side = pz; break
    default: along = px; side = pz
  }
  return along > 0 && Math.abs(side) <= 2 * along
}

export function gainOf(s: SimState, type: 0 | 1 | 2): number {
  const tool = TOOLS[s.tool]
  if (!tool || s.proctor.dozing) return 0
  const z = zoneOf(s.proctor.x, s.proctor.z)
  const seen = sees(s.proctor)
  const base = seen ? tool.seen[z] : tool.blind[z]
  if (!seen || z !== 2) return base
  const spec = PROCTORS[type]
  return s.tool === 1 ? spec.glassesFar : base * spec.farMul
}

export function step(s: SimState, exam: Exam): SimState {
  if (s.end) return s
  const tick = s.tick + 1
  const pr = stepProctor(s.proctor, s.rng, exam.proctorType, s.susp)
  let n: SimState = { ...s, tick, proctor: pr.p, rng: pr.rng }
  const g = gainOf(n, exam.proctorType)
  const susp = g > 0 ? Math.min(SUSP_MAX, s.susp + g) : Math.max(0, s.susp - SUSP_DECAY)
  n = { ...n, susp }
  if (susp === SUSP_MAX) return { ...n, end: 'caught' }

  const tool = TOOLS[n.tool]
  if (tool && n.stow === 0 && n.prog[n.q] < PROG_MAX) {
    const prog = n.prog.slice()
    prog[n.q] = Math.min(PROG_MAX, prog[n.q] + tool.rate)
    n = { ...n, prog }
  }
  if (n.stow > 0) {
    const stow = n.stow - 1
    n = { ...n, stow, tool: stow === 0 ? 0 : n.tool }
  }
  if (tick >= TOTAL_TICKS) n = { ...n, end: 'timeout' }
  return n
}

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
}

export function parseCmd(c: unknown): Cmd | null {
  if (!Array.isArray(c)) return null
  if (c[0] === 't' && c.length === 2 && isInt(c[1], 0, 3)) return ['t', c[1]]
  if (c[0] === 'q' && c.length === 2 && isInt(c[1], 0, N_Q - 1)) return ['q', c[1]]
  if (c[0] === 'm' && c.length === 3 && isInt(c[1], 0, N_Q - 1) && isInt(c[2], -1, 4)) return ['m', c[1], c[2]]
  if (c[0] === 'x' && c.length === 1) return ['x']
  return null
}

export function canApply(s: SimState, cmd: Cmd): boolean {
  if (s.end !== null) return false
  if (cmd[0] === 't' && cmd[1] !== 0) return s.tool === 0 || (s.tool === cmd[1] && s.stow === 0)
  return true
}

export function applyCmd(s: SimState, cmd: Cmd): SimState {
  switch (cmd[0]) {
    case 't': {
      const k = cmd[1] as 0 | 1 | 2 | 3
      if (k !== 0) return s.tool === 0 ? { ...s, tool: k } : s
      const tool = TOOLS[s.tool]
      if (!tool || s.stow > 0) return s
      return tool.stow === 0 ? { ...s, tool: 0 } : { ...s, stow: tool.stow }
    }
    case 'q':
      return { ...s, q: cmd[1] }
    case 'm': {
      const marks = s.marks.slice()
      marks[cmd[1]] = cmd[2]
      return { ...s, marks }
    }
    default:
      return { ...s, end: 'submit' }
  }
}
