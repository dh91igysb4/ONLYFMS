import { expect, test } from 'vitest'
import { duels, games, worlds } from './index.ts'
import { getAvatarComponent } from './ui.ts'

test('profile avatar screens are registered exactly for worlds whose manifest declares avatar', () => {
  for (const w of worlds) expect(!!getAvatarComponent(w.manifest.id), w.manifest.id).toBe(!!w.manifest.avatar)
  for (const g of [...games, ...duels]) expect(getAvatarComponent(g.manifest.id)).toBeUndefined()
})
