// 옷장 미리보기(설계 2026-11-24-fishing-wardrobe §4.4). 품목마다 기본 옷차림에 하나씩 입혀
// 앞·뒤·오른쪽·왼쪽 대기 + 걷기·던지기·감기 자세를 한 장의 PNG로 쓴다. 테스트·빌드에는 들어가지 않는다.
// 실행: node --experimental-strip-types scripts/preview-wardrobe.ts [출력 폴더]
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { composePose } from '../src/games/fishing/outfit.ts'
import { DEFAULT_OUTFIT, WEAR, type Outfit } from '../src/games/fishing/wardrobe.ts'
import type { Sprite } from '../src/games/fishing/sprites.ts'

const OUT = process.argv[2] ?? '/home/claude/preview/wardrobe'
const SCALE = 4
const GAP = 2
// [자세, 좌우 뒤집기]
const STRIP: [string, boolean][] = [
  ['player-idle-down', false], ['player-idle-up', false], ['player-idle-side', false], ['player-idle-side', true],
  ['player-walk-down-0', false], ['player-walk-side-0', false], ['player-walk-up-1', false],
  ['player-cast', false], ['player-cast-up', false], ['player-cast-side', false],
  ['player-reel', false], ['player-reel-up', false], ['player-reel-side', false],
]

function crcTable(): Uint32Array {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
}
const CRC = crcTable()
function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())])
}

function render(outfit: Outfit): Buffer {
  const cell = 16 + GAP
  const w = STRIP.length * cell * SCALE
  const h = (24 + GAP * 2) * SCALE
  const px = new Uint8Array(w * h * 4)
  // 낚시 풀밭 비슷한 배경(대비 확인용)
  for (let i = 0; i < w * h; i++) px.set([0x6f, 0xa8, 0x5a, 255], i * 4)
  STRIP.forEach(([name, flip], i) => {
    const sp: Sprite = composePose(name, outfit)
    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) {
        const ch = sp.rows[y][flip ? sp.w - 1 - x : x]
        if (ch === '.') continue
        const hex = sp.palette[ch]
        const rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))
        for (let sy = 0; sy < SCALE; sy++) {
          for (let sx = 0; sx < SCALE; sx++) {
            const X = (i * cell + GAP / 2 + x) * SCALE + sx
            const Y = (GAP + y) * SCALE + sy
            px.set([...rgb, 255], (Y * w + X) * 4)
          }
        }
      }
    }
  })
  return png(w, h, px)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/_default.png`, render({ ...DEFAULT_OUTFIT }))
for (const item of WEAR) {
  writeFileSync(`${OUT}/${item.slot}-${item.id}.png`, render({ ...DEFAULT_OUTFIT, [item.slot]: item.id }))
}
// 모자 없이 본 머리 모양
for (const item of WEAR.filter((w) => w.slot === 'hair')) {
  writeFileSync(`${OUT}/hair-${item.id}-nohat.png`, render({ ...DEFAULT_OUTFIT, hat: 'none', hair: item.id, hairColor: 'blonde' }))
}
// 유니폼 세트
const kits: [string, string][] = [['kit-claret', 'shorts-white'], ['kit-red', 'shorts-red'], ['kit-redwhite', 'shorts-white'], ['kit-white', 'shorts-navy'], ['kit-royal', 'shorts-blue'], ['kit-stripes', 'shorts-black']]
for (const [top, bottom] of kits) writeFileSync(`${OUT}/set-${top}.png`, render({ ...DEFAULT_OUTFIT, hat: 'none', top, bottom }))
console.log(`wrote ${WEAR.length + 16} previews to ${OUT}`)
