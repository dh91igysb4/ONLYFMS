// 내 섬 바깥 꾸미기(D단계, 설계 docs/superpowers/specs/2026-11-26-my-isle-d-design.md §4.2). 순수 모듈.
import type { Mats } from './isleEcon.ts'

export type DecoId = 'path' | 'flowers' | 'fence' | 'bench' | 'lamp' | 'mailbox' | 'pot' | 'flag' | 'statue' | 'fountain'
export type Deco = { id: DecoId; name: string; cost: Mats & { gold: number } }
/** 섬에 놓을 수 있는 꾸미기 수(최고 단계) */
export const DECO_MAX = 150

export const DECOS: readonly Deco[] = [
  { id: 'path', name: '돌길', cost: { wood: 0, stone: 2, iron: 0, gold: 100 } },
  { id: 'flowers', name: '꽃밭', cost: { wood: 0, stone: 0, iron: 0, gold: 200 } },
  { id: 'fence', name: '울타리', cost: { wood: 2, stone: 0, iron: 0, gold: 150 } },
  { id: 'bench', name: '벤치', cost: { wood: 6, stone: 0, iron: 1, gold: 2000 } },
  { id: 'lamp', name: '가로등', cost: { wood: 0, stone: 0, iron: 4, gold: 3000 } },
  { id: 'mailbox', name: '우체통', cost: { wood: 3, stone: 0, iron: 1, gold: 1500 } },
  { id: 'pot', name: '큰 화분', cost: { wood: 0, stone: 3, iron: 0, gold: 500 } },
  { id: 'flag', name: '깃발', cost: { wood: 2, stone: 0, iron: 0, gold: 800 } },
  { id: 'statue', name: '석상', cost: { wood: 0, stone: 20, iron: 0, gold: 15000 } },
  { id: 'fountain', name: '분수', cost: { wood: 0, stone: 30, iron: 10, gold: 30000 } },
]
export const isDecoId = (v: unknown): v is DecoId => typeof v === 'string' && DECOS.some((d) => d.id === v)
/** 밟고 지나가는 꾸미기(땅 그림만 바뀐다) */
export const decoWalkable = (id: DecoId): boolean => id === 'path' || id === 'flowers'

export type DecoPlaced = { id: DecoId; tx: number; ty: number }
