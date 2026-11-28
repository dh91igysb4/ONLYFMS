// PC 판정 (레이싱 설계 §5.5): 마우스·트랙패드처럼 정밀한 포인터가 하나라도 있으면 PC로 본다.
// 터치 전용 기기(폰·태블릿)는 키보드 조작 게임을 할 수 없다고 보고 막는다.
export type PointerEnv = { coarse: boolean; fine: boolean }

function currentEnv(): PointerEnv {
  const mq = (q: string) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches
  return { coarse: mq('(any-pointer: coarse)'), fine: mq('(pointer: fine)') || mq('(any-pointer: fine)') }
}

export function isPcCapable(env: PointerEnv = currentEnv()): boolean {
  return env.fine
}
