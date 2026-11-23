// 넘어지는 블록. 설계 §7. (시뮬은 Task 6에서 더한다)

/** 너비 w·높이 h(u)의 상자. (x, y) = 바닥 변 가운데, a = 처음 각도(TURN, (x, y) 둘레). */
export type BlockDef = { x: number; y: number; w: number; h: number; a: number }
export type Block = BlockDef & { id: number } // 월드 좌표
