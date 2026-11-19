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

  it('tunnel rule: tunnel rows are exactly the 3-wide joint row (walls at ±1.5 m)', () => {
    const mk = (rows: string[]) => () => parseSegment({ id: 't', kind: 'tunnel', tier: 2, rows })
    for (const ch of ['.', '/', '\\', '!', 'v', '<', '>', 'B', 'P', 'G']) {
      expect(mk([JOINT, `..${ch}__..`, JOINT]), ch).toThrow()
      expect(mk([JOINT, `..__${ch}..`, JOINT]), ch).toThrow()
    }
    for (const ch of ['_', '/', '\\', '!', 'v', '<', '>', 'B', 'P', 'G']) {
      expect(mk([JOINT, `.${ch}___..`, JOINT]), `outer ${ch}`).toThrow()
      expect(mk([JOINT, `..___.${ch}`, JOINT]), `outer ${ch}`).toThrow()
    }
    expect(mk([JOINT, '..___..', JOINT])).not.toThrow()
    expect(mk([JOINT, '._____.', JOINT])).toThrow()
  })

  it('center 3 columns must end level; outer columns may differ', () => {
    const mk = (rows: string[]) => () => parseSegment({ id: 't', kind: 'obstacle', tier: 1, rows })
    expect(mk([JOINT, '.v_____', JOINT])).not.toThrow()
    expect(mk([JOINT, '..v__..', JOINT])).toThrow()
    expect(mk([JOINT, '..__v..', JOINT])).toThrow()
    expect(parseSegment({ id: 't', kind: 'obstacle', tier: 1, rows: [JOINT, '.vvvvv.', JOINT] }).dh).toBe(-1000)
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
    expect(START_PARSED.length).toBe(40)
    expect(START.kind).toBe('tunnel')
    expect(START.id).toBe('start')
    expect(START.tier).toBe(1)
  })

  it('no row has more than 3 floor cells (road at most 3 wide, joints and tunnels included)', () => {
    // v3: 길 폭은 어디서나 3칸 이하. 블록·기둥·문 칸도 바닥이 있으니 센다(구멍 '.'만 빼고).
    expect(JOINT).toBe('..___..')
    for (const t of [START, ...TEMPLATES]) {
      t.rows.forEach((row, r) => {
        expect([...row].filter((ch) => ch !== '.').length, `${t.id} row ${r} '${row}'`).toBeLessThanOrEqual(3)
      })
    }
    for (const p of [START_PARSED, ...PARSED]) {
      p.cells.forEach((row, r) => expect(row.filter((c) => c.floor !== null).length, `${p.id} row ${r}`).toBeLessThanOrEqual(3))
    }
  })

  it('no upward step along a column: the sim never has to pop a fast ball onto a higher floor', () => {
    // 시뮬의 접지 스냅에는 위쪽 한도가 없다(vz > R이면 한 틱에 중심이 턱을 넘을 수 있다). 그래서 코스에는 앞쪽으로 높아지는 턱이
    // 없어야 한다: 같은 열에서 바닥 칸의 h0은 앞 행 바닥의 h1보다 높지 않고, 구멍 뒤 다시 나타난 바닥은 그 열에서 마지막으로
    // 본 바닥보다 높지 않다. 오르막 '/'는 이어지므로 통과한다.
    // 지금 DSL에서는 열 높이가 그 열의 기호로만 바뀌어(구멍은 높이 유지) 구조적으로 지켜진다. 규칙이 바뀌어도 깨지지 않게 둔다.
    const upSteps = (p: { id: string; cells: { floor: null | { h0: number; h1: number } }[][] }): string[] => {
      const bad: string[] = []
      for (let i = 0; i < p.cells[0].length; i++) {
        let last: number | null = null
        p.cells.forEach((row, r) => {
          const f = row[i].floor
          if (f === null) return
          if (last !== null && f.h0 > last) bad.push(`${p.id} col ${i + COL_MIN} row ${r}: ${f.h0} > ${last}`)
          last = f.h1
        })
      }
      return bad
    }
    expect([START_PARSED, ...PARSED].flatMap(upSteps)).toEqual([])
    // 자기 점검: 바로 앞 행보다 높은 바닥, 구멍 뒤 더 높은 바닥을 잡는다.
    const fl = (h0: number, h1 = h0) => ({ floor: { h0, h1 } })
    const hole = { floor: null }
    expect(upSteps({ id: 'a', cells: [[fl(0)], [fl(500)]] })).toHaveLength(1)
    expect(upSteps({ id: 'b', cells: [[fl(0)], [hole], [fl(250)]] })).toHaveLength(1)
    expect(upSteps({ id: 'c', cells: [[fl(0, 250)], [hole], [fl(250, 500)], [fl(500)]] })).toEqual([])
  })

  it('every template starts and ends with the joint', () => {
    for (const t of [START, ...TEMPLATES]) {
      expect(t.rows[0]).toBe(JOINT)
      expect(t.rows[t.rows.length - 1]).toBe(JOINT)
    }
  })

  it('start has no blocks or holes in the track', () => {
    for (const row of START_PARSED.cells) {
      for (let c = -1; c <= 1; c++) {
        expect(row[at(c)].floor).not.toBeNull()
        expect(row[at(c)].block).toBe(false)
      }
    }
  })

  it('tunnel segments never leave the floor', () => {
    const tunnels = [START, ...TEMPLATES].filter((t) => t.kind === 'tunnel')
    expect(tunnels.length).toBeGreaterThanOrEqual(1)
    for (const t of tunnels) {
      // 가운데 3칸 바닥만(터널 벽이 ±1.5 m에 서므로 바깥 열은 구멍).
      for (const row of t.rows.slice(1, -1)) expect(row, t.id).toBe('..___..')
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

  it('banked boards push one way for at most 13 rows in a row', () => {
    // 같은 쪽으로 미는 기운 판이 길게 이어지면 손을 거의 못 뗀다(설계 기준). 방향이 바뀌거나 평지가 끼면 끊는다.
    // v3: 속도가 1.7배라 v2의 8행이 13행(같은 시간).
    let banked = 0
    for (const t of TEMPLATES) {
      let dir = ''
      let run = 0
      t.rows.forEach((row, r) => {
        const d = row.includes('<') ? '<' : row.includes('>') ? '>' : ''
        expect(row.includes('<') && row.includes('>'), `${t.id} row ${r} mixes < and >`).toBe(false)
        run = d !== '' && d === dir ? run + 1 : d !== '' ? 1 : 0
        dir = d
        if (d !== '') banked++
        expect(run, `${t.id} row ${r}`).toBeLessThanOrEqual(13)
      })
    }
    expect(banked).toBeGreaterThan(0)
  })

  // 길을 막거나 좁히는 행 = 블록 행이거나 구멍이 새로 생기는 행(길이 좁아지거나 옆으로 옮겨 감). 이음 행(가운데 3칸)도 센다.
  // 바닥이 하나도 없는 행(점프 구멍)은 공이 날아 넘으니 세지 않는다.
  // 그런 행 r1 다음 그런 행 r2: r1의 어느 통과 칸 a에서든 r2의 통과 칸 b까지 옮길 빈 행이 있어야 한다.
  // 필요한 행(v3, 최고 속도 794 mm/틱): 1칸 12, 2칸 21, 3칸 28, 4칸 34, 1칸 틈으로 들어가면 +5(v2 7·12·16·20, +3의 1.7배).
  // a와 b 사이 칸이 구멍·블록으로 끊긴 행(레일 등)은 세지 않는다: 빈 행은 그 마지막 끊긴 행 다음부터 센다.
  const NEED = [0, 12, 21, 28, 34, 40, 46]
  const ENTRY1 = 5
  const pass = (row: string): number[] => [...row].flatMap((ch, i) => ('.BPG'.includes(ch) ? [] : [i]))
  const floorOf = (row: string): number[] => [...row].flatMap((ch, i) => (ch === '.' ? [] : [i]))
  const widthAt = (cells: number[], i: number): number => {
    let w = 1
    for (let k = i - 1; cells.includes(k); k--) w++
    for (let k = i + 1; cells.includes(k); k++) w++
    return w
  }
  function spacingProblems(t: SegmentTemplate): { bad: string[]; checked: number } {
    const bad: string[] = []
    let checked = 0
    const isConstraint = (r: number): boolean =>
      floorOf(t.rows[r]).length > 0 &&
      (/[BPG]/.test(t.rows[r]) || floorOf(t.rows[r - 1]).some((c) => !floorOf(t.rows[r]).includes(c)))
    let r1 = 0
    for (let r2 = 1; r2 < t.rows.length; r2++) {
      if (!isConstraint(r2)) continue
      const to = pass(t.rows[r2])
      for (const a of pass(t.rows[r1])) {
        const ok = to.some((b) => {
          const lo = Math.min(a, b)
          const hi = Math.max(a, b)
          let start = r1
          for (let r = r1; r < r2; r++) {
            const p = pass(t.rows[r])
            if (p.length === 0) continue // 점프 구멍 위로는 날아서 옮긴다
            for (let c = lo; c <= hi; c++) if (!p.includes(c)) start = r
          }
          const need = NEED[hi - lo] + (a !== b && widthAt(to, b) === 1 ? ENTRY1 : 0)
          return r2 - start - 1 >= need
        })
        checked++
        if (!ok) bad.push(`${t.id} rows ${r1}->${r2} from col ${a - 3}`)
      }
      r1 = r2
    }
    return { bad, checked }
  }

  it('lane changes leave enough rows for a human (design spacing at top speed)', () => {
    const all = TEMPLATES.map(spacingProblems)
    expect(all.flatMap((x) => x.bad)).toEqual([])
    expect(all.reduce((n, x) => n + x.checked, 0)).toBeGreaterThan(100)
  })

  it('the spacing rule catches lane changes that come too soon', () => {
    const mk = (rows: string[]): SegmentTemplate => ({ id: 'x', kind: 'obstacle', tier: 1, rows: [JOINT, ...rows, JOINT] })
    const n = (k: number) => new Array<string>(k).fill('..___..')
    // 1칸 틈에서 반대쪽 1칸 틈(2칸 + 5 = 26행)
    expect(spacingProblems(mk([...n(26), '..BB_..', ...n(26), '.._BB..'])).bad).toEqual([])
    expect(spacingProblems(mk([...n(26), '..BB_..', ...n(25), '.._BB..'])).bad).not.toEqual([])
    // 이음 행에서 첫 블록까지 12행
    expect(spacingProblems(mk([...n(11), '..B__..'])).bad).not.toEqual([])
    // 레일 위에서는 건너편으로 못 옮기니 레일이 끝난 뒤부터 센다.
    const rail = (k: number) => new Array<string>(k).fill('.._....')
    expect(spacingProblems(mk([...n(26), ...rail(14), ...n(26), '...._..'])).bad).toEqual([])
    expect(spacingProblems(mk([...n(26), ...rail(14), ...n(25), '...._..'])).bad).not.toEqual([])
    // 길이 한 칸 옮겨 가면 12행 뒤에야 다음으로 옮긴다.
    const road = (row: string, k: number) => new Array<string>(k).fill(row)
    const back = [...road('___....', 13), ...road('.___...', 13)]
    expect(spacingProblems(mk([...n(12), ...road('.___...', 12), ...back])).bad).not.toEqual([])
    expect(spacingProblems(mk([...n(12), ...road('.___...', 13), ...back])).bad).toEqual([])
  })

  it('banked boards push both ways equally in every template (drift never decays)', () => {
    // 기운 판이 쌓은 drift는 줄지 않고, 손가락 목표는 ±X_LIMIT 안이라 drift가 크게 남으면 반대쪽 끝에 못 간다.
    // 조각 안에서는 속도가 같으니 '<' 행 수와 '>' 행 수가 같으면 조각을 지난 뒤 drift가 거의 0으로 돌아온다.
    for (const t of TEMPLATES) {
      const left = t.rows.filter((row) => row.includes('<')).length
      const right = t.rows.filter((row) => row.includes('>')).length
      expect(left, t.id).toBe(right)
    }
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

  it('gates are 1-cell doorways: G pairs with exactly one floor cell between (lintel above the gap)', () => {
    let gates = 0
    for (const t of OBSTACLES) {
      for (const row of t.rows) {
        const cols = [...row].flatMap((ch, i) => (ch === 'G' ? [i] : []))
        if (cols.length === 0) continue
        expect(cols.length % 2, `${t.id} ${row}`).toBe(0)
        for (let k = 0; k < cols.length; k += 2) {
          expect(cols[k + 1] - cols[k], `${t.id} ${row}`).toBe(2)
          expect(row[cols[k] + 1], `${t.id} ${row}`).toBe('_')
          gates++
        }
      }
    }
    expect(gates).toBeGreaterThanOrEqual(3)
  })

  it('tunnels: at least 2, 24..30 rows (v2 14..18 rows x1.7 speed)', () => {
    expect(TUNNELS.length).toBeGreaterThanOrEqual(2)
    for (const p of PARSED_TUNNELS) {
      expect(p.length, p.id).toBeGreaterThanOrEqual(24)
      expect(p.length, p.id).toBeLessThanOrEqual(30)
    }
  })

  it('descents: at least 4, each drops 4 m or more', () => {
    expect(DESCENTS.length).toBeGreaterThanOrEqual(4)
    for (const p of PARSED_DESCENTS) expect(p.dh, p.id).toBeLessThanOrEqual(-4000)
  })

  // 녹화(11~12.5 s, 15.75~16.75 s, 22.75~23.75 s, 31.5~32.25 s)의 터널 뒤 내리막은 3칸 폭 능선이 대부분이고 군데군데
  // 1~2칸까지 좁아진다. 가운데 5열(벽 안쪽)의 바닥 칸 수로 잰다(블록·구멍은 바닥이 아니다).
  const floorCells = (row: string) => [...row.slice(1, 6)].filter((ch) => isFloor(ch)).length
  const holes = (row: string) => new Set([...row.slice(1, 6)].flatMap((ch, i) => (ch === '.' ? [i] : [])))

  it('descents are narrow ridges: 60%+ of interior rows have at most 3 floor cells', () => {
    for (const t of DESCENTS) {
      const inner = t.rows.slice(1, -1)
      const narrow = inner.filter((row) => floorCells(row) <= 3).length
      expect(narrow / inner.length, `${t.id} ${narrow}/${inner.length}`).toBeGreaterThanOrEqual(0.6)
    }
    const minW = DESCENTS.map((t) => Math.min(...t.rows.map(floorCells)))
    expect(minW.filter((w) => w <= 2).length, 'some descents narrow to 1-2 cells').toBeGreaterThanOrEqual(2)
    expect(minW).toContain(1)
  })

  it('descents narrow smoothly: one more hole column at a time, at least 4 rows apart', () => {
    for (const t of DESCENTS) {
      let last = -Infinity
      for (let r = 1; r < t.rows.length; r++) {
        const before = holes(t.rows[r - 1])
        const added = [...holes(t.rows[r])].filter((c) => !before.has(c)).length
        expect(added, `${t.id} row ${r}`).toBeLessThanOrEqual(1)
        if (added === 0) continue
        expect(r - last, `${t.id} row ${r}`).toBeGreaterThanOrEqual(4)
        last = r
      }
    }
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
    // v3: 원작보다 빠르게 ×1.7(V0 200 → 340, V_MAX 467 → 794).
    expect(V0).toBe(340)
    expect(V_MAX).toBe(794)
    expect(SPEED_TABLE).toHaveLength(17)
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
