import type { Manifest } from '../types.ts'
import { RACE_SECONDS } from './constants.ts'

// 실시간 대전(설계 §7): turnSeconds는 쓰지 않지만 타입 호환을 위해 레이스 시간으로 채운다.
export const manifest: Manifest = {
  id: 'duel-racer',
  // 화면 이름은 사용자가 정한다(설계 머리말). 정해지면 바꾼다.
  name: '레이싱',
  description: '친구와 1대1로 부딪히며 달린다',
  hidden: true,
  category: 'duel',
  modes: { daily: false, contest: false, free: false },
  puzzleSource: 'generate',
  dailyTimeLimitSec: null,
  options: [],
  duel: {
    turnSeconds: { choices: [RACE_SECONDS], default: RACE_SECONDS },
    sameScreen: false,
    realtime: { raceSeconds: RACE_SECONDS },
  },
}
