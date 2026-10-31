// 출제·판정 순수 엔진 (설계 §4.2, §5.5). IO 없음. Node(Vitest)와 Deno 양쪽에서 돈다.
import type { Ctx, GameLogic } from '../../../src/games/types.ts'
import { rngFromSeed } from '../../../src/shared/rng.ts'

// deno-lint-ignore no-explicit-any
type AnyLogic = GameLogic<any, any, any, any>

/** 반복 출제 방지 재시도 최대 횟수 (Global Constraints) */
export const MAX_RETRIES = 20

/**
 * 재시도 0부터 시드로 문제를 뽑고, recentKeys에 없는 첫 문제를 돌려준다.
 * 20번 재시도까지 모두 겹치면 마지막 결과를 쓴다 (설계 §5.5).
 */
export async function pickFresh(
  logic: AnyLogic,
  options: Record<string, string>,
  seedFor: (retry: number) => Promise<Uint8Array>,
  recentKeys: Set<string>,
): Promise<{ puzzle: unknown; key: string; retries: number }> {
  let last: { puzzle: unknown; key: string; retries: number } | null = null
  for (let retry = 0; retry <= MAX_RETRIES; retry++) {
    const puzzle = logic.pickPuzzle(rngFromSeed(await seedFor(retry)), options)
    const key = logic.puzzleKey(puzzle)
    last = { puzzle, key, retries: retry }
    if (!recentKeys.has(key)) return last
  }
  return last!
}

/** 0~10, 소수 첫째 자리 (numeric(3,1)) */
export function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.min(10, Math.max(0, Math.round(score * 10) / 10))
}

export type StepResult =
  | { ok: true; state: unknown; finished: boolean; score: number; actionCount: number }
  /** error가 없으면 내부 오류(던짐)다. 메시지를 브라우저에 보내지 않는다 */
  | { ok: false; status: 400; error?: string }

/** 행동 하나를 적용한다. 오류면 상태를 바꾸지 않고 400을 돌려준다. */
export function step(
  logic: AnyLogic,
  puzzle: unknown,
  state: unknown,
  action: unknown,
  ctx: Ctx,
): StepResult {
  if (
    action === null || typeof action !== 'object' || Array.isArray(action) ||
    typeof (action as { type?: unknown }).type !== 'string'
  ) {
    return { ok: false, status: 400, error: '알 수 없는 행동이에요' }
  }
  // logic이 실수로 입력을 바꾸지 않게 복사본을 넘긴다
  const copy = structuredClone(state)
  let res: { state: unknown } | { error: string }
  try {
    res = logic.apply(puzzle, copy, structuredClone(action), ctx)
  } catch (e) {
    // 예외 내용은 서버 로그에만 남긴다
    console.error('play: logic.apply threw', e)
    return { ok: false, status: 400 }
  }
  if ('error' in res) return { ok: false, status: 400, error: res.error }
  return {
    ok: true,
    state: res.state,
    finished: logic.isFinished(res.state, ctx),
    score: normalizeScore(logic.score(res.state, ctx)),
    actionCount: logic.actionCount(res.state),
  }
}
