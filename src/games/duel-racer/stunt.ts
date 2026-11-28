// 스턴트 판정 (레이싱 설계 §5.3). 순수 함수.
// 공중에 있는 동안 차 로컬 각속도를 적분해 피치(앞·뒤구르기)·롤(옆구르기) 회전량을 센다.
import { LANDING_ASSIST_MAX_DEG } from './constants.ts'
import type { Vec3 } from './course/types.ts'

export type AirTrack = { airborne: boolean; airTime: number; pitchAcc: number; rollAcc: number }
export type Landing = { airTime: number; flips: number; clean: boolean }

export const AIR_IDLE: AirTrack = { airborne: false, airTime: 0, pitchAcc: 0, rollAcc: 0 }

/** 이보다 짧은 체공은 턱 넘기로 보고 착지 사건을 만들지 않는다 (s) */
export const MIN_AIR_TIME = 0.3
const TWO_PI = Math.PI * 2
const COS_CLEAN = Math.cos((LANDING_ASSIST_MAX_DEG * Math.PI) / 180)

export function trackAir(
  t: AirTrack,
  s: { grounded: boolean; localAngVel: Vec3; upY: number },
  dt: number,
): { track: AirTrack; landed: Landing | null } {
  if (!s.grounded) {
    return {
      track: { airborne: true, airTime: t.airTime + dt, pitchAcc: t.pitchAcc + s.localAngVel.x * dt, rollAcc: t.rollAcc + s.localAngVel.z * dt },
      landed: null,
    }
  }
  if (!t.airborne || t.airTime < MIN_AIR_TIME) return { track: AIR_IDLE, landed: null }
  const flips = Math.floor(Math.abs(t.pitchAcc) / TWO_PI) + Math.floor(Math.abs(t.rollAcc) / TWO_PI)
  return { track: AIR_IDLE, landed: { airTime: t.airTime, flips, clean: s.upY > COS_CLEAN } }
}
