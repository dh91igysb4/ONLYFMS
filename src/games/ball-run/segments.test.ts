import { describe, expect, it } from 'vitest'
import { COL_MIN, GATE_H, PILLAR_H, SPEED_TABLE, V0, V_MAX } from './constants.ts'
import {
  DESCENTS, JOINT, OBSTACLES, PARSED, PARSED_DESCENTS, PARSED_OBSTACLES, PARSED_TUNNELS, START, START_PARSED, TEMPLATES,
  TUNNELS, parseSegment,
} from './segments.ts'
import type { SegmentTemplate } from './segments.ts'

const at = (col: number) => col - COL_MIN

describe('parseSegment', () => {
  it('parses ramps per column', () => {
    const p = parseSegment({
      id: 't',
      kind: 'obstacle',
      tier: 1,
      rows: [JOINT, '._///_.', '._///_.', '._\\\\\\_.', '._\\\\\\_.', JOINT],
    })
    expect(p.length).toBe(6)
    expect(p.cells[1][at(0)].floor).toEqual({ h0: 0, h1: 250 })
    expect(p.cells[2][at(0)].floor).toEqual({ h0: 250, h1: 500 })
    expect(p.cells[3][at(0)].floor).toEqual({ h0: 500, h1: 250 })
    expect(p.dh).toBe(0)
    for (let r = 0; r < p.length; r++) {
      if (r === 0 || r === p.length - 1) continue
      expect(p.cells[r][at(-2)].floor).toEqual({ h0: 0, h1: 0 })
    }
  })

  it('holes keep column height', () => {
    const p = parseSegment({
      id: 't',
      kind: 'obstacle',
      tier: 1,
      rows: [JOINT, '._/___.', '._.___.', '._\\___.', JOINT],
    })
    expect(p.cells[2][at(-1)].floor).toBeNull()
    expect(p.cells[3][at(-1)].floor).toEqual({ h0: 250, h1: 0 })
  })

  it('block cell has floor and block', () => {
    const p = parseSegment({ id: 't', kind: 'obstacle', tier: 1, rows: [JOINT, '._B___.', JOINT] })
    expect(p.cells[1][at(-1)].floor).toEqual({ h0: 0, h1: 0 })
    expect(p.cells[1][at(-1)].block).toBe(true)
    expect(p.cells[1][at(0)].block).toBe(false)
  })

  it('rejects bad rows', () => {
    const mk = (rows: string[]) => () => parseSegment({ id: 't', kind: 'obstacle', tier: 1, rows })
    expect(mk([JOINT, '._____', JOINT])).toThrow()
    expect(mk([JOINT, '._x___.', JOINT])).toThrow()
    expect(mk(['_______', '._____.', JOINT])).toThrow()
    expect(mk([JOINT, '._____.', '._____B'])).toThrow()
    expect(mk([JOINT, '._/___.', JOINT])).toThrow()
  })

  it('tunnel rule: only floor cells inside a tunnel', () => {
    const mk = (rows: string[]) => () => parseSegment({ id: 't', kind: 'tunnel', tier: 2, rows })
    for (const ch of ['.', '/', '\\', '!', 'v', '<', '>', 'B', 'P', 'G']) {
      expect(mk([JOINT, `__${ch}____`, JOINT]), ch).toThrow()
    }
    expect(mk([JOINT, '_______', JOINT])).not.toThrow()
  })

  it('steep and ledge', () => {
    const J = JOINT
    const p = parseSegment({ id: 't', kind: 'obstacle', tier: 1, rows: [J, '.!!!!!.', '.vvvvv.', J] })
    expect(p.cells[1][at(0)].floor).toEqual({ h0: 0, h1: -500 })
    expect(p.cells[2][at(0)].floor).toEqual({ h0: -1500, h1: -1500 })
    expect(p.dh).toBe(-1500)
  })

  it('bank cells', () => {
    const p = parseSegment({ id: 't', kind: 'obstacle', tier: 1, rows: [JOINT, '.<<_>>.', JOINT] })
    const row = p.cells[1]
    expect(row[at(-2)].bank).toBe(-1)
    expect(row[at(-1)].bank).toBe(-1)
    expect(row[at(0)].bank).toBeUndefined()
    expect(row[at(1)].bank).toBe(1)
    expect(row[at(2)].bank).toBe(1)
    for (const c of [-2, -1, 0, 1, 2]) expect(row[at(c)].floor).toEqual({ h0: 0, h1: 0 })
  })

  it('pillar and gate heights', () => {
    const p = parseSegment({ id: 't', kind: 'obstacle', tier: 1, rows: [JOINT, '.P_G_G.', '.B____.', JOINT] })
    const row = p.cells[1]
    expect(row[at(-2)].block).toBe(true)
    expect(row[at(-2)].blockH).toBe(PILLAR_H)
    expect(row[at(0)].blockH).toBe(GATE_H)
    expect(row[at(2)].blockH).toBe(GATE_H)
    expect(p.cells[2][at(-2)].block).toBe(true)
    expect(p.cells[2][at(-2)].blockH).toBeUndefined()
  })
})

describe('templates', () => {
  it('all templates are valid', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(20)
    for (const t of [START, ...TEMPLATES]) expect(() => parseSegment(t)).not.toThrow()
    const ids = [START, ...TEMPLATES].map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const tier of [1, 2, 3, 4]) {
      expect(TEMPLATES.filter((t) => t.tier === tier).length).toBeGreaterThanOrEqual(4)
    }
    expect(PARSED.length).toBe(TEMPLATES.length)
    expect(START_PARSED.length).toBe(24)
    expect(START.kind).toBe('tunnel')
    expect(START.id).toBe('start')
    expect(START.tier).toBe(1)
  })

  it('every template starts and ends with the joint', () => {
    for (const t of [START, ...TEMPLATES]) {
      expect(t.rows[0]).toBe(JOINT)
      expect(t.rows[t.rows.length - 1]).toBe(JOINT)
    }
  })

  it('start has no blocks or holes in the track', () => {
    for (const row of START_PARSED.cells) {
      for (let c = -2; c <= 2; c++) {
        expect(row[at(c)].floor).not.toBeNull()
        expect(row[at(c)].block).toBe(false)
      }
    }
  })

  it('tunnel segments never leave the floor', () => {
    const tunnels = [START, ...TEMPLATES].filter((t) => t.kind === 'tunnel')
    expect(tunnels.length).toBeGreaterThanOrEqual(1)
    for (const t of tunnels) {
      for (const row of t.rows.slice(1, -1)) expect(row).toMatch(/^_+$/)
    }
  })

  it('holes right after a ramp (jumps) are at most 2 rows long', () => {
    let jumps = 0
    for (const t of TEMPLATES) {
      for (let c = 0; c < 7; c++) {
        const col = t.rows.map((row) => row[c]).join('')
        for (const m of col.matchAll(/\/(\.+)/g)) {
          jumps++
          expect(m[1].length, `${t.id} col ${c}`).toBeLessThanOrEqual(2)
        }
      }
    }
    expect(jumps).toBeGreaterThan(0)
  })
})

describe('pools', () => {
  const isFloor = (ch: string | undefined) => ch !== undefined && ch !== '.' && ch !== 'B' && ch !== 'P' && ch !== 'G'
  // 바닥 칸이 양옆 모두 바닥이 아닌 1칸 폭 길이 둘 이상인 행
  const railRow = (row: string) => {
    let n = 0
    for (let i = 0; i < row.length; i++) if (isFloor(row[i]) && !isFloor(row[i - 1]) && !isFloor(row[i + 1])) n++
    return n >= 2
  }
  // 트랙 양끝(구멍이 아닌 첫·마지막 칸)이 블록이고 그 사이에 바닥이 있는 행
  const wallRow = (row: string) => /^\.*[BPG]+[_<>]+[BPG]+\.*$/.test(row)
  const runOf = (t: SegmentTemplate, f: (row: string) => boolean, n: number) => {
    let run = 0
    for (const row of t.rows) {
      run = f(row) ? run + 1 : 0
      if (run >= n) return true
    }
    return false
  }

  it('union and kinds', () => {
    expect(TEMPLATES).toEqual([...TUNNELS, ...DESCENTS, ...OBSTACLES])
    expect(PARSED.map((p) => p.id)).toEqual(TEMPLATES.map((t) => t.id))
    expect(PARSED_TUNNELS.map((p) => p.id)).toEqual(TUNNELS.map((t) => t.id))
    expect(PARSED_DESCENTS.map((p) => p.id)).toEqual(DESCENTS.map((t) => t.id))
    expect(PARSED_OBSTACLES.map((p) => p.id)).toEqual(OBSTACLES.map((t) => t.id))
    for (const t of TUNNELS) expect(t.kind).toBe('tunnel')
    for (const t of DESCENTS) expect(t.kind).toBe('descent')
    for (const t of OBSTACLES) expect(t.kind).toBe('obstacle')
    expect(TEMPLATES.some((t) => t.id === START.id)).toBe(false)
  })

  it('tunnels: at least 2, 14..18 rows', () => {
    expect(TUNNELS.length).toBeGreaterThanOrEqual(2)
    for (const p of PARSED_TUNNELS) {
      expect(p.length, p.id).toBeGreaterThanOrEqual(14)
      expect(p.length, p.id).toBeLessThanOrEqual(18)
    }
  })

  it('descents: at least 4, each drops 4 m or more', () => {
    expect(DESCENTS.length).toBeGreaterThanOrEqual(4)
    for (const p of PARSED_DESCENTS) expect(p.dh, p.id).toBeLessThanOrEqual(-4000)
  })

  it('obstacles: 4+ per tier, 20+ total, never climb overall', () => {
    expect(OBSTACLES.length).toBeGreaterThanOrEqual(20)
    for (const tier of [1, 2, 3, 4]) expect(OBSTACLES.filter((t) => t.tier === tier).length, `tier ${tier}`).toBeGreaterThanOrEqual(4)
    for (const p of PARSED_OBSTACLES) expect(p.dh, p.id).toBeLessThanOrEqual(0)
  })

  it('obstacles use pillars, gates, banks, rails and walled corridors', () => {
    const uses = (f: (t: SegmentTemplate) => boolean) => OBSTACLES.filter(f).map((t) => t.id)
    expect(uses((t) => t.rows.some((r) => r.includes('P')))).not.toEqual([])
    expect(uses((t) => t.rows.some((r) => r.includes('G')))).not.toEqual([])
    expect(uses((t) => t.rows.some((r) => r.includes('<')) && t.rows.some((r) => r.includes('>')))).not.toEqual([])
    expect(uses((t) => runOf(t, railRow, 6))).not.toEqual([])
    expect(uses((t) => runOf(t, wallRow, 6))).not.toEqual([])
  })
})

describe('SPEED_TABLE', () => {
  it('matches formula', () => {
    expect(V0).toBe(200)
    const last = SPEED_TABLE.length - 1
    for (let k = 0; k <= last; k++) {
      const v = Number((BigInt(V0) * 106n ** BigInt(k)) / 100n ** BigInt(k))
      expect(SPEED_TABLE[k], `k=${k}`).toBe(Math.min(V_MAX, v))
    }
    expect(SPEED_TABLE[last]).toBe(V_MAX)
    expect(SPEED_TABLE[last - 1]).toBe(V_MAX)
    expect(SPEED_TABLE[last - 2]).toBeLessThan(V_MAX)
  })
})
