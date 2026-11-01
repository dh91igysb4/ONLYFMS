import { H, W, ZONE_COUNT } from './constants.ts'

export const TOOTH_WIDTHS = [4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4]

const isChew = (zone: number): boolean => zone === 2 || zone === 5

export function toothRows(zone: number): readonly [number, number] {
  return isChew(zone) ? [8, 23] : [6, 27]
}

export function gumRows(zone: number): readonly [number, number] | null {
  if (zone === 0 || zone === 1) return [0, 5]
  if (zone === 3 || zone === 4) return [28, 31]
  return null
}

// 치아 i의 열 범위 [시작, 끝]
const TOOTH_COLS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = []
  let c = 1
  for (const w of TOOTH_WIDTHS) {
    out.push([c, c + w - 1])
    c += w
  }
  return out
})()

const CELLS: readonly (readonly number[])[] = []
const OWNER: readonly Int8Array[] = []
;(() => {
  const cells = CELLS as number[][]
  const owner = OWNER as Int8Array[]
  for (let z = 0; z < ZONE_COUNT; z++) {
    const [r0, r1] = toothRows(z)
    const list: number[] = []
    const own = new Int8Array(W * H).fill(-1)
    for (let r = r0; r <= r1; r++) {
      for (let t = 0; t < TOOTH_COLS.length; t++) {
        const [c0, c1] = TOOTH_COLS[t]
        for (let c = c0; c <= c1; c++) {
          const corner = (r === r0 || r === r1) && (c === c0 || c === c1)
          if (corner) continue
          const i = r * W + c
          list.push(i)
          own[i] = t
        }
      }
    }
    list.sort((a, b) => a - b)
    cells.push(list)
    owner.push(own)
  }
})()

export function toothCells(zone: number): readonly number[] {
  return CELLS[zone]
}

export function isTooth(zone: number, i: number): boolean {
  return OWNER[zone][i] >= 0
}

export function toothOf(zone: number, i: number): number {
  const o = OWNER[zone]?.[i]
  return o === undefined ? -1 : o
}
