import type { Manifest } from '../types.ts'
import { MATCH_SECONDS, RACE_SECONDS, START_DELAY_SEC } from './constants.ts'

// 실시간 대전(설계 §7): turnSeconds의 하나뿐인 선택지가 대국 마감(출발 지연 + 경주 + 보고 유예)이다.
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
    turnSeconds: { choices: [MATCH_SECONDS], default: MATCH_SECONDS },
    sameScreen: false,
    realtime: { raceSeconds: RACE_SECONDS, startDelaySec: START_DELAY_SEC },
  },
}
