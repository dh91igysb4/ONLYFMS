import { test } from 'vitest'
import { progressAt } from '../course/index.ts'
import { NO_CONTROLS } from '../physics/controls.ts'
import { loadRapier } from '../physics/rapier.ts'
import { snapshot } from '../race.ts'
import { createSpike, stepSpike } from './duel.ts'
test('measure', async () => {
  const R = await loadRapier()
  for (const rtt of [0, 50, 100, 200]) {
    const d = createSpike(R)
    d.rttMs = rtt
    for (let k = 0; k < 60 * 60; k++) {
      const s = snapshot(d.me.race); const c = d.me.race.course
      const p = progressAt(c, s.car.pos, d.me.race.progressIndex)
      const t = c.centerline[Math.min(c.centerline.length - 1, p.index + 8)]
      const q = s.car.quat; const fx = 2*(q.x*q.z+q.w*q.y), fz = 1-2*(q.x*q.x+q.y*q.y)
      const cross = fz*(t.x-s.car.pos.x) - fx*(t.z-s.car.pos.z)
      // 나는 조금 느리게 달려 봇이 따라붙게 한다
      stepSpike(d, 1000/60, { ...NO_CONTROLS, throttle: s.car.speed > 38 ? 0 : 1, steer: Math.max(-1, Math.min(1, -cross/4)) })
    }
    console.log(`rtt ${rtt}ms: myHits ${d.hits.me} botHits ${d.hits.bot} oneSided ${d.hits.mismatched} myProgress ${d.me.race.progressIndex} botProgress ${d.bot.race.progressIndex}`)
  }
})
