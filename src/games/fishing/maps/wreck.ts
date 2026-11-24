// 난파선 앞바다 맵(wreck). 순수 모듈. 섬 남쪽 두 번째 선착장에서 원양 어선을 사면(150,000G, 백골 낚싯대 이상) 배로 간다.
// 사방이 바다(~). 한가운데 기울어진 큰 난파선(뱃머리에서 선미로 갈수록 한 칸씩 밀린다): 갑판(e)은 걷고, 선체 옆판(n)·부러진 돛대(M)는 막는다.
// 북쪽 얕은 바다는 wreck 자리, 남쪽 검푸른 심해(v)는 abyss 자리 — 심해는 선미 갑판 끝에서만 보인다.
import { defineMap } from '../map.ts'

// 테두리는 모두 바다·심해라 걸을 수 없다. 걸어서 나가는 출구는 없고 뱃머리 선착장(K)에서 배로만 섬에 돌아간다.
// 얕은 바다는 뱃머리·선착장·부서진 난간 틈(옆판이 빠진 칸)·갑판에 뚫린 구멍에서 낚는다.
// 순간이동기(tx 22~23, ty 15~16)는 갑판 가운데.
export const WRECK = defineMap('wreck', [
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~K~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~K~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~o~~~~~~~~~~~~~~neeeen~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~neeeeeen~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~neeeeeeeen~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~~~~~o~~~~~~~',
  '~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~o~~~~~eeeeeMeeeeen~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~eeeeeeeeeeen~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~~~~~~~o~~~~',
  '~~~~~~~~~~~~~~~~~~~neeeeeeeeeee~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~neeeeeeeeeee~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~o~~~~~~~~~neeeeeeeeeen~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~neeeeeMeeeen~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~o~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~eeeeeeeeeeen~~~~~~~~~~~~~~~~',
  '~~~~o~~~~~~~~~~~~~~~neeee~~eeeen~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~neeeee~eeeee~~~~~~~~~~~~o~~~',
  '~~~~~~~~~~~~~~~~~~~~neeeeeeeeeen~~~~~~~~~~~~~~~~',
  'vvvvvvvvvvvvvvvvvvvvneeeeeeeeeenvvvvvvvvvvvvvvvv',
  'vvvvvvvvvvvvvvvvvvvvneeeeeeeeeenvvvvvvvvvvvvvvvv',
  'vvvvvvvvvvvvvvvvvvvvneeeeeeeeeenvvvvvvvvvvvvvvvv',
  'vvvvvvvvvvvvvvvvvvvvvneeeeeeeenvvvvvvvvvvvvvvvvv',
  'vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
  'vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
  'vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
  'vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
  'vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
], {
  spots: { water: 'wreck', deep: 'abyss' },
  // 섬 남쪽 선착장 한 칸 안쪽(뭍 쪽)에 내린다
  docks: [{ front: { tx: 23, ty: 3, facing: 'right' }, target: 'island', entry: { tx: 30, ty: 29, facing: 'up' }, boat: { tx: 24, ty: 3 } }],
  teleporter: { tiles: { tx: 22, ty: 15, w: 2, h: 2 }, front: { tx: 22, ty: 17, facing: 'down' } },
  world: { tx: 380, ty: 1100 },
})
