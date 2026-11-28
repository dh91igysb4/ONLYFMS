// Rapier(WASM)를 한 번만 초기화해 돌려준다. 레이스 화면에서만 동적 import로 불린다.
import RAPIER from '@dimforge/rapier3d-compat'

export type Rapier = typeof RAPIER

let ready: Promise<Rapier> | null = null

export function loadRapier(): Promise<Rapier> {
  if (!ready) {
    ready = RAPIER.init().then(() => RAPIER)
    ready.catch(() => { ready = null })
  }
  return ready
}
