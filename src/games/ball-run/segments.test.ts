import { describe, expect, it } from 'vitest'
import { COL_MIN } from './constants.ts'
import { JOINT, PARSED, START, START_PARSED, TEMPLATES, parseSegment } from './segments.ts'

const at = (col: number) => col - COL_MIN

describe('parseSegment', () => {
  it('parses ramps per column', () => {
    const p = parseSegment({
      id: 't',
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
      tier: 1,
      rows: [JOINT, '._/___.', '._.___.', '._\\___.', JOINT],
    })
    expect(p.cells[2][at(-1)].floor).toBeNull()
    expect(p.cells[3][at(-1)].floor).toEqual({ h0: 250, h1: 0 })
  })

  it('block cell has floor and block', () => {
    const p = parseSegment({ id: 't', tier: 1, rows: [JOINT, '._B___.', JOINT] })
    expect(p.cells[1][at(-1)].floor).toEqual({ h0: 0, h1: 0 })
    expect(p.cells[1][at(-1)].block).toBe(true)
    expect(p.cells[1][at(0)].block).toBe(false)
  })

  it('rejects bad rows', () => {
    const mk = (rows: string[]) => () => parseSegment({ id: 't', tier: 1, rows })
    expect(mk([JOINT, '._____', JOINT])).toThrow()
    expect(mk([JOINT, '._x___.', JOINT])).toThrow()
    expect(mk(['_______', '._____.', JOINT])).toThrow()
    expect(mk([JOINT, '._____.', '._____B'])).toThrow()
    expect(mk([JOINT, '._/___.', JOINT])).toThrow()
  })

  it('rejects holes and ramps inside a tunnel', () => {
    const mk = (rows: string[]) => () => parseSegment({ id: 't', tier: 2, decor: 'tunnel', rows })
    expect(mk([JOINT, '._._.__', JOINT])).toThrow()
    expect(mk([JOINT, '_______', JOINT])).not.toThrow()
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
    expect(START_PARSED.length).toBe(36)
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
    const tunnels = TEMPLATES.filter((t) => t.decor === 'tunnel')
    expect(tunnels.length).toBeGreaterThanOrEqual(2)
    for (const t of tunnels) {
      for (const row of t.rows.slice(1, -1)) expect(row).not.toMatch(/[./]/)
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
