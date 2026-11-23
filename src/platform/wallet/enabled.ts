import { worlds } from '../../games/index.ts'

/**
 * 지갑을 쓰는 게임이 하나라도 등록돼 있는가 (등록부 기준, 게임 id 분기 아님).
 * 낚시가 지갑으로 옮기기(계획 Task 4) 전에 이 PR만 배포돼도 헤더·프로필에 "0 G"가 보이지 않게 한다.
 */
export function walletEnabled(): boolean {
  return worlds.some((w) => w.logic.wallet === true)
}
