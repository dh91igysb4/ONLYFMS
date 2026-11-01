import { BASE, BLOB_ADD, BLOB_R_MIN, BLOB_R_SPAN, BLOBS, H, MAX_THICK, W, ZONE_COUNT, ZONE_TOTAL } from './constants.ts'
import { isTooth, toothCells } from './mask.ts'

export type Puzzle = { zones: number[][] }

export function generatePuzzle(rng: () => number): Puzzle {
  const zones: number[][] = []
  for (let z = 0; z < ZONE_COUNT; z++) {
    const cells = toothCells(z)
    const a = new Array<number>(W * H).fill(0)
    for (const i of cells) a[i] = BASE
    for (let b = 0; b < BLOBS; b++) {
      const center = cells[Math.floor(rng() * cells.length)]
      const r = BLOB_R_MIN + Math.floor(rng() * BLOB_R_SPAN)
      const cx = center % W
      const cy = Math.floor(center / W)
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy
        if (y < 0 || y >= H) continue
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx
          if (x < 0 || x >= W || dx * dx + dy * dy > r * r) continue
          const i = y * W + x
          if (!isTooth(z, i)) continue
          a[i] = Math.min(MAX_THICK, a[i] + BLOB_ADD)
        }
      }
    }
    let sum = 0
    for (const i of cells) sum += a[i]
    let diff = ZONE_TOTAL[z] - sum
    while (diff > 0) {
      for (const i of cells) { if (diff === 0) break; if (a[i] < MAX_THICK) { a[i]++; diff-- } }
    }
    while (diff < 0) {
      for (const i of cells) { if (diff === 0) break; if (a[i] > 0) { a[i]--; diff++ } }
    }
    zones.push(a)
  }
  return { zones }
}

export function puzzleKey(p: Puzzle): string {
  let h = 0x811c9dc5
  for (const zone of p.zones) {
    for (const v of zone) {
      h ^= v & 0xff
      h = Math.imul(h, 0x01000193)
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
