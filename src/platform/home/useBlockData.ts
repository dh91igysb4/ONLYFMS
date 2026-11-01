import { useEffect, useState } from 'react'

export type BlockState<T> = { kind: 'loading' } | { kind: 'done'; data: T } | { kind: 'error' }

/** 마운트·deps 변경 때 한 번 load. 언마운트 뒤 결과는 버린다. retry는 같은 load를 다시 부른다. */
export function useBlockData<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): { state: BlockState<T>; retry: () => void } {
  const [state, setState] = useState<BlockState<T>>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    load().then(
      (data) => { if (alive) setState({ kind: 'done', data }) },
      () => { if (alive) setState({ kind: 'error' }) },
    )
    return () => { alive = false }
    // load는 매 렌더 새 클로저라 deps에 넣지 않는다. 다시 실행은 deps 변경과 retry로만.
  }, [...deps, attempt])

  return { state, retry: () => setAttempt((n) => n + 1) }
}
